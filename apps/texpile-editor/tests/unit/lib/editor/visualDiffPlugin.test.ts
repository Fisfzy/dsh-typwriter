// @vitest-environment jsdom
// A comparison can be typed into, and the marks have to keep up.
//
// The plugin holds the change set rather than the changes, so every transaction extends it through
// addSteps instead of re-diffing the document. That is the whole reason editing inside a diff is
// affordable - and it is also what makes the marks describe the document in front of you rather
// than a snapshot taken when the comparison opened.
import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { parseLatexFile } from '$lib/workspace/latexRoundtrip';
import { schema } from '$lib/languages/latex/schema/latexPMSchema';
import { visualDiffKey, visualDiffPlugin, VISUAL_DIFF_REFRESH } from '$lib/editor/visual/diff/visualDiffPlugin';
import type { Node as PMNode } from 'prosemirror-model';

const doc = (body: string): PMNode => parseLatexFile(`\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`).doc;

function stateFor(version: PMNode, working: PMNode): EditorState {
	return EditorState.create({ schema, doc: working, plugins: [visualDiffPlugin({ oldDoc: version })] });
}

/** the text every inline mark covers, which is what a reader sees highlighted */
function marked(state: EditorState): string[] {
	const decos = visualDiffKey.getState(state)?.decorations;
	return (decos?.find() ?? [])
		.filter((d) => d.spec?.diff === 'inline')
		.map((d) => state.doc.textBetween(d.from, d.to, ' ', ' ').trim())
		.filter(Boolean);
}

describe('visualDiffPlugin', () => {
	it('starts with nothing marked when the working copy matches the version', () => {
		expect(marked(stateFor(doc('The cat sat.'), doc('The cat sat.')))).toEqual([]);
	});

	it('marks what the version does not have', () => {
		expect(marked(stateFor(doc('The cat sat.'), doc('The very large cat sat.')))).toEqual(['very large']);
	});

	// typing inside the comparison: the mark has to appear as the words are written, not when the
	// next snapshot happens to be taken
	it('follows an edit made inside the comparison', () => {
		const state = stateFor(doc('The cat sat.'), doc('The cat sat.'));
		expect(marked(state)).toEqual([]);

		const at = state.doc.resolve(1).start() + 4; // just after "The "
		const typed = state.apply(state.tr.insertText('quick ', at));

		expect(marked(typed).join(' ')).toContain('quick');
	});

	// and taking it back has to take the mark with it, or the diff accumulates edits that are no
	// longer there
	it('drops the mark when the edit is undone by hand', () => {
		const state = stateFor(doc('The cat sat.'), doc('The cat sat.'));
		const at = state.doc.resolve(1).start() + 4;
		const typed = state.apply(state.tr.insertText('quick ', at));
		const reverted = typed.apply(typed.tr.delete(at, at + 'quick '.length));

		expect(marked(reverted)).toEqual([]);
	});

	// the version is swapped without rebuilding the editor: picking a different one in the timeline
	// sends a meta, and everything is recomputed against it
	it('recomputes against a different version through a meta', () => {
		const state = stateFor(doc('The cat sat.'), doc('The very large cat sat.'));
		expect(marked(state)).toEqual(['very large']);

		const rebased = state.apply(state.tr.setMeta(visualDiffKey, { oldDoc: doc('The very large cat sat.') }));
		expect(marked(rebased)).toEqual([]);
	});

	// A comparison against a distant version holds thousands of changes, and redrawing them all is
	// ~230ms - per keystroke, on the main thread, while someone is typing. Carrying the marks
	// forward with the text instead is 0.4ms, and the debounce puts them right at the next pause.
	// The trade only applies when it has to: a handful of changes still redraws outright, so the
	// mark on what you just typed appears immediately.
	describe('a comparison too large to redraw between keystrokes', () => {
		const paragraphs = (n: number, seed: string) =>
			Array.from({ length: n }, (_, i) => `Paragraph ${i}${seed} with enough prose in it to be a real one.`).join('\n\n');

		it('carries the marks forward instead, and marks itself stale', () => {
			const state = stateFor(doc(paragraphs(200, '')), doc(paragraphs(200, ' rewritten')));
			expect(visualDiffKey.getState(state)!.set!.changes.length).toBeGreaterThan(150);

			const typed = state.apply(state.tr.insertText('x', state.doc.resolve(1).start() + 1));
			expect(visualDiffKey.getState(typed)!.stale).toBe(true);
		});

		it('puts them right when the refresh arrives', () => {
			const state = stateFor(doc(paragraphs(200, '')), doc(paragraphs(200, ' rewritten')));
			const typed = state.apply(state.tr.insertText('x', state.doc.resolve(1).start() + 1));

			const refreshed = typed.apply(typed.tr.setMeta(VISUAL_DIFF_REFRESH, true));
			expect(visualDiffKey.getState(refreshed)!.stale).toBe(false);
		});

		it('redraws outright while the comparison is small, so nothing is ever stale', () => {
			const state = stateFor(doc('The cat sat.'), doc('The cat sat.'));
			const typed = state.apply(state.tr.insertText('quick ', state.doc.resolve(1).start() + 4));
			expect(visualDiffKey.getState(typed)!.stale).toBe(false);
			expect(marked(typed).join(' ')).toContain('quick');
		});
	});

	it('clears everything when the comparison closes', () => {
		const state = stateFor(doc('The cat sat.'), doc('The very large cat sat.'));
		const cleared = state.apply(state.tr.setMeta(visualDiffKey, null));
		expect(marked(cleared)).toEqual([]);
		expect(visualDiffKey.getState(cleared)?.set).toBeNull();
	});
});
