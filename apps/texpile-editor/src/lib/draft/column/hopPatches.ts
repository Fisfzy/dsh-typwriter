/* eslint-disable @typescript-eslint/no-explicit-any -- page records are schemaless engine JSON */
// The two patches a moved break paints. Items that change column keep their own records, moved to where the
// other column packs them; the old break's discarded run, which no page carried, is written out where it now
// stands; so is the \topskip glue the page builder puts over a column's new first box.
import { TOPSKIP, type ListItem } from './columnList';
import { bandRecords, itemRecords, mappedPatch, topOf, type DaemonBand, type SourceStamp } from './listPatch';
import { pageTopMap } from './columnHop';
import type { EditedList } from './editedList';
import type { HopLayouts } from './columnHop';
import type { Patch } from '../patch/patch.types';

const INTERLINE = new Set([1, 2]);

type Placed = { list: { x: number; fire: number }; items: ListItem[]; top: number[]; w: number[] };

// records for items that come into a column: their own records moved there, or written out when they had none
function incoming(from: { recs: any[]; list: { items: ListItem[]; end: number; x: number } }, to: Placed, span: [number, number]): any[] {
	const indexOf = new Map(from.list.items.map((it, k) => [it.i, k]));
	const out: any[] = [];
	for (let m = span[0]; m < span[1]; m++) {
		const it = to.items[m];
		const top = to.top[m];
		const k = it.i >= 0 ? indexOf.get(it.i) : undefined;
		if (k !== undefined) {
			const [a, b] = itemRecords(from.list.items, k, from.list.end);
			const dy = top - topOf(from.list.items[k]);
			for (let j = a; j < b; j++) {
				const r = from.recs[j];
				if (r.t === 'font') continue;
				const rec: any = { ...r };
				if (rec.x !== undefined) rec.x += to.list.x - from.list.x;
				if (rec.y !== undefined) rec.y += dy;
				if (j === a) {
					rec.c = to.list.fire;
					if (rec.t === 'vg') rec.w = to.w[m];
				}
				out.push(rec);
			}
			continue;
		}
		const c = to.list.fire;
		if (it.t === 'g') {
			const w = to.w[m];
			out.push({
				t: 'vg',
				x: to.list.x,
				y: top,
				w,
				nw: it.gk === TOPSKIP ? w : it.nw,
				st: it.st,
				sto: it.sto,
				sh: it.sh,
				sho: it.sho,
				gk: it.gk,
				c
			});
		} else if (it.t === 'k') out.push({ t: 'vk', y: top, w: it.w, c });
		else if (it.t === 'p') out.push({ t: 'pen', y: top, p: it.p, c });
		else if (it.t === 'x') out.push({ t: 'vx', y: top, c });
	}
	// the other page's fonts, which the moved glyphs name
	for (const r of from.recs) if (r.t === 'font') out.push(r);
	return out;
}

export function hopPatches(
	recsA: any[],
	recsB: any[],
	hop: HopLayouts,
	edited: EditedList,
	band: { from: number; to: number },
	daemon: DaemonBand,
	dx: number,
	stamp: SourceStamp
): { a: Patch; b: Patch } {
	const { a, b } = hop;
	const listA = a.list,
		listB = b.list;
	const shift = edited.bandLen - (band.to - band.from + 1);
	const near = listA.items.slice(Math.max(0, band.from - 1), band.to + 1);
	const il = (near.find((it) => it.t === 'g' && INTERLINE.has(it.gk) && it.il) as any)?.il as number[] | undefined;
	const bandIn = { at: listA.items[band.from].i, recs: bandRecords(listA, daemon, a.layout, edited.bandFrom, dx, stamp, il) };
	const oldEnd = listA.galley[1];
	const gB0 = listB.galley[0],
		gB1 = listB.galley[1];
	const placedA: Placed = { list: listA, items: a.items, top: a.layout.top, w: a.layout.w };
	const placedB: Placed = { list: listB, items: b.items, top: b.top, w: b.w };

	if (hop.pulledOwn === undefined) {
		// carry: A loses the galley's tail from the break on, B takes it over its own
		const removed = edited.galley[1] - a.galleyEnd;
		const patchA = mappedPatch(
			recsA,
			listA,
			(k) => {
				if (k < band.from) return k;
				if (k <= band.to) return null;
				const e = k + shift;
				if (e < a.galleyEnd) return e;
				return k < oldEnd ? null : e - removed;
			},
			a.layout,
			[bandIn]
		);
		const nIn = b.items.length - listB.items.length + 1;
		const patchB = mappedPatch(recsB, listB, (k) => (k < gB0 ? k : k === gB0 ? null : k - 1 + nIn), b, [
			{ at: listB.items[gB0].i, recs: incoming({ recs: recsA, list: listA }, placedB, [gB0, gB0 + nIn]) }
		]);
		return { a: patchA, b: patchB };
	}

	// pull: A's galley grows by what it took, B's starts after it
	const grew = hop.moved.length;
	const pulledFrom = a.galleyEnd - grew;
	const patchA = mappedPatch(
		recsA,
		listA,
		(k) => {
			if (k < band.from) return k;
			if (k <= band.to) return null;
			const e = k + shift;
			return k < oldEnd ? e : e + grew;
		},
		a.layout,
		[bandIn, { at: listA.items[oldEnd]?.i ?? listA.end, recs: incoming({ recs: recsB, list: listB }, placedA, [pulledFrom, a.galleyEnd]) }]
	);
	// B's own galley items after its \topskip glue, as contributed: the first pulledOwn went to A
	const own = listB.items.slice(gB0 + 1, gB1);
	const rest = pageTopMap(own.slice(hop.pulledOwn));
	const shiftB = b.items.length - listB.items.length;
	const firstBox = own.findIndex((it, j) => j >= hop.pulledOwn! && it.t === 'b');
	const patchB = mappedPatch(
		recsB,
		listB,
		(k) => {
			if (k < gB0) return k;
			if (k >= gB1) return k + shiftB;
			if (k === gB0) return null;
			const j = k - gB0 - 1;
			if (j < hop.pulledOwn!) return null;
			const m = rest[j - hop.pulledOwn!];
			return m === null ? null : gB0 + m;
		},
		b,
		[{ at: own[firstBox].i, recs: incoming({ recs: recsB, list: listB }, placedB, topskipSpan(b.items, gB0)) }]
	);
	return { a: patchA, b: patchB };
}

// the new \topskip glue in the receiver's list: the one item there with no record of its own
function topskipSpan(items: ListItem[], from: number): [number, number] {
	for (let m = from; m < items.length; m++)
		if (items[m].t === 'g' && (items[m] as { gk: number }).gk === TOPSKIP && items[m].i < 0) return [m, m + 1];
	return [from, from];
}
