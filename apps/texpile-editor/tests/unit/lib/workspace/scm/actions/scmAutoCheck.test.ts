/** @vitest-environment jsdom */
// VS Code's autofetch loop, as the automatic check copies it: wait until git is idle and the window
// is in front, fetch without asking anyone anything, and stop at a check that would have needed a
// sign-in until the author's own Sync works.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Res = { ok: boolean; failure?: string; remote?: string; behind?: number };
const gitFetchQuiet = vi.fn(async (_root: string): Promise<Res> => ({ ok: true, remote: 'origin', behind: 0 }));
const settings = { current: { checkForNewVersions: true } };

vi.mock('$lib/workspace/fileSystem', () => ({ nativeBridge: () => ({ gitFetchQuiet }) }));
const workspaceRoot = { current: '/p' };
vi.mock('$lib/workspace/workspaceStore', () => ({ workspaceRoot }));
vi.mock('$lib/workspace/scm/gitStore', () => ({
	refreshGitStatus: vi.fn(async () => ({})),
	gitRunning: { current: null },
	gitTracking: { current: 'origin/main' },
	gitOperation: { current: null },
	isGitRepo: { current: true }
}));
vi.mock('$lib/settings', () => ({ settings }));

const { AutoCheck, AUTO_CHECK_PERIOD_MS, resumeAutoCheck } = await import('$lib/workspace/scm/actions/scmAutoCheck.svelte');

let check: InstanceType<typeof AutoCheck>;

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(document, 'hasFocus').mockReturnValue(true);
	gitFetchQuiet.mockClear();
	settings.current.checkForNewVersions = true;
	workspaceRoot.current = '/p';
	resumeAutoCheck();
	check = new AutoCheck({ isBusy: () => false });
});
afterEach(() => {
	check.stop();
	vi.useRealTimers();
});

describe('the automatic check', () => {
	it('checks soon after the project opens, then every three minutes', async () => {
		check.start();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(gitFetchQuiet).toHaveBeenCalledWith('/p');
		await vi.advanceTimersByTimeAsync(AUTO_CHECK_PERIOD_MS);
		expect(gitFetchQuiet).toHaveBeenCalledTimes(2);
	});

	it('stops at a check that would have had to ask for a sign-in, until a Sync of the author works', async () => {
		gitFetchQuiet.mockResolvedValueOnce({ ok: false, failure: 'cancelled' });
		check.start();
		await vi.advanceTimersByTimeAsync(5_000);
		await vi.advanceTimersByTimeAsync(AUTO_CHECK_PERIOD_MS * 3);
		expect(gitFetchQuiet).toHaveBeenCalledTimes(1);

		resumeAutoCheck();
		await vi.advanceTimersByTimeAsync(AUTO_CHECK_PERIOD_MS);
		expect(gitFetchQuiet).toHaveBeenCalledTimes(2);
	});

	it('waits while the window is behind others, and checks on coming back', async () => {
		vi.mocked(document.hasFocus).mockReturnValue(false);
		check.start();
		await vi.advanceTimersByTimeAsync(AUTO_CHECK_PERIOD_MS * 2);
		expect(gitFetchQuiet).not.toHaveBeenCalled();
		vi.mocked(document.hasFocus).mockReturnValue(true);
		window.dispatchEvent(new Event('focus'));
		await vi.advanceTimersByTimeAsync(0);
		expect(gitFetchQuiet).toHaveBeenCalledTimes(1);
	});

	// another folder has its own remote and its own sign-in: a refusal in one stopped the checking in all
	it('stops only in the folder whose check needed a sign-in', async () => {
		gitFetchQuiet.mockResolvedValueOnce({ ok: false, failure: 'auth' });
		check.start();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(gitFetchQuiet).toHaveBeenCalledTimes(1);

		// the workspace starts the check over for each folder opened in the window
		workspaceRoot.current = '/q';
		check.stop();
		check.start();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(gitFetchQuiet).toHaveBeenLastCalledWith('/q');
	});

	it("checks a folder opened during another's check soon, not a whole period later", async () => {
		let done!: (r: Res) => void;
		gitFetchQuiet.mockImplementationOnce(() => new Promise<Res>((resolve) => (done = resolve)));
		check.start();
		await vi.advanceTimersByTimeAsync(5_000);
		workspaceRoot.current = '/q';
		check.stop();
		check.start();
		// the first folder's check ends after the second folder's was scheduled, and pushed it back
		done({ ok: true, remote: 'origin', behind: 0 });
		await vi.advanceTimersByTimeAsync(5_000);
		expect(gitFetchQuiet).toHaveBeenLastCalledWith('/q');
	});

	it('does nothing when turned off in Preferences', async () => {
		settings.current.checkForNewVersions = false;
		check.start();
		await vi.advanceTimersByTimeAsync(AUTO_CHECK_PERIOD_MS * 2);
		expect(gitFetchQuiet).not.toHaveBeenCalled();
	});
});
