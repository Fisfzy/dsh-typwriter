import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { addRowBefore, deleteRow, tableEditing } from 'prosemirror-tables';
import { firstRowHeader } from '$lib/languages/markdown/visual/firstRowHeader';
import { parseMarkdownFile, serializeMarkdownFile } from '$lib/languages/markdown/visual/roundtrip';

const MD = 'Intro.\n\n| Syntax | Note |\n| ------ | ---- |\n| a      | b    |\n| c      | d    |\n\nTail.\n';

function rows(state: EditorState): string[] {
	const out: string[] = [];
	state.doc.descendants((node) => {
		if (node.type.name !== 'table_row') return true;
		out.push(`${node.firstChild!.type.name}:${node.textContent}`);
		return false;
	});
	return out;
}

function inHeader(command: Command): { state: EditorState; file: string; reread: EditorState } {
	const parsed = parseMarkdownFile(MD);
	let state = EditorState.create({ doc: parsed.doc, plugins: [tableEditing(), firstRowHeader] });
	let at = -1;
	state.doc.descendants((node, pos) => {
		if (at < 0 && node.isText && node.text === 'Syntax') at = pos;
		return at < 0;
	});
	state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
	command(state, (tr) => (state = state.apply(tr)));
	const file = serializeMarkdownFile(parsed, state.doc);
	return { state, file, reread: EditorState.create({ doc: parseMarkdownFile(file).doc }) };
}

describe('a markdown table keeps its first row as the header', () => {
	it('a row added above the header becomes the header', () => {
		const { state, reread } = inHeader(addRowBefore);
		expect(rows(state)).toEqual(['table_header:', 'table_cell:SyntaxNote', 'table_cell:ab', 'table_cell:cd']);
		expect(rows(reread)).toEqual(rows(state));
	});

	it('deleting the header makes the next row the header', () => {
		const { state, reread } = inHeader(deleteRow);
		expect(rows(state)).toEqual(['table_header:ab', 'table_cell:cd']);
		expect(rows(reread)).toEqual(rows(state));
	});
});
