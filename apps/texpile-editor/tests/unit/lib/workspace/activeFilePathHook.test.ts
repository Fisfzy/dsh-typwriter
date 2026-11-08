// @vitest-environment jsdom
// activeFilePath.onWrite must fire SYNCHRONOUSLY inside the assignment: the caret save hangs off
// it, and the writers mutate more state right after the write (folder switch rebinds docPositions,
// delete forget()s the entry, openDiff flips the mode) - a save deferred to the effect flush would
// read that mutated world. See workspaceStore.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { activeFilePath } from '$lib/workspace/workspaceStore';

afterEach(() => {
	activeFilePath.current = null;
});

describe('activeFilePath write hook', () => {
	it('fires inside the assignment, before any code after the write', () => {
		const order: string[] = [];
		const stop = activeFilePath.onWrite(() => order.push('hook'));
		activeFilePath.current = '/proj/a.tex';
		order.push('after-write');
		stop();
		expect(order).toEqual(['hook', 'after-write']);
	});

	it('does not fire when the value is unchanged', () => {
		activeFilePath.current = '/proj/a.tex';
		let fired = 0;
		const stop = activeFilePath.onWrite(() => fired++);
		activeFilePath.current = '/proj/a.tex';
		stop();
		expect(fired).toBe(0);
	});

	it('sees the new value from inside the hook (subscribe parity)', () => {
		let seen: string | null = 'unset';
		const stop = activeFilePath.onWrite(() => (seen = activeFilePath.current));
		activeFilePath.current = '/proj/b.tex';
		stop();
		expect(seen).toBe('/proj/b.tex');
	});
});
