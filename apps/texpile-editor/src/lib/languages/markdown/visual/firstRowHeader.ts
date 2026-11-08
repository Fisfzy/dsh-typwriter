// a pipe table's header is its first row, whichever row stands there: one added above it, or the
// one after it once it is deleted. The cells follow, so the editor shows the header the file will have
import { Plugin, type Transaction } from 'prosemirror-state';
import type { Node as PMNode, NodeType } from 'prosemirror-model';

function fixTable(tr: Transaction, table: PMNode, pos: number, header: NodeType, cell: NodeType): void {
	table.forEach((row, rowOffset, r) => {
		const want = r === 0 ? header : cell;
		row.forEach((c, cellOffset) => {
			if (c.type !== want) tr.setNodeMarkup(pos + 1 + rowOffset + 1 + cellOffset, want, c.attrs, c.marks);
		});
	});
}

export const firstRowHeader = new Plugin({
	appendTransaction(trs, oldState, state) {
		if (!trs.some((t) => t.docChanged)) return null;
		const { table_header: header, table_cell: cell } = state.schema.nodes;
		if (!header || !cell) return null;
		const before = new Set(oldState.doc.children);
		const tr = state.tr;
		state.doc.forEach((top, topPos) => {
			if (before.has(top)) return;
			if (top.type.spec.tableRole === 'table') return fixTable(tr, top, topPos, header, cell);
			top.descendants((node, pos) => {
				if (node.type.spec.tableRole === 'table') fixTable(tr, node, topPos + 1 + pos, header, cell);
				return !node.isTextblock && node.type.spec.tableRole !== 'table';
			});
		});
		return tr.docChanged ? tr : null;
	}
});
