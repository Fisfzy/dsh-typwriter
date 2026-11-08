// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '$lib/languages/latex/schema/latexPMSchema';
import { editMode } from '$lib/comments/activeSuggestions.svelte';
import { pmSuggestions, setPmSuggestions } from '$lib/editor/visual/extensions/pmSuggestions';

const at = 1 + 'Refinement is '.length;

// the browser moves the caret a line and lands beside the old words; ProseMirror then reads the selection
function typedAfterLanding(side: 'before' | 'after'): string {
	const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, schema.text('Refinement is driven by an estimator.'))]);
	const place = document.createElement('div');
	document.body.appendChild(place);
	const view = new EditorView(place, { state: EditorState.create({ doc, plugins: [pmSuggestions()] }) });
	setPmSuggestions(view, [
		{ id: 'r', from: at, to: at + 'driven'.length, restore: 'led', old: [{ text: 'led', marks: [] }], mine: false, partial: false }
	]);
	const words = view.dom.querySelector('.pm-suggest-old')!;
	const neighbour = side === 'before' ? words.previousSibling! : words.nextSibling!;
	let text = neighbour;
	while (text.firstChild) text = text.firstChild;
	getSelection()!.collapse(text, side === 'before' ? text.textContent!.length : 0);
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
	view.dispatch(view.state.tr.insertText('X', at));
	const out = view.dom.querySelector('p')!.textContent!;
	view.destroy();
	return out;
}

it('types on the side of old words where the browser put the caret', () => {
	editMode.current = 'editing';
	expect(typedAfterLanding('before')).toBe('Refinement is Xleddriven by an estimator.');
	expect(typedAfterLanding('after')).toBe('Refinement is ledXdriven by an estimator.');
});
