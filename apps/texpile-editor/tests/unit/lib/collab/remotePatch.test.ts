// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseLatexFile, serializeLatexFileDetailed } from '$lib/workspace/latexRoundtrip';
import { applyRemotePatch } from '$lib/collab/remotePatch';

const SOURCE =
	'\\documentclass{article}\n\\begin{document}\nAn opening line.\n\nA line between.\n\nWe prove the estimator is sharp.\n\nAway from a shock the grid resolves the flow.\n\\end{document}\n';

let view: EditorView | null = null;
afterEach(() => {
	view?.destroy();
	view = null;
});

/** a space typed after "We prove", so the paragraph briefly holds two in a row, and the text it serializes to */
function typedSpace() {
	const parsed = parseLatexFile(SOURCE);
	let at = 1 + parsed.doc.child(2).textContent.indexOf(' the estimator');
	for (let i = 0; i < 2; i++) at += parsed.doc.child(i).nodeSize;
	const state = EditorState.create({ doc: parsed.doc, selection: TextSelection.create(parsed.doc, at) });
	view = new EditorView(document.body.appendChild(document.createElement('div')), { state });
	view.dispatch(view.state.tr.insertText(' '));
	const local = serializeLatexFileDetailed(parsed, view.state.doc);
	expect(local.text).toContain('We prove  the');
	return { view, local };
}

/** the collaborator's text patched in, and what the editor writes out from then on: anything but that
 *  text is a change its next keystroke hands the shared doc */
function landRemote(v: EditorView, local: { text: string; map: ReturnType<typeof serializeLatexFileDetailed>['map'] }, next: string) {
	const parsed = parseLatexFile(next);
	applyRemotePatch(v, parsed.doc, local.map, parsed.map, parsed.origins, local.text, next);
	return serializeLatexFileDetailed(parsed, v.state.doc).text;
}

const typedSoFar = (v: EditorView) => v.state.selection.$head.parent.textBetween(0, v.state.selection.$head.parentOffset);

it('leaves the paragraph being typed in as typed when a collaborator changes another one', () => {
	const { view: v, local } = typedSpace();
	const next = local.text.replace('the grid', 'the coarse grid');
	expect(landRemote(v, local, next)).toBe(next);
	expect(v.state.doc.child(3).textContent).toContain('the coarse grid');
	expect(v.state.doc.child(2).textContent).toBe('We prove  the estimator is sharp.');
	expect(typedSoFar(v)).toBe('We prove ');
});

it("takes only a collaborator's words into the paragraph being typed in", () => {
	const { view: v, local } = typedSpace();
	const next = local.text.replace('sharp.', 'sharp indeed.');
	// the paragraph is written against the parse's, which reads the two spaces as one, so a third goes in
	const spaces = (t: string) => t.replace(/ +/g, ' ');
	expect(spaces(landRemote(v, local, next))).toBe(spaces(next));
	expect(v.state.doc.child(2).textContent).toBe('We prove  the estimator is sharp indeed.');
	expect(typedSoFar(v)).toBe('We prove ');
});

it('takes them in the same way when the same change reached a paragraph further up', () => {
	const { view: v, local } = typedSpace();
	const next = local.text.replace('opening line.', 'opening line, reworded.').replace('sharp.', 'sharp indeed.');
	landRemote(v, local, next);
	expect(v.state.doc.child(0).textContent).toBe('An opening line, reworded.');
	expect(v.state.doc.child(2).textContent).toBe('We prove  the estimator is sharp indeed.');
	expect(typedSoFar(v)).toBe('We prove ');
});

it('keeps the caret before words a collaborator types at the same spot', () => {
	const { view: v, local } = typedSpace();
	const at = local.text.indexOf('We prove  ') + 'We prove '.length;
	landRemote(v, local, local.text.slice(0, at) + 'THEIRS' + local.text.slice(at));
	expect(v.state.doc.child(2).textContent).toBe('We prove THEIRS the estimator is sharp.');
	expect(typedSoFar(v)).toBe('We prove ');
});
