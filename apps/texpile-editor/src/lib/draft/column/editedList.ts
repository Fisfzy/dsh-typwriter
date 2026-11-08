// The column list with the edited block in place of the old one. The glue TeX put between the block and its
// neighbours was computed from the old block's first height and last depth, so it is recomputed by TeX's own
// rule; the \topskip glue over a column's first box is left to the engine (skeletonItems sends it as `t`).
import { TOPSKIP, type ColumnList, type ListItem } from './columnList';
import { isInterline, reInterlineEdge } from './interlineEdge';
import { closingGlue, endsGalley, nextBox } from './columnEdges';

const SAME = 5e-5;

export type EditedList = {
	items: ListItem[];
	/** where the new block starts in `items`, and how many items it has */
	bandFrom: number;
	bandLen: number;
	galley: [number, number];
};

type Box = Extract<ListItem, { t: 'b' }>;

export function editedList(list: ColumnList, from: number, to: number, band: ListItem[]): EditedList | { refused: string } {
	const items = list.items.slice();
	const first = items[from] as Box,
		last = items[to] as Box;
	const bFirst = band[0] as Box,
		bLast = band[band.length - 1] as Box;
	if (first?.t !== 'b' || last?.t !== 'b' || bFirst?.t !== 'b' || bLast?.t !== 'b') return { refused: 'band-edges' };
	const dh = bFirst.h - first.h;
	const dd = bLast.d - last.d;
	if (Math.abs(dh) >= SAME) {
		const prev = items[from - 1];
		// none, or not interline glue: TeX put no glue over the box, and will not
		if (prev?.t === 'g' && prev.gk !== TOPSKIP && isInterline(prev)) {
			const g = reInterlineEdge(prev, dh);
			if (!g) return { refused: 'interline-above' };
			items[from - 1] = g;
		}
	}
	if (Math.abs(dd) >= SAME) {
		const nb = nextBox(items, to);
		if (endsGalley(list, to)) {
			const close = closingGlue(list, last.d, bLast.d);
			if (close) items[close.at] = close.glue;
		} else if (nb > 0 && nb < list.galley[1]) {
			const g = items[nb - 1];
			if (nb - 1 > to && g.t === 'g' && isInterline(g)) {
				const r = reInterlineEdge(g, dd);
				if (!r) return { refused: 'interline-below' };
				items[nb - 1] = r;
			}
		}
	}
	items.splice(from, to - from + 1, ...band);
	const shift = band.length - (to - from + 1);
	return { items, bandFrom: from, bandLen: band.length, galley: [list.galley[0], list.galley[1] + shift] };
}
