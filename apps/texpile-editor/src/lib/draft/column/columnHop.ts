/* eslint-disable @typescript-eslint/no-explicit-any -- page records are schemaless engine JSON */
// The edit moved the page break, and the next column takes up the difference. Rendered only as far as the
// engine answers for it:
//   carry: the engine ends this galley earlier, and what no longer fits starts the next column, under the
//     page builder's own \topskip; the next column must still break where it did with it on top
//   pull: the engine ends this galley later, taking the next column's first lines back; what stays there
//     starts it afresh, and it must still break where it did with less on it
// Both columns are then packed again. A next column that would break elsewhere is a chain, and chains are
// the full pass.
import { TOPSKIP, type ColumnList, type ListItem } from './columnList';
import { columnListOf } from './columnListOf';
import { contributedGalley, skeletonItems } from './columnSkeleton';
import { calibrate, type SplitSkeleton } from './columnCertificate';
import { columnTail, nextColumn, seamList, type TailDeps } from './columnTail';
import { closingFor } from './columnEdges';
import type { EditedList } from './editedList';
import type { ColumnLayout } from './columnLayout';

export type HopDeps = TailDeps & { split: SplitSkeleton; pageIsRtl: (p: number) => boolean };

type Receiver = { page: number; list: ColumnList; items: ListItem[]; top: number[]; w: number[] };

export type HopLayouts = {
	a: { list: ColumnList; items: ListItem[]; layout: ColumnLayout; galleyEnd: number };
	b: Receiver;
	/** carry: the items that left for the receiver. pull: the items that came from it, and how many of its own */
	moved: ListItem[];
	pulledOwn?: number;
};

const DISCARDABLE = new Set(['g', 'k', 'p']);

/** where each item of a list starts the page: its index in pageTop's answer, or null when discarded */
export function pageTopMap(items: ListItem[]): (number | null)[] {
	const first = items.findIndex((it) => it.t === 'b');
	let kept = 0;
	return items.map((it, j) => {
		if (j < first) return DISCARDABLE.has(it.t) ? null : kept++;
		return kept + 1 + (j - first);
	});
}

// what the page builder keeps of the material after a break: glue, kerns and penalties before the first box
// are discarded, marks and whatsits are contributed, and the first box brings the \topskip glue
export function pageTop(items: ListItem[]): ListItem[] | null {
	const first = items.findIndex((it) => it.t === 'b');
	if (first < 0) return null;
	const kept = items.slice(0, first).filter((it) => !DISCARDABLE.has(it.t));
	const top: ListItem = { t: 'g', w: 0, nw: 0, st: 0, sto: 0, sh: 0, sho: 0, gk: TOPSKIP, y: 0, i: -1 };
	return [...kept, top, ...items.slice(first)];
}

function positions(list: ColumnList, iy: number[], items: ListItem[], end: number) {
	const top = iy.map((y) => list.top + y);
	const w = items.map((it, k) => (it.t === 'g' || it.t === 'k' ? (iy[k + 1] ?? end) - iy[k] : 0));
	return { top, w };
}

function boxes(items: ListItem[]): number {
	return items.filter((it) => it.t === 'b').length;
}

// the next column, if the engine can speak for it: readable, calibrated, no float anchored in it, no footnotes
async function receiver(deps: HopDeps, page: number, fire: number) {
	const next = nextColumn(deps, page, fire);
	if (!next || deps.pageIsRtl(next.page)) return { refused: 'no-receiver' };
	const recs = deps.pageRecords(next.page) as any[];
	const list = columnListOf(recs, next.fire);
	if ('refused' in list) return { refused: 'receiver-' + list.refused };
	// a mark or whatsit that reached the receiver before its first box would sit elsewhere once its top changes
	const opening = list.items[list.galley[0]];
	if (opening.t !== 'g' || opening.gk !== TOPSKIP) return { refused: 'receiver-marks' };
	for (let k = list.galley[0]; k < list.galley[1]; k++) {
		const it = list.items[k];
		if (it.t === 'b' && it.fa) return { refused: 'receiver-float-anchor' };
	}
	if (list.items.some((it, k) => it.t === 'b' && it.line && (k < list.galley[0] || k >= list.galley[1]) && recs[it.i]?.c === undefined))
		return { refused: 'receiver-footnote' };
	const tail = columnTail(deps, next.page, next.fire);
	if ('refused' in tail) return { refused: 'receiver-' + tail.refused };
	const cal = await calibrate(deps.split, list, tail);
	if (cal) return { refused: 'receiver-' + cal };
	return { page: next.page, list, tail };
}

// the receiver with a new galley: it must break where it did, and it is packed again
async function settle(
	deps: HopDeps,
	r: { page: number; list: ColumnList; tail: any[] },
	galley: ListItem[]
): Promise<Receiver | { refused: string }> {
	const br = await deps.split([...skeletonItems(galley), ...r.tail], r.list.goal, { maxDepth: r.list.maxDepth });
	if (!br.ok) return { refused: 'receiver-break:' + br.error };
	if (br.kA !== boxes(galley)) return { refused: 'chain' };
	const items = [...r.list.items.slice(0, r.list.galley[0]), ...galley, ...r.list.items.slice(r.list.galley[1])];
	const pk = await deps.split(skeletonItems(items), r.list.h, { pack: true });
	if (!pk.ok || pk.iy.length !== items.length) return { refused: 'receiver-pack' };
	return { page: r.page, list: r.list, items, ...positions(r.list, pk.iy, items, pk.end) };
}

// the source column with a new galley, closed by the output routine for its new last depth, packed again
async function source(deps: HopDeps, list: ColumnList, edited: EditedList, galley: ListItem[]) {
	const after = closingFor(list, edited.items.slice(edited.galley[1]), galley);
	if (!after) return { refused: 'closing-glue' };
	const items = [...edited.items.slice(0, edited.galley[0]), ...galley, ...after];
	const pk = await deps.split(skeletonItems(items), list.h, { pack: true });
	if (!pk.ok || pk.iy.length !== items.length) return { refused: 'source-pack' };
	const p = positions(list, pk.iy, items, pk.end);
	return {
		list,
		items,
		layout: { items, top: p.top, w: p.w, bandFrom: edited.bandFrom, bandLen: edited.bandLen },
		galleyEnd: edited.galley[0] + galley.length
	};
}

/** nA: the nodes the engine keeps in this column, of the edited galley and what followed it */
export async function hopColumn(
	deps: HopDeps,
	page: number,
	list: ColumnList,
	edited: EditedList,
	nA: number
): Promise<HopLayouts | { refused: string }> {
	const galley = edited.items.slice(edited.galley[0], edited.galley[1]);
	const r = await receiver(deps, page, list.fire);
	if ('refused' in r) return r as { refused: string };
	if (nA < galley.length) {
		const bandEnd = edited.bandFrom - edited.galley[0] + edited.bandLen;
		if (nA <= bandEnd) return { refused: 'break-in-band' };
		const carried = pageTop(galley.slice(nA));
		if (!carried) return { refused: 'nothing-carried' };
		const seam = seamList(deps, page, list.fire);
		if (!seam) return { refused: 'no-seam' };
		// the receiver's galley: the carried items, the old break's discarded run (mid-page now, so kept), its own
		const b = await settle(deps, r, [...carried, ...seam, ...contributedGalley(r.list)]);
		if ('refused' in b) return b;
		const a = await source(deps, list, edited, galley.slice(0, nA));
		if ('refused' in a) return a as { refused: string };
		return { a, b, moved: carried };
	}
	// pull: the old break's discarded run, then the receiver's first items, now end this galley
	const seam = seamList(deps, page, list.fire);
	if (!seam) return { refused: 'no-seam' };
	const own = contributedGalley(r.list);
	const pulledOwn = nA - galley.length - seam.length;
	if (pulledOwn <= 0 || pulledOwn >= own.length) return { refused: 'pull-extent' };
	const rest = pageTop(own.slice(pulledOwn));
	if (!rest) return { refused: 'pulled-all' };
	const b = await settle(deps, r, rest);
	if ('refused' in b) return b;
	const pulled = [...seam, ...own.slice(0, pulledOwn)];
	const a = await source(deps, list, edited, [...galley, ...pulled]);
	if ('refused' in a) return a as { refused: string };
	return { a, b, moved: pulled, pulledOwn };
}
