// text taken out of a container lands as a paragraph: the box is context for what is put into it, not
// a wrapper that travels with its text (a defining node would come along on a drop between blocks)
import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { schema } from '$lib/languages/latex/schema/latexPMSchema';

const paragraph = (text: string) => schema.node('paragraph', null, [schema.text(text)]);

describe('dragging text out of a container', () => {
	it.each(['abstract', 'environment', 'blockquote'])('lands as a paragraph after the last block, out of a %s', (container) => {
		const box = schema.node(container, null, [paragraph('box text')]);
		const doc = schema.node('doc', null, [box, paragraph('after')]);
		const tr = EditorState.create({ doc }).tr;
		// a drag carries the selection's content, open through its ancestors, as Selection.content() does
		tr.replaceRange(doc.content.size, doc.content.size, doc.slice(2, 5, true));
		expect(tr.doc.lastChild?.type.name).toBe('paragraph');
		expect(tr.doc.lastChild?.textContent).toBe('box');
		expect(tr.doc.childCount).toBe(3);
	});
});
