// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '$lib/languages/latex/schema/latexPMSchema';
import { wordSelectionTrim } from '$lib/editor/visual/extensions/wordSelectionTrim';

const TEXT = 'The estimator is sharp for smooth solutions.';

function view() {
	const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text(TEXT)])]);
	const place = document.createElement('div');
	document.body.appendChild(place);
	return new EditorView(place, { state: EditorState.create({ doc, plugins: [wordSelectionTrim()] }) });
}

/** the selection a double click leaves in Chrome: the word plus the space after it */
function selectAs(v: EditorView, text: string) {
	const at = TEXT.indexOf(text) + 1;
	v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at, at + text.length)));
	v.dom.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
	return new Promise((r) => setTimeout(r, 0));
}

const picked = (v: EditorView) => v.state.doc.textBetween(v.state.selection.from, v.state.selection.to);

describe('what a double click leaves selected', () => {
	it('drops the space the browser takes with the word', async () => {
		const v = view();
		await selectAs(v, 'sharp ');
		expect(picked(v)).toBe('sharp');
		v.destroy();
	});

	it('leaves a selection that already stops at the word alone', async () => {
		const v = view();
		await selectAs(v, 'sharp');
		expect(picked(v)).toBe('sharp');
		v.destroy();
	});

	// a double click on the space itself selects only whitespace, and taking it away would leave
	// the caret somewhere the reader did not click
	it('leaves a selection of nothing but space alone', async () => {
		const v = view();
		await selectAs(v, ' ');
		expect(picked(v)).toBe(' ');
		v.destroy();
	});
});
