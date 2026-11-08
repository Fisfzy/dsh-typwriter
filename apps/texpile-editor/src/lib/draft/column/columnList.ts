/* eslint-disable @typescript-eslint/no-explicit-any -- page records are schemaless engine JSON */
// A column's vertical list, item for item, as the walker wrote it: every box, glue, kern,
// penalty and whatsit the output routine packed into the column box, in list order. The
// engine can pack or break this list again only because nothing on it is inferred: a list
// that does not account for the column's height to the last item is refused.
import type { PageRecord } from '../geometry/geometry.types';

export type ListBox = { t: 'b'; h: number; d: number; y: number; i: number; c?: number; fa?: boolean; line: boolean };
export type ListGlue = {
	t: 'g';
	w: number;
	nw: number;
	st: number;
	sto: number;
	sh: number;
	sho: number;
	gk: number;
	// the \baselineskip width/stretch/shrink, \lineskip width/stretch/shrink and \lineskiplimit this interline glue came from
	il?: number[];
	y: number;
	i: number;
	c?: number;
};
export type ListItem =
	| ListBox
	| ListGlue
	| { t: 'k'; w: number; y: number; i: number; c?: number }
	| { t: 'p'; p: number; y: number; i: number; c?: number }
	| { t: 'x'; y: number; i: number; c?: number };

export type ColumnList = {
	/** the output firing that built the column */
	fire: number;
	x: number;
	w: number;
	top: number;
	/** the height the output routine packed the column to */
	h: number;
	/** the page goal and \maxdepth the page builder broke its galley at */
	goal: number;
	maxDepth: number;
	items: ListItem[];
	/** [from, to) of the galley: what the page builder broke, starting at its \topskip glue */
	galley: [number, number];
	/** the record index that closes the column (its colend) */
	end: number;
};

export const TOPSKIP = 10;
const EPS = 0.01;

// where the column's records start and end in the page's record order
function columnSpan(recs: PageRecord[], fire: number): [number, number] | null {
	const at = (recs as any[]).findIndex((r) => r.t === 'col' && r.i === fire);
	if (at < 0) return null;
	for (let j = at + 1, depth = 0; j < recs.length; j++) {
		const t = (recs[j] as any).t;
		if (t === 'col') depth++;
		else if (t === 'colend' && depth-- === 0) return [at, j];
	}
	return null;
}

/** the column list, or a reason it cannot be read as one */
export function columnList(recs: PageRecord[], fire: number): ColumnList | { refused: string } {
	const span = columnSpan(recs, fire);
	if (!span) return { refused: 'no-column' };
	const col: any = recs[span[0]];
	if (col.g === undefined || col.md === undefined) return { refused: 'no-goal' };
	const top = col.y - col.h;
	let j = span[0] + 1;
	// a one-column page reaches its column down the page's list, and the walker marks that box too
	const own: any = recs[j];
	if (own?.t === 'vbox' && Math.abs(own.y - own.h - top) <= EPS && Math.abs(own.h - col.h) <= EPS) j++;
	const items = readList(recs, j, span[1], top, col.y, col.d);
	if ('refused' in items) return items;
	const inGalley = items.map((it) => it.c === fire);
	const g0 = inGalley.indexOf(true);
	const g1 = inGalley.lastIndexOf(true) + 1;
	if (g0 < 0) return { refused: 'no-galley' };
	for (let k = g0; k < g1; k++) if (!inGalley[k]) return { refused: 'galley-split' };
	// a mark or whatsit reaches an empty page without starting it; the first box brings the \topskip glue
	const first = items.slice(g0, g1).find((it) => it.t !== 'x');
	if (first?.t !== 'g' || first.gk !== TOPSKIP) return { refused: 'no-topskip' };
	return { fire, x: col.x, w: col.w, top, h: col.h, goal: col.g, maxDepth: col.md, items, galley: [g0, g1], end: span[1] };
}

// the items of one vertical list, records [from, to), and a check that they account for it from top to bottom
function readList(
	recs: PageRecord[],
	from: number,
	to: number,
	top: number,
	base: number,
	depth0: number
): ListItem[] | { refused: string } {
	const items: ListItem[] = [];
	let depth = 0;
	for (let j = from; j < to; j++) {
		const r: any = recs[j];
		if (r.t === 'vboxend') {
			depth--;
			continue;
		}
		// every vbox is marked, so what sits inside one is known by depth alone
		if (depth > 0) {
			if (r.t === 'vbox') depth++;
			continue;
		}
		const c = r.c;
		switch (r.t) {
			case 'vbox':
				depth++;
				if (!r.inl) items.push({ t: 'b', h: r.h, d: r.d, y: r.y, i: j, c, fa: r.fa === 1, line: false });
				break;
			case 'pl':
			case 'hb':
				items.push({ t: 'b', h: r.h, d: r.d, y: r.y, i: j, c, fa: r.fa === 1, line: r.t === 'pl' });
				break;
			case 'rule':
				if (r.v) items.push({ t: 'b', h: r.h, d: r.d, y: r.y, i: j, c, fa: r.fa === 1, line: false });
				break;
			case 'vg':
				items.push({ t: 'g', w: r.w, nw: r.nw, st: r.st, sto: r.sto, sh: r.sh, sho: r.sho, gk: r.gk, il: r.il, y: r.y, i: j, c });
				break;
			case 'vk':
				items.push({ t: 'k', w: r.w, y: r.y, i: j, c });
				break;
			case 'pen':
				items.push({ t: 'p', p: r.p, y: r.y, i: j, c });
				break;
			case 'vx':
				items.push({ t: 'x', y: r.y, i: j, c });
				break;
		}
	}
	// the list has to account for the column top to bottom, or something on it went unread
	let cursor = top;
	for (const it of items) {
		if (it.t === 'b') {
			if (Math.abs(it.y - it.h - cursor) > EPS) return { refused: 'list-gap' };
			cursor = it.y + it.d;
		} else {
			if (Math.abs(it.y - cursor) > EPS) return { refused: 'list-gap' };
			if (it.t === 'g' || it.t === 'k') cursor += it.w;
		}
	}
	// to the box's bottom, or to its baseline where the box's depth was capped
	if (Math.abs(cursor - (base + depth0)) > EPS && Math.abs(cursor - base) > EPS) return { refused: 'list-short' };
	return items;
}

/** the list inside a vbox the page's list holds (a float placed in the text), its record index `at` */
export function innerList(recs: PageRecord[], at: number): ListItem[] | { refused: string } {
	const box: any = recs[at];
	if (box?.t !== 'vbox') return { refused: 'no-box' };
	for (let j = at + 1, depth = 0; j < recs.length; j++) {
		const t = (recs[j] as any).t;
		if (t === 'vbox') depth++;
		else if (t === 'vboxend' && depth-- === 0) return readList(recs, at + 1, j, box.y - box.h, box.y, box.d);
	}
	return { refused: 'no-box-end' };
}
