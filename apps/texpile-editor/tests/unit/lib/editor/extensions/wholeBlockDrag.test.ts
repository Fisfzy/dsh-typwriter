import { describe, it, expect } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { schema } from '$lib/languages/latex/schema/latexPMSchema';
import { wholeBlockOf } from '$lib/editor/visual/extensions/wholeBlockDrag';

const paragraph = (text: string) => schema.node('paragraph', null, [schema.text(text)]);
const doc = schema.node('doc', null, [paragraph('first'), paragraph('second')]);
const select = (from: number, to: number) => TextSelection.create(doc, from, to);

describe('wholeBlockOf', () => {
	it('is the block when the selection covers all of its text', () => {
		expect(wholeBlockOf(select(8, 14))).toBe(7);
	});

	it('is nothing for part of a block or for text across two blocks', () => {
		expect(wholeBlockOf(select(8, 11))).toBeNull();
		expect(wholeBlockOf(select(1, 14))).toBeNull();
	});

	it('is nothing for the only block of a table cell, which must keep one', () => {
		const cell = schema.node('table_cell', null, [paragraph('only')]);
		const table = schema.node('table', null, [schema.node('table_row', null, [cell])]);
		const withTable = schema.node('doc', null, [table, paragraph('after')]);
		expect(wholeBlockOf(TextSelection.create(withTable, 4, 8))).toBeNull();
	});
});
