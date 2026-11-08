/* eslint-disable @typescript-eslint/no-explicit-any -- page records are schemaless engine JSON */
// A page's records with its patches applied, in list order: the records a patch takes out leave, the ones it
// brings go in their place, and its moved items take their new place. The painter draws this and the record
// store adopts it, so the screen and the store cannot describe two different pages.
import type { Patch, RecordMove } from './patch.types';

function moved(r: any, m: RecordMove, first: boolean): any {
	if (r.y === undefined) return r;
	const out = { ...r, y: r.y + m.dy };
	// the moved item's own record carries its new set width; the records after it are its ink
	if (first && r.t === 'vg' && m.w !== undefined) {
		out.w = m.w;
		if (m.nw !== undefined) out.nw = m.nw;
		if (m.st !== undefined) out.st = m.st;
		if (m.sh !== undefined) out.sh = m.sh;
		if (m.gk !== undefined) out.gk = m.gk;
	}
	return out;
}

/** records in page order with every patch applied; brought-in records keep the fonts they name */
export function patchedRecords(records: any[], patches: Patch[]): any[] {
	const inAt = new Map<number, any[]>();
	const dropped = new Set<number>();
	const moveAt: ({ m: RecordMove; first: boolean } | undefined)[] = [];
	for (const p of patches) {
		for (const s of p.splices) {
			inAt.set(s.from, [...(inAt.get(s.from) ?? []), ...s.recs]);
			for (let j = s.from; j < s.to; j++) dropped.add(j);
		}
		for (const m of p.moves) for (let j = m.from; j < m.to; j++) moveAt[j] = { m, first: j === m.from };
	}
	const out: any[] = [];
	for (let j = 0; j <= records.length; j++) {
		const ins = inAt.get(j);
		if (ins) out.push(...ins);
		if (j === records.length) break;
		if (dropped.has(j)) continue;
		const at = moveAt[j];
		out.push(at ? moved(records[j], at.m, at.first) : records[j]);
	}
	return out;
}

/** the patch with nothing brought in: the page as the painter draws it under the patch's own ink */
export function withoutInk(p: Patch): Patch {
	return { ...p, splices: p.splices.map((s) => ({ ...s, recs: [] })) };
}

/**
 * The page's records after ONE patch, for the store. Brought-in glyphs name fonts by ids another run may have
 * given to other fonts (the daemon's own, or another page's): they are renumbered onto the page's own font
 * records, and a font the page never loaded gets a new id.
 */
export function recordsAfterPatch(records: any[], patch: Patch): any[] {
	function key(f: any) {
		return `${f.name}|${f.file}|${f.size}|${f.sub ?? ''}`;
	}
	const pageFont = new Map<string, number>();
	let next = 0;
	for (const r of records)
		if (r.t === 'font') {
			pageFont.set(key(r), r.id);
			next = Math.max(next, r.id + 1);
		}
	const added: any[] = [];
	const splices = patch.splices.map((s) => {
		const remap = new Map<number, number>();
		for (const r of s.recs as any[]) {
			if (r.t !== 'font') continue;
			let id = pageFont.get(key(r));
			if (id === undefined) {
				id = next++;
				pageFont.set(key(r), id);
				added.push({ ...r, id });
			}
			remap.set(r.id, id);
		}
		const recs = (s.recs as any[])
			.filter((r) => r.t !== 'font')
			.map((r) => (r.t === 'g' && remap.has(r.f) ? { ...r, f: remap.get(r.f) } : r));
		return { ...s, recs };
	});
	return [...patchedRecords(records, [{ ...patch, splices }]), ...added];
}
