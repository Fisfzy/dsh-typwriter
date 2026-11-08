// Where a column's galley meets what is around it: the next box, whether the galley ends on a box, and the
// glue LaTeX's output routine closes the column with.
import type { ColumnList, ListGlue, ListItem } from './columnList';

const SAME = 5e-5;

/** the galley's box ends with this box's depth: nothing after it in the galley but penalties and marks */
export function endsGalley(list: ColumnList, k: number): boolean {
	return list.items.slice(k + 1, list.galley[1]).every((it) => it.t === 'p' || it.t === 'x');
}

/** the index of the first box after `k`, or -1 */
export function nextBox(items: ListItem[], k: number): number {
	for (let j = k + 1; j < items.length; j++) if (items[j].t === 'b') return j;
	return -1;
}

// \@makecol closes the column with \vskip-\dimen@, the depth of the galley's box: when the galley ends on the
// block, that glue follows the block's last depth (capped at \maxdepth, as the page builder packs \box255)
export function closingGlue(list: ColumnList, oldD: number, newD: number): { at: number; glue: ListGlue } | null {
	const at = list.galley[1];
	const g = list.items[at];
	if (g?.t !== 'g' || Math.abs(g.nw + Math.min(oldD, list.maxDepth)) > SAME) return null;
	const nw = -Math.min(newD, list.maxDepth);
	return { at, glue: { ...g, nw, w: g.w + (nw - g.nw) } };
}

/** the depth a box packed from these items has: its last box's, unless glue or a kern follows it */
export function galleyDepth(items: ListItem[]): number {
	for (let k = items.length - 1; k >= 0; k--) {
		const it = items[k];
		if (it.t === 'b') return it.d;
		if (it.t === 'g' || it.t === 'k') return 0;
	}
	return 0;
}

/** what follows a galley that now holds `galley`: the output routine's closing glue follows its new depth */
export function closingFor(list: ColumnList, after: ListItem[], galley: ListItem[]): ListItem[] | null {
	const oldD = galleyDepth(list.items.slice(list.galley[0], list.galley[1]));
	const newD = galleyDepth(galley);
	if (Math.abs(newD - oldD) < SAME) return after;
	const g = after[0];
	if (g?.t !== 'g' || Math.abs(g.nw + Math.min(oldD, list.maxDepth)) > SAME) return null;
	const nw = -Math.min(newD, list.maxDepth);
	return [{ ...g, nw, w: g.w + (nw - g.nw) }, ...after.slice(1)];
}
