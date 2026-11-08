// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';

const TEXT = 'Intro.\n\nThe model \\emph{fails} on long inputs \\cite{vaswani2017}.\n';

vi.mock('$lib/workspace/workspaceStore', () => ({ workspaceRoot: { current: '/w' }, isDirty: { current: true } }));
vi.mock('$lib/workspace/fileSystem', () => ({
	readTextFile: async () => TEXT,
	toLf: (s: string) => s,
	joinPath: (a: string, b: string) => `${a}/${b}`,
	samePath: (a: string, b: string) => a === b
}));
vi.mock('$lib/workspace/mcpWorkspacePath', () => ({ resolveInWorkspace: (rel: string) => `/w/${rel}`, inOpenTree: () => true }));
vi.mock('$lib/workspace/documentBuffer.svelte', () => ({
	fileKind: () => 'tex',
	hasVisualMode: () => true,
	isRawTextKind: () => false
}));
vi.mock('$lib/collab/hostStore.svelte', () => ({ collabHost: { active: false } }));
vi.mock('$lib/stores/projectIntel', () => ({
	projectIntelStore: { current: { bibEntries: [{ key: 'devlin2019', file: 'refs.bib', line: 1 }] } }
}));

const { suggestEditPayload } = await import('$lib/workspace/mcpSuggestEdit');

it('puts an exact quote in as the agent’s suggestion, and refuses a loose match, another file and an invented citation', async () => {
	const suggestAs = vi.fn(async () => 'new-id');
	const deps = {
		comments: { threads: [], store: { writable: true }, suggestions: { suggestAs } } as never,
		getLoadedPath: () => '/w/main.tex',
		getBuffer: () => TEXT,
		adoptDiskChange: async () => {}
	};
	const quote = 'The model \\emph{fails} on long inputs';
	const made = await suggestEditPayload(deps, {
		path: 'main.tex',
		quote,
		replacement: 'The model breaks on long inputs',
		note: 'plainer',
		by: 'Codex'
	});
	expect(made).toEqual({ ok: true, suggestion: 'new-id', file: 'main.tex', line: 3 });
	const from = TEXT.indexOf(quote);
	expect(suggestAs).toHaveBeenCalledWith('Codex', { from, to: from + quote.length, insert: 'The model breaks on long inputs' }, 'plainer');

	const refusals = await Promise.all([
		suggestEditPayload(deps, { path: 'main.tex', quote: 'The model fails on long inputs', replacement: 'x' }),
		suggestEditPayload(deps, { path: 'other.tex', quote, replacement: 'x' }),
		suggestEditPayload(deps, {
			path: 'main.tex',
			quote: 'inputs \\cite{vaswani2017}',
			replacement: 'inputs \\cite{vaswani2017, madeup2024}'
		})
	]);
	expect(refusals.map((r) => r.ok)).toEqual([false, false, false]);
	expect(suggestAs).toHaveBeenCalledTimes(1);
	expect(
		await suggestEditPayload(deps, {
			path: 'main.tex',
			quote: 'inputs \\cite{vaswani2017}',
			replacement: 'inputs \\cite{vaswani2017, devlin2019}'
		})
	).toMatchObject({ ok: true });
});
