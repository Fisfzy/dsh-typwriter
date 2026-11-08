// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { crossBlockEdits } from '$lib/editor/visual/extensions/crossBlockEdits';
import { parseTypstFile } from '$lib/languages/typst/visual/roundtrip';

const SWEEP = readFileSync(`${__dirname}/../../../../fixtures/comments/feature-sweep.typ`, 'utf8');

function textAt(doc: PMNode, words: string, offset = 0): number {
	let at = -1;
	doc.descendants((node, pos) => {
		if (at < 0 && node.isText && node.text!.includes(words)) at = pos + node.text!.indexOf(words) + offset;
		return at < 0;
	});
	return at;
}

function mount(from: string, to: string): EditorView {
	const doc = parseTypstFile(SWEEP).doc;
	const state = EditorState.create({ doc, plugins: [crossBlockEdits] });
	const view = new EditorView(document.body.appendChild(document.createElement('div')), { state });
	view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, textAt(doc, from, 3), textAt(doc, to, 2))));
	return view;
}

describe('an edit across blocks that cannot be joined', () => {
	it('deletes from a list item into a term title, keeping each end in its own block', () => {
		const view = mount('numbering is', 'Term');
		expect(() => view.state.tr.deleteSelection()).toThrow();
		expect(view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'Backspace' })))).toBe(true);
		const text = view.state.doc.textContent;
		expect(text).toContain('The num');
		expect(text).toContain('rm');
		expect(text).not.toContain('Back to the outer level');
		view.destroy();
	});

	it('types over such a selection', () => {
		const view = mount('numbering is', 'Term');
		const { from, to } = view.state.selection;
		expect(view.someProp('handleTextInput', (f) => f(view, from, to, 'X', () => view.state.tr))).toBe(true);
		expect(view.state.doc.textContent).toContain('The numX');
		view.destroy();
	});

	it('cuts such a selection: onto the clipboard, then out apart', () => {
		const view = mount('numbering is', 'Term');
		const set: Record<string, string> = {};
		const event = {
			clipboardData: { clearData: () => {}, setData: (type: string, value: string) => (set[type] = value) },
			preventDefault: () => {}
		} as unknown as ClipboardEvent;
		expect(view.someProp('handleDOMEvents', (h) => h.cut?.(view, event))).toBe(true);
		expect(set['text/plain']).toContain('Back to the outer level');
		expect(view.state.doc.textContent).not.toContain('Back to the outer level');
		expect(view.state.doc.textContent).toContain('The num');
		view.destroy();
	});

	it('leaves a selection ProseMirror can join to it', () => {
		const view = mount('numbering is', 'its definition');
		expect(view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'Backspace' }))) ?? false).toBe(false);
		view.destroy();
	});
});
