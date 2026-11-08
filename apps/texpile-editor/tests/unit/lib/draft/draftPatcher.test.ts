import { it, expect, vi } from 'vitest';
import { DraftPatcher } from '$lib/draft/draftPatcher.svelte';
import type { PatchReq } from '$lib/draft/patch/patch.types';

// a keystroke held behind a running patch was replayed with the `orig` of its own keystroke, which the running
// patch had already moved the baseline past: it located nowhere and took a full recompile
it('decides an edit held behind a running patch again instead of replaying it', async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const started: unknown[] = [];
	const hooks = {
		hasNative: () => true,
		pageCount: () => 1,
		compiling: () => false,
		setStatus: () => {},
		compile: () => {},
		emit: (kind: string, detail: unknown) => {
			if (kind === 'patch-start') started.push(detail);
		},
		locate: async () => {
			await gate;
			return { bail: 'cal-empty', invisible: true };
		}
	};
	const patcher = new DraftPatcher(hooks as unknown as ConstructorParameters<typeof DraftPatcher>[0]);
	const req = (text: string, redecide?: () => void): PatchReq => ({ file: 'main.tex', line: 3, orig: 'A word', text, redecide });
	const first = patcher.instantPatch(req('A word typed'));
	const redecide = vi.fn();
	await patcher.instantPatch(req('A word typed fast', redecide));
	release();
	await first;
	expect(redecide).toHaveBeenCalledTimes(1);
	expect(started).toHaveLength(1);
});
