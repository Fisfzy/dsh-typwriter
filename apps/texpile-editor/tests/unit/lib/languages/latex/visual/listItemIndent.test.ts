import { it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '$lib/languages/latex/schema/latexPMSchema';
import { wrapInListItems } from '$lib/languages/latex/visual/listItemIndent';

function marked(text: string): PMNode {
	return schema.nodes.paragraph.create({ indent: 'noindent' }, schema.text(text));
}

function indentsAfter(doc: PMNode, caret: number, kind: 'bullet' | 'ordered'): string[] {
	let state = EditorState.create({ doc, selection: TextSelection.create(doc, caret) });
	wrapInListItems({ kind })(state, (tr) => (state = state.apply(tr)));
	const indents: string[] = [];
	state.doc.descendants((node, _pos, parent) => {
		if (node.type.name === 'paragraph') indents.push(`${parent?.type.name}:${node.attrs.indent}`);
	});
	return indents;
}

it('drops the mark from a paragraph that becomes a list item', () => {
	expect(indentsAfter(schema.nodes.doc.create(null, [marked('into a list')]), 3, 'bullet')).toEqual(['list:auto']);
});

it('keeps the mark on an item that already had it when only its kind changes', () => {
	const item = schema.nodes.list.create({ kind: 'bullet' }, marked('from the source'));
	expect(indentsAfter(schema.nodes.doc.create(null, [item]), 4, 'ordered')).toEqual(['list:noindent']);
});
