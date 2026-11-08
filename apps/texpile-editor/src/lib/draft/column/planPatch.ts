/* eslint-disable @typescript-eslint/no-explicit-any -- page and daemon records are schemaless engine JSON */
// One edited block, from the daemon's typeset to a patch, with no layout decided in JS. The block is found on
// the list it sits on, proved to be the daemon's typeset of the old text, and then either TeX's rules say
// nothing on the page moves (heldLayout, floatLayout) or the engine packs and breaks the edited column
// (certifyColumn). Anything else is the full pass.
import { pageColumns } from '../geometry/pageColumns';
import { columnListOf } from './columnListOf';
import { daemonList } from './daemonList';
import { proveBand, type BandProof, type ProofRefusal } from './bandProof';
import { heldLayout, type ColumnLayout } from './columnLayout';
import { editedList } from './editedList';
import { certifyColumn, type SplitSkeleton } from './columnCertificate';
import { columnTail, type TailDeps } from './columnTail';
import { findFloatBand, floatLayout } from './floatBand';
import { holdingBox } from './holdingBox';
import { listPatch, type HostList, type SourceStamp } from './listPatch';
import { hopColumn } from './columnHop';
import { hopPatches } from './hopPatches';
import type { ColumnList } from './columnList';
import type { ParaParams } from './paraPrefix';
import type { Cal } from '../locate/locate.types';
import type { Patch } from '../patch/patch.types';

export type PlanDeps = TailDeps & { split: SplitSkeleton; topSkip: () => number; pageIsRtl: (p: number) => boolean };

/** the block on the list it sits on: items [from, to]; `column` when that list is a column's galley */
export type HostBand = { host: HostList; from: number; to: number; column?: ColumnList };

export type Plan =
	| { patch: Patch; certified: boolean; bandLen: number }
	| { stage: string; detail?: Record<string, unknown> }
	| { moved: { kA: number; boxes: number; nA: number } }
	/** the break moved and the engine answers for both columns: two patches, never adopted */
	| { hop: { page: number; patch: Patch }[] };

/** the list holding boxes at the located first and last baselines: a column's galley, or a float's own list */
export function findBand(recs: any[], cal: Cal, inFloat: boolean): HostBand | { refused: string } {
	if (inFloat) {
		const f = findFloatBand(recs, cal);
		return 'refused' in f ? f : { host: f, from: f.from, to: f.to };
	}
	let why = 'no-column';
	for (const col of pageColumns(recs)) {
		if (col.i === undefined || col.x + col.w < cal.colL || col.x > cal.colR) continue;
		const list = columnListOf(recs, col.i);
		if ('refused' in list) {
			why = list.refused;
			continue;
		}
		// the box holding the located row: a table or a display is one box whose baseline is not its rows'
		const from = holdingBox(list.items, cal.b1, list.galley[0], list.galley[1]),
			to = holdingBox(list.items, cal.bk, list.galley[0], list.galley[1]);
		if (from >= 0 && to >= from) {
			const ends = [list.items[from], list.items[to]];
			if (ends.every((it) => it.t === 'b' && it.line)) return { host: list, from, to, column: list };
			// the rows sit inside a box the column holds (a beamer frame's body): that box's own list is theirs
			const f = findFloatBand(recs, cal);
			return 'refused' in f ? f : { host: f, from: f.from, to: f.to };
		}
		why = 'band-not-on-list';
	}
	return { refused: why };
}

// proved once per page state and old text: the proof costs a daemon typeset
const proofs = new WeakMap<object, Map<string, BandProof | ProofRefusal>>();

export function proofKey(band: HostBand, orig: string): string {
	return `${band.host.x}:${band.from}:${band.to}:${orig}`;
}
export function cachedProof(recs: any[], key: string): BandProof | ProofRefusal | undefined {
	return proofs.get(recs)?.get(key);
}
export function storeProof(recs: any[], key: string, proof: BandProof | ProofRefusal): void {
	let m = proofs.get(recs);
	if (!m) {
		m = new Map();
		proofs.set(recs, m);
	}
	m.set(key, proof);
}

export function proveOn(recs: any[], band: HostBand, origRecs: any[]): BandProof | ProofRefusal {
	const d = daemonList(origRecs);
	return d ? proveBand(recs, band.host.items, band.from, band.to, origRecs, d.items) : { refused: 'insert' };
}

function stampOf(recs: any[], band: HostBand): SourceStamp {
	// the kept lines are where the next keystroke reads the paragraph's parameters (paragraphOf)
	const first = recs[band.host.items[band.from].i];
	const stamp: SourceStamp = first?.t === 'pl' && first.pi !== undefined ? { pi: first.pi } : {};
	if (band.host.items.slice(band.from, band.to + 1).some((it) => it.t === 'b' && it.fa)) stamp.fa = true;
	for (let k = band.from; k <= band.to; k++) {
		const r = recs[band.host.items[k].i];
		if (r?.t === 'pl' && r.s !== undefined) return { ...stamp, s: r.s, ...(r.sf !== undefined ? { sf: r.sf } : {}) };
	}
	return stamp;
}

// footnote lines leave the galley for \box\footins: a column carrying any has inserts the page builder
// weighed at every break, which a split of the galley alone does not
function hasFootnotes(recs: any[], list: ColumnList): boolean {
	return list.items.some((it, k) => it.t === 'b' && it.line && (k < list.galley[0] || k >= list.galley[1]) && recs[it.i]?.c === undefined);
}

export async function planPatch(deps: PlanDeps, page: number, band: HostBand, proof: BandProof, newRecs: any[]): Promise<Plan> {
	const recs = deps.pageRecords(page) as any[];
	const { from, to } = band;
	const d = daemonList(newRecs);
	if (!d) return { stage: 'insert' };
	const list = band.column;
	let layout: ColumnLayout | null = list
		? heldLayout(list, from, to, d.items, deps.topSkip())
		: floatLayout(band.host as Parameters<typeof floatLayout>[0], d.items);
	let certified = false;
	if (!layout) {
		if (!list) return { stage: 'float-resized' };
		if (hasFootnotes(recs, list)) return { stage: 'footnote' };
		// LaTeX placed a float anchored after the edit by the page height at its anchor
		for (let k = from; k < list.galley[1]; k++) {
			const it = list.items[k];
			if (it.t === 'b' && it.fa) return { stage: 'float-anchor' };
		}
		const edited = editedList(list, from, to, d.items);
		if ('refused' in edited) return { stage: edited.refused };
		const tail = columnTail(deps, page, list.fire);
		if ('refused' in tail) return { stage: tail.refused };
		const ans = await certifyColumn(deps.split, list, edited, tail);
		if ('refused' in ans) return { stage: ans.refused, detail: ans.detail };
		if ('moved' in ans) {
			const hop = await hopColumn(deps, page, list, edited, ans.moved.nA);
			if ('refused' in hop) return { stage: 'hop:' + hop.refused };
			const recsB = deps.pageRecords(hop.b.page) as any[];
			const patches = hopPatches(
				recs,
				recsB,
				hop,
				edited,
				{ from, to },
				{ recs: newRecs, items: d.items, end: d.end },
				proof.dx,
				stampOf(recs, band)
			);
			return {
				hop: [
					{ page, patch: patches.a },
					{ page: hop.b.page, patch: patches.b }
				]
			};
		}
		layout = ans.layout;
		certified = true;
	}
	const patch = listPatch(recs, band.host, from, to, layout, { recs: newRecs, items: d.items, end: d.end }, proof.dx, stampOf(recs, band));
	return { patch, certified, bandLen: d.items.length };
}

/**
 * the recorded parameters of the paragraph the band opens. Only a band whose first box is that paragraph's
 * first line on the page: a display is no paragraph line, and a band after one starts inside a paragraph
 * the page broke in parts, whose indent and club penalty belong to its first part
 */
export function paragraphOf(recs: any[], band: HostBand, lookup: (pi: number) => ParaParams | undefined): ParaParams | undefined {
	const first = recs[band.host.items[band.from].i];
	if (first?.t !== 'pl' || first.pi === undefined) return undefined;
	for (let k = 0; k < band.from; k++) {
		const it = band.host.items[k];
		if (it.t === 'b' && recs[it.i]?.pi === first.pi) return undefined;
	}
	return lookup(first.pi);
}
