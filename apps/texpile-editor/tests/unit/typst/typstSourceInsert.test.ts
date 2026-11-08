// the typst source toolbar's newest helpers; the older ones are exercised through the
// visual-roundtrip and toolbar paths
import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection, type TransactionSpec } from '@codemirror/state';
import { computeWrap, computeHr } from '$lib/languages/typst/source/sourceInsert';

function state(doc: string, anchor: number, head = anchor) {
	return EditorState.create({ doc, selection: EditorSelection.range(anchor, head) });
}
function apply(s: EditorState, spec: TransactionSpec) {
	return s.update(spec).state.doc.toString();
}

describe('computeWrap', () => {
	it('wraps a selection in an asymmetric pair', () => {
		const s = state('hello world', 0, 5);
		expect(apply(s, computeWrap(s, '#underline[', ']'))).toBe('#underline[hello] world');
	});
	it('empty cursor gets the pair with the caret inside', () => {
		const s = state('ab', 1);
		const next = s.update(computeWrap(s, '#super[', ']')).state;
		expect(next.doc.toString()).toBe('a#super[]b');
		expect(next.selection.main.head).toBe(8); // inside the brackets
	});
	it('handles multiple selections right-to-left', () => {
		const s = EditorState.create({
			doc: 'one two',
			selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(4, 7)]),
			extensions: EditorState.allowMultipleSelections.of(true)
		});
		expect(apply(s, computeWrap(s, '#sub[', ']'))).toBe('#sub[one] #sub[two]');
	});
});

describe('computeHr', () => {
	it('inserts a line on its own lines after the cursor line', () => {
		const s = state('text', 2);
		expect(apply(s, computeHr(s))).toBe('text\n\n#line(length: 100%)\n');
	});
	it('no leading gap on an empty line', () => {
		const s = state('', 0);
		expect(apply(s, computeHr(s))).toBe('#line(length: 100%)\n');
	});
});
