// @vitest-environment jsdom
// The main file is a CHOICE, and the store holds only choices.
//
// The bug: opening a folder with no saved main ran detectMainFile and put the GUESS in the store.
// The file tree stars whatever is in the store, so a file nobody picked got a star - while
// `confirmed` stayed false, so the first compile still opened the picker. The tree and the compile
// gate gave different answers to the same question, from the same folder open.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FolderLifecycle, type FolderLifecycleDeps } from '$lib/workspace/folderLifecycle';
import { workspaceRoot, mainFile, setMainFile } from '$lib/workspace/workspaceStore';
import type { TexFile } from '$lib/workspace/fileSystem';

const ROOT = 'C:/proj';
const file = (rel: string): TexFile => ({ path: `${ROOT}/${rel}`, name: rel.split('/').pop()!, relPath: rel });

let confirmed: boolean | null = null;

function lifecycle(files: TexFile[]) {
	confirmed = null;
	const deps: Partial<FolderLifecycleDeps> = {
		scanTexFiles: async () => ({ files }),
		setMainConfirmed: (v: boolean) => (confirmed = v),
		loadExistingPdf: () => {},
		setProjectMacros: () => {}
	};
	return new FolderLifecycle(deps as FolderLifecycleDeps);
}

beforeEach(() => {
	localStorage.clear();
	workspaceRoot.current = ROOT;
	mainFile.current = null;
	// gatherProjectMacros reads the main file off disk; there is no disk here
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('main file on folder open', () => {
	it('stars nothing in a multi-file folder with no saved choice', async () => {
		// main.tex is exactly what detectMainFile would have picked - that is the point
		await lifecycle([file('main.tex'), file('chapters/one.tex'), file('chapters/two.tex')]).initProject(ROOT);
		expect(mainFile.current).toBeNull();
		expect(confirmed).toBe(false); // so the first compile asks, and the tree agrees it is unset
	});

	it('restores a saved choice, and treats it as settled', async () => {
		setMainFile(ROOT, `${ROOT}/chapters/one.tex`);
		mainFile.current = null; // only storage should be feeding this back
		await lifecycle([file('main.tex'), file('chapters/one.tex')]).initProject(ROOT);
		expect(mainFile.current).toBe(`${ROOT}/chapters/one.tex`);
		expect(confirmed).toBe(true);
	});

	it('forgets a saved choice whose file is gone rather than guessing a replacement', async () => {
		setMainFile(ROOT, `${ROOT}/deleted.tex`);
		mainFile.current = null;
		await lifecycle([file('main.tex'), file('other.tex')]).initProject(ROOT);
		expect(mainFile.current).toBeNull();
		expect(confirmed).toBe(false);
	});

	it('adopts the only candidate: one file is not a choice', async () => {
		await lifecycle([file('paper.tex')]).initProject(ROOT);
		expect(mainFile.current).toBe(`${ROOT}/paper.tex`);
		expect(confirmed).toBe(true);
	});

	it('leaves an empty folder unset', async () => {
		await lifecycle([]).initProject(ROOT);
		expect(mainFile.current).toBeNull();
	});
});
