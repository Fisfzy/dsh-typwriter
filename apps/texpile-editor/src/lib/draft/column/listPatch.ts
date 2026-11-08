/* eslint-disable @typescript-eslint/no-explicit-any -- page and daemon records are schemaless engine JSON */
// A patch in the page's own list order. Every record of a list belongs to one item of it (a box and the ink
// inside it, or a glue, kern, penalty or mark), so an item that leaves takes exactly its records, and an item
// that stays moves them all by its own displacement. Nothing is placed by a window of y.
import { glyphRows } from '../geometry/glyphRows';
import type { ListItem } from './columnList';
import type { ColumnLayout } from './columnLayout';
import type { Patch, RecordMove, RecordSplice } from '../patch/patch.types';

const MOVED = 1e-5;
const INTERLINE = new Set([1, 2]);

/** the daemon's typeset of the edited block: its records, its list from first line to last, and where they end */
export type DaemonBand = { recs: any[]; items: ListItem[]; end: number };

/** what the engine stamped on the replaced block's lines: its source line (the paragraph's start), its paragraph, a float anchored after it */
export type SourceStamp = { s?: number; sf?: number; pi?: number; fa?: boolean };

/** the list the block sits on: a column's, or a float box's (which has no firing of its own) */
export type HostList = { items: ListItem[]; end: number; x: number; w: number; fire?: number };

/** where each item of the new list sits */
export type ItemPlaces = { items: ListItem[]; top: number[]; w: number[] };

export function topOf(it: ListItem): number {
	return it.t === 'b' ? it.y - it.h : it.y;
}

/** the records of item k of `items`: its own and the ink after it, up to the next item's */
export function itemRecords(items: ListItem[], k: number, listEnd: number): [number, number] {
	return [items[k].i, items[k + 1]?.i ?? listEnd];
}

/**
 * `map`: the old item's index in the new list, or null when it leaves this list. `inserts` are the records that
 * come in, each before the page record at `at`.
 */
export function mappedPatch(
	recs: any[],
	host: HostList,
	map: (k: number) => number | null,
	places: ItemPlaces,
	inserts: { at: number; recs: any[] }[]
): Patch {
	const moves: RecordMove[] = [];
	const drops: [number, number][] = [];
	const at = new Map<number, number>();
	for (let k = 0; k < host.items.length; k++) {
		const it = host.items[k];
		const [from, to] = itemRecords(host.items, k, host.end);
		const m = map(k);
		if (m === null) {
			const last = drops[drops.length - 1];
			if (last && last[1] === from) last[1] = to;
			else drops.push([from, to]);
			continue;
		}
		const dy = places.top[m] - topOf(it);
		const now = places.items[m];
		const reset = it.t === 'g' && now.t === 'g' && (Math.abs(places.w[m] - it.w) > MOVED || Math.abs(now.nw - it.nw) > MOVED);
		if (Math.abs(dy) <= MOVED && !reset) continue;
		moves.push({
			from,
			to,
			dy,
			...(reset && now.t === 'g' ? { w: places.w[m], nw: now.nw, st: now.st, sh: now.sh, gk: now.gk } : {})
		});
		for (let j = from; j < to; j++) at.set(j, dy);
	}
	// the patch's claim about the rows it moves without redrawing, graded against the next compile
	const moved = recs.flatMap((r, j) => (r.t === 'g' && at.has(j) ? [{ ...r, y: r.y + at.get(j)! }] : []));
	const flowPred = glyphRows(moved, 12)
		.slice(0, 16)
		.map((rw) => ({ y: rw.y, cs: rw.cs }));
	const splices: RecordSplice[] = drops.map(([from, to]) => ({ from, to, recs: [] as any[] }));
	for (const ins of inserts) {
		const at = splices.find((sp) => sp.from === ins.at);
		if (at) at.recs.push(...ins.recs);
		else splices.push({ from: ins.at, to: ins.at, recs: [...ins.recs] });
	}
	splices.sort((a, b) => a.from - b.from || a.to - b.to);
	const ink = inserts.flatMap((ins) => ins.recs).filter((r) => r.t !== 'font' && r.y !== undefined);
	const bandTop = ink.length ? Math.min(...ink.map((r) => r.y - (r.h ?? 0))) : 0;
	const bandBottom = ink.length ? Math.max(...ink.map((r) => r.y + (r.d ?? 0))) : 0;
	return {
		splices,
		moves,
		band: { top: bandTop, bottom: bandBottom, colL: host.x, colR: host.x + host.w },
		flowPred
	};
}

/** the daemon's records for the edited block, placed as the new list has its items */
export function bandRecords(
	host: HostList,
	daemon: DaemonBand,
	places: ItemPlaces,
	bandFrom: number,
	dx: number,
	stamp: SourceStamp,
	il?: number[]
): any[] {
	const out: any[] = [];
	const d = daemon.items;
	const lastBox = d.findLastIndex((it) => it.t === 'b');
	let owner = -1;
	for (let j = d[0].i; j < daemon.end; j++) {
		const r = daemon.recs[j];
		if (r.t === 'endx' || r.t === 'font') continue;
		while (owner + 1 < d.length && d[owner + 1].i <= j) owner++;
		const it = d[owner];
		const m = bandFrom + owner;
		const rec: any = { ...r };
		if (rec.x !== undefined) rec.x += dx;
		if (it.t === 'b') {
			if (rec.y !== undefined) rec.y += places.top[m] + it.h - it.y;
		} else if (j === it.i) {
			rec.y = places.top[m];
			if (it.t === 'g') {
				rec.w = places.w[m];
				if (INTERLINE.has(it.gk) && il) rec.il = il;
			}
		}
		if (j === it.i) {
			if (host.fire !== undefined) rec.c = host.fire;
			if (rec.t === 'line') {
				rec.t = 'pl';
				for (const k of ['n', 'gset', 'gsign', 'gord', 'rdw']) delete rec[k];
				if (stamp.s !== undefined) rec.s = stamp.s;
				if (stamp.sf !== undefined) rec.sf = stamp.sf;
				if (stamp.pi !== undefined) rec.pi = stamp.pi;
			}
			// a float anchored after the old block is anchored after the new one
			if (stamp.fa && owner === lastBox) rec.fa = 1;
		}
		out.push(rec);
	}
	for (const r of daemon.recs) if (r.t === 'font') out.push(r);
	return out;
}

/** the edited block in place of items [from, to], everything else where the layout puts it */
export function listPatch(
	recs: any[],
	host: HostList,
	from: number,
	to: number,
	layout: ColumnLayout,
	daemon: DaemonBand,
	dx: number,
	stamp: SourceStamp
): Patch {
	const shift = layout.bandLen - (to - from + 1);
	const near = host.items.slice(Math.max(0, from - 1), to + 1);
	// the paragraph's own interline parameters, for its glue in the store
	const il = (near.find((it) => it.t === 'g' && INTERLINE.has(it.gk) && it.il) as any)?.il as number[] | undefined;
	return mappedPatch(recs, host, (k) => (k < from ? k : k > to ? k + shift : null), layout, [
		{ at: host.items[from].i, recs: bandRecords(host, daemon, layout, layout.bandFrom, dx, stamp, il) }
	]);
}
