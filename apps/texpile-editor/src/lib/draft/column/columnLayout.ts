// Where every item of an edited column sits. Two sources, both exact: the engine packing the edited list
// (certifyColumn), or an edit that leaves every box where it was, which TeX's own rules say without asking.
import { TOPSKIP, type ColumnList, type ListItem } from './columnList';
import { sameList } from './bandProof';
import { reInterlineEdge } from './interlineEdge';
import { closingGlue, endsGalley, nextBox } from './columnEdges';

const SAME = 5e-5;
const BASELINESKIP = 2;

export type ColumnLayout = {
	items: ListItem[];
	/** each item's top edge on the page */
	top: number[];
	/** the width each glue and kern was set to (0 for anything else) */
	w: number[];
	bandFrom: number;
	bandLen: number;
};

type Box = Extract<ListItem, { t: 'b' }>;

/** item tops from the column's top, the way vpack lays them out */
export function stackTops(items: ListItem[], w: number[], top: number): number[] {
	const out: number[] = [];
	let cursor = top;
	items.forEach((it, k) => {
		out.push(cursor);
		cursor += it.t === 'b' ? it.h + it.d : w[k];
	});
	return out;
}

/**
 * The edited block's list differs from the old one at most in its first height and last depth, and the glue on
 * each side takes that up: \baselineskip glue that stays \baselineskip, \topskip over a box still shorter
 * than it, the output routine's closing glue under a galley that ends here. Then every box keeps its place, and
 * the page builder sees the same total at every place it could break, as long as neither depth passes \maxdepth.
 * null when any of that fails; the edit then needs the engine.
 */
export function heldLayout(list: ColumnList, from: number, to: number, band: ListItem[], topSkip: number): ColumnLayout | null {
	const old = list.items.slice(from, to + 1);
	const n = band.length;
	if (n !== old.length) return null;
	const o0 = old[0] as Box,
		on = old[n - 1] as Box,
		b0 = band[0] as Box,
		bn = band[n - 1] as Box;
	if (o0.t !== 'b' || on.t !== 'b' || b0.t !== 'b' || bn.t !== 'b') return null;
	const patched = band.map((it, k) =>
		it.t !== 'b' ? it : { ...it, ...(k === 0 ? { h: o0.h } : {}), ...(k === n - 1 ? { d: on.d } : {}) }
	);
	if (!sameList(patched, old)) return null;
	const dh = b0.h - o0.h;
	const dd = bn.d - on.d;
	if (Math.abs(dd) >= SAME && Math.max(on.d, bn.d) > list.maxDepth) return null;
	const items = list.items.slice();
	const w = items.map((it) => (it.t === 'g' || it.t === 'k' ? it.w : 0));
	if (Math.abs(dh) >= SAME) {
		const prev = items[from - 1];
		if (prev?.t !== 'g') return null;
		if (prev.gk === TOPSKIP) {
			if (Math.max(o0.h, b0.h) > topSkip + SAME) return null;
			items[from - 1] = { ...prev, nw: prev.nw - dh };
		} else {
			const g = prev.gk === BASELINESKIP ? reInterlineEdge(prev, dh) : null;
			if (!g || g.gk !== BASELINESKIP) return null;
			items[from - 1] = g;
		}
		w[from - 1] -= dh;
	}
	if (Math.abs(dd) >= SAME) {
		if (endsGalley(list, to)) {
			// a box after the galley (a footnote, a bottom float) sits by the galley's depth
			if (nextBox(list.items, list.galley[1] - 1) >= 0) return null;
			const close = closingGlue(list, on.d, bn.d);
			if (!close) return null;
			items[close.at] = close.glue;
			w[close.at] = close.glue.w;
		} else {
			const nb = nextBox(list.items, to);
			if (nb < 0 || nb >= list.galley[1] || nb - 1 <= to) return null;
			const g = list.items[nb - 1];
			const r = g.t === 'g' && g.gk === BASELINESKIP ? reInterlineEdge(g, dd) : null;
			if (!r || r.gk !== BASELINESKIP) return null;
			items[nb - 1] = r;
			w[nb - 1] -= dd;
		}
	}
	// the same natural list in the same column is set the same way: the band takes the old band's set widths
	items.splice(from, n, ...band);
	const top = stackTops(items, w, list.top);
	for (let k = 0; k < list.items.length; k++) {
		const it = list.items[k];
		const was = it.t === 'b' ? it.y - it.h : it.y;
		if (k < from || k > to) {
			if (Math.abs(top[k] - was) > 2e-3) return null;
			// held, so where the page has it: the sum above only rounds four-decimal widths back together
			top[k] = was;
		} else top[k] = it.t === 'b' ? it.y - (items[k] as Box).h : was;
	}
	return { items, top, w, bandFrom: from, bandLen: n };
}
