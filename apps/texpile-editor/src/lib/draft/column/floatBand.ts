/* eslint-disable @typescript-eslint/no-explicit-any -- page records are schemaless engine JSON */
// An edit inside a float: the block sits on the float box's own list, not the column's. The output routine
// placed the float by its size, so the edit renders only when the block's list comes out the same, every box
// the same size: then the float is the same box and nothing on the page, or in it, moves.
import { innerList, type ListItem } from './columnList';
import { sameList } from './bandProof';
import { holdingBox } from './holdingBox';
import type { ColumnLayout } from './columnLayout';
import type { Cal } from '../locate/locate.types';

export type FloatBand = { items: ListItem[]; from: number; to: number; x: number; w: number; end: number };

export function findFloatBand(recs: any[], cal: Cal): FloatBand | { refused: string } {
	// the innermost box holding the rows: the column's own box holds them too
	const boxes: number[] = [];
	recs.forEach((r, at) => {
		if (r.t !== 'vbox' || r.sm || r.x + r.w < cal.colL || r.x > cal.colR) return;
		if (r.y - r.h <= cal.b1 && r.y + r.d >= cal.bk) boxes.push(at);
	});
	// a float is a box around a box of its own size: the deeper one holds the list
	boxes.sort((a, b) => recs[a].h + recs[a].d - (recs[b].h + recs[b].d) || b - a);
	for (const at of boxes) {
		const r = recs[at];
		const items = innerList(recs, at);
		if ('refused' in items) continue;
		const from = holdingBox(items, cal.b1),
			to = holdingBox(items, cal.bk);
		// the list the block's own lines sit on: a table's rows are one list deeper, and a box can hold a box
		// taller than itself, so size alone does not say which box is innermost
		if (from < 0 || to < from || ![items[from], items[to]].every((it) => it.t === 'b' && it.line)) continue;
		const end = items[to + 1]?.i ?? closeOf(recs, at);
		return { items, from, to, x: r.x, w: r.w, end };
	}
	return { refused: 'float-band' };
}

function closeOf(recs: any[], at: number): number {
	for (let j = at + 1, depth = 0; j < recs.length; j++) {
		if (recs[j].t === 'vbox') depth++;
		else if (recs[j].t === 'vboxend' && depth-- === 0) return j;
	}
	return recs.length;
}

/** the float's list with the edited block in place, every item where it was; null unless the block's list is the same */
export function floatLayout(f: FloatBand, band: ListItem[]): ColumnLayout | null {
	if (!sameList(band, f.items.slice(f.from, f.to + 1))) return null;
	const items = f.items.slice();
	items.splice(f.from, f.to - f.from + 1, ...band);
	const top = f.items.map((it) => (it.t === 'b' ? it.y - it.h : it.y));
	const w = f.items.map((it) => (it.t === 'g' || it.t === 'k' ? it.w : 0));
	return { items, top, w, bandFrom: f.from, bandLen: band.length };
}
