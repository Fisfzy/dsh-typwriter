/* eslint-disable @typescript-eslint/no-explicit-any -- page and daemon records are schemaless engine JSON */
// Is the located band the daemon's typeset of the unedited block, exactly? The same lines at
// the same width, holding the same glyphs at the same offsets, with the same boxes, glue,
// kerns and penalties between them. Anything less and the daemon's answer for the edited
// text is not the page's either. Every number compared is one the engine wrote to four
// decimals, so the only tolerance is that rounding.
import type { ListItem } from './columnList';

const SAME = 2e-4;

export type BandProof = {
	/** column items [first, last] of the band's lines */
	from: number;
	to: number;
	/** where the daemon's box origin sits on the page: page line box less daemon line box */
	dx: number;
};

function same(a: number, b: number): boolean {
	return Math.abs(a - b) <= SAME;
}

/** item for item, as a page builder or vpack would see them */
export function sameList(a: ListItem[], b: ListItem[]): boolean {
	return listDiff(a, b) < 0;
}

/** the first item where the two lists part, or -1 */
export function listDiff(a: ListItem[], b: ListItem[]): number {
	for (let k = 0; k < Math.max(a.length, b.length); k++) {
		const x = a[k] as any,
			y = b[k] as any;
		if (!x || !y || x.t !== y.t) return k;
		if (x.t === 'b' && !(same(x.h, y.h) && same(x.d, y.d))) return k;
		if (x.t === 'g' && !(same(x.nw, y.nw) && same(x.st, y.st) && x.sto === y.sto && same(x.sh, y.sh) && x.sho === y.sho && x.gk === y.gk))
			return k;
		if (x.t === 'k' && !same(x.w, y.w)) return k;
		if (x.t === 'p' && x.p !== y.p) return k;
	}
	return -1;
}

// the glyphs a line box holds: the records after it up to the next item of the list it sits on
function glyphsAfter(recs: any[], i: number, end: number): any[] {
	const out: any[] = [];
	for (let j = i + 1; j < end; j++) if (recs[j].t === 'g') out.push(recs[j]);
	return out;
}

function fontSizes(recs: any[]): Map<number, number> {
	const m = new Map<number, number>();
	for (const r of recs) if (r.t === 'font') m.set(r.id, r.size);
	return m;
}

export type ProofRefusal = { refused: string; detail?: Record<string, unknown> };

/**
 * `page` is the column list with the band at [from, to]; `daemon` the daemon's list for the unedited block.
 * A refusal says where the two stop being the same typeset.
 */
export function proveBand(
	pageRecs: any[],
	page: ListItem[],
	from: number,
	to: number,
	daemonRecs: any[],
	daemon: ListItem[]
): BandProof | ProofRefusal {
	const band = page.slice(from, to + 1);
	const at = listDiff(band, daemon);
	if (at >= 0) return { refused: 'list', detail: { at, page: band[at], daemon: daemon[at], lens: [band.length, daemon.length] } };
	const pSize = fontSizes(pageRecs),
		dSize = fontSizes(daemonRecs);
	let dx: number | null = null;
	for (let k = 0; k < band.length; k++) {
		const pb = band[k],
			db = daemon[k];
		if (pb.t !== 'b' || db.t !== 'b') continue;
		const pr = pageRecs[pb.i],
			dr = daemonRecs[db.i];
		// only line boxes carry the width TeX broke them at; any other box proves itself by its list place and size
		if (!pb.line || !db.line) continue;
		if (!same(pr.w, dr.w)) return { refused: 'width', detail: { line: k, page: pr.w, daemon: dr.w } };
		const off = pr.x - (dr.x ?? 0);
		if (dx === null) dx = off;
		else if (!same(off, dx)) return { refused: 'origin', detail: { line: k, off, dx } };
		const pEnd = page[from + k + 1]?.i ?? pageRecs.length;
		const dEnd = daemon[k + 1]?.i ?? daemonRecs.length;
		const pg = glyphsAfter(pageRecs, pb.i, pEnd),
			dg = glyphsAfter(daemonRecs, db.i, dEnd);
		if (pg.length !== dg.length) return { refused: 'glyph-count', detail: { line: k, page: pg.length, daemon: dg.length } };
		for (let g = 0; g < pg.length; g++) {
			const a = pg[g],
				b = dg[g];
			if (a.c !== b.c || !same(pSize.get(a.f) ?? -1, dSize.get(b.f) ?? -2))
				return { refused: 'glyph', detail: { line: k, at: g, page: [a.c, pSize.get(a.f)], daemon: [b.c, dSize.get(b.f)] } };
			if (!same(a.x - pr.x, b.x - (dr.x ?? 0)) || !same(a.y - pr.y, b.y - dr.y))
				return { refused: 'glyph-place', detail: { line: k, at: g, dx: a.x - pr.x - (b.x - (dr.x ?? 0)), dy: a.y - pr.y - (b.y - dr.y) } };
		}
	}
	return dx === null ? { refused: 'no-line' } : { from, to, dx };
}
