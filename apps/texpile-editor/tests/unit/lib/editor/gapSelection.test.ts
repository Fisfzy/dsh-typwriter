// The landing zone for a caret leaving an embedded editor, now that no synthetic trailing
// paragraph exists: a real textblock neighbor still wins, and where there is none the selection
// must be a gap cursor - Selection.near alone would node-select the block just exited (whose
// selectNode bounces the caret back inside) or land back within it.
import { describe, it, expect } from 'vitest';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import { GapCursor } from 'prosemirror-gapcursor';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '$lib/languages/latex/schema/latexPMSchema';
import { gapAwareSelectionNear } from '$lib/editor/visual/gapSelection';

function doc(...children: PMNode[]): PMNode {
	return schema.nodes.doc.create(null, children);
}
const math = () => schema.nodes.block_math.create(null, [schema.text(' ')]);
const code = () => schema.nodes.code_block.create(null, [schema.text('x')]);
const raw = () => schema.nodes.raw_latex.create(null, [schema.text('\\vspace{1em}')]);
const para = (text = 'hi') => schema.nodes.paragraph.create(null, text ? [schema.text(text)] : []);
const tableWithNotes = () =>
	schema.nodes.table_wrapper.create({ showNotes: true }, [
		schema.nodes.table_caption.create(null, [schema.text('c')]),
		schema.nodes.table.create(null, [schema.nodes.table_row.create(null, [schema.nodes.table_cell.create(null, [para('a')])])]),
		schema.nodes.table_notes.create(null, [schema.text('note')])
	]);

function exitForward(d: PMNode, node: PMNode) {
	// position after the doc's first child, the exit target of its node view
	return gapAwareSelectionNear(d.resolve(node.nodeSize), 1);
}

describe('gapAwareSelectionNear', () => {
	it('a following paragraph still wins over a gap cursor', () => {
		const m = math();
		const sel = exitForward(doc(m, para()), m);
		expect(sel).toBeInstanceOf(TextSelection);
		expect(sel).not.toBeInstanceOf(GapCursor);
	});

	it('exiting a document-final equation lands on a gap cursor, not back on the node', () => {
		const d = doc(para(), math());
		const after = gapAwareSelectionNear(d.resolve(d.content.size), 1);
		expect(after).toBeInstanceOf(GapCursor);
		expect(after).not.toBeInstanceOf(NodeSelection);
	});

	it('exiting between two adjacent equations lands in the gap between them', () => {
		const m = math();
		const sel = exitForward(doc(m, math()), m);
		expect(sel).toBeInstanceOf(GapCursor);
	});

	it('backward exit from a document-leading equation reaches a gap cursor (the old bounce)', () => {
		const d = doc(math(), para());
		const sel = gapAwareSelectionNear(d.resolve(0), -1);
		expect(sel).toBeInstanceOf(GapCursor);
		expect(sel).not.toBeInstanceOf(NodeSelection);
	});

	it('document-final code and raw blocks admit the gap (createGapCursor)', () => {
		for (const island of [code(), raw()]) {
			const d = doc(para(), island);
			const sel = gapAwareSelectionNear(d.resolve(d.content.size), 1);
			expect(sel, island.type.name).toBeInstanceOf(GapCursor);
		}
	});

	it('a trailing table with visible notes admits the gap (no valid position existed before)', () => {
		const d = doc(para(), tableWithNotes());
		const sel = gapAwareSelectionNear(d.resolve(d.content.size), 1);
		expect(sel).toBeInstanceOf(GapCursor);
	});
});
