// prosemirror-tables' table node view, without the column-drag handlers that normally come with it.
//
// columnResizing() bundles two unrelated things: the mousedown/mousemove handlers that resize a
// column, and the TableView node view that renders the <colgroup> a table needs to lay out at all.
// Dropping the plugin to remove the drag would also remove the view and change how every table
// renders, so the two are separated here.
//
// Why remove the drag: a resize is stored as a `colwidth` cell attr, and NO serializer reads it.
// The column moved on screen, the width never reached the file, and the next parse snapped it back
// - while the document still marked itself dirty and "saved". Dialects that cannot express a column
// width therefore should not offer the handle:
//
//   markdown  never - pipe tables have no width syntax at all
//   latex     not yet - only p{}/tabularx columns have somewhere to put a width; l/c/r would have
//             to be rewritten to p{}, which changes alignment and wrapping, not just size
//   typst     keeps columnResizing(): `columns:` takes real lengths and fr, so a drag has an
//             honest destination (see the colwidth -> columns: work)
import { TableView } from 'prosemirror-tables';
import { Plugin } from 'prosemirror-state';
import type { Node } from 'prosemirror-model';

/** matches columnResizing()'s own default, so table metrics are identical either way. */
const DEFAULT_CELL_MIN_WIDTH = 100;

export const tableViewOnly = new Plugin({
	props: {
		nodeViews: {
			table: (node: Node) => new TableView(node, DEFAULT_CELL_MIN_WIDTH)
		}
	}
});
