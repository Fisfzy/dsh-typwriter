import { describe, expect, it } from 'vitest';
import { columnList } from '$lib/draft/column/columnList';
import { paragraphOf, planPatch, type HostBand } from '$lib/draft/column/planPatch';
import { recordsAfterPatch } from '$lib/draft/patch/patchedRecords';
import type { ParaParams } from '$lib/draft/column/paraPrefix';

// a one-column page holding one two-line paragraph, serial 1, from source line 3
function page(): Record<string, unknown>[] {
	return [
		{ t: 'col', i: 2, x: 62, y: 150, w: 345, h: 100, d: 0, gs: 0, gsn: 0, gord: 1, g: 100, md: 5 },
		{ t: 'vbox', x: 62, y: 150, w: 345, h: 100, d: 0 },
		{ t: 'vg', x: 62, y: 50, w: 3, nw: 3, st: 0, sto: 0, sh: 0, sho: 0, gk: 10, c: 2 },
		{ t: 'pl', x: 62, y: 60, w: 345, h: 7, d: 2, c: 2, pi: 1, s: 3 },
		{ t: 'g', c: 65, f: 1, x: 62, y: 60, w: 5 },
		{ t: 'pen', y: 62, p: 10000, c: 2 },
		{ t: 'vg', x: 62, y: 62, w: 3, nw: 3, st: 0, sto: 0, sh: 0, sho: 0, gk: 2, c: 2 },
		{ t: 'pl', x: 62, y: 72, w: 345, h: 7, d: 2, c: 2, pi: 1, s: 3 },
		{ t: 'g', c: 66, f: 1, x: 62, y: 72, w: 5 },
		{ t: 'vg', x: 62, y: 74, w: 76, nw: 0, st: 1, sto: 1, sh: 0, sho: 0, gk: 0 },
		{ t: 'vboxend' },
		{ t: 'colend' }
	];
}

// the daemon's typeset of the edited paragraph: the same two lines, another glyph
const typeset = [
	{ t: 'line', x: 0, y: 7, w: 345, h: 7, d: 2 },
	{ t: 'g', c: 65, f: 1, x: 0, y: 7, w: 5 },
	{ t: 'pen', y: 9, p: 10000 },
	{ t: 'vg', x: 0, y: 9, w: 3, nw: 3, st: 0, sto: 0, sh: 0, sho: 0, gk: 2 },
	{ t: 'line', x: 0, y: 19, w: 345, h: 7, d: 2 },
	{ t: 'g', c: 67, f: 1, x: 0, y: 19, w: 5 }
];

function bandOn(recs: unknown[]): HostBand {
	const list = columnList(recs as never[], 2);
	if ('refused' in list) throw new Error(list.refused);
	return { host: list, from: 1, to: 4, column: list };
}

function plan(recs: unknown[], newRecs: unknown[]) {
	const deps = { pageRecords: () => recs, topSkip: () => 10 } as never;
	return planPatch(deps, 1, bandOn(recs), { from: 1, to: 4, dx: 62 }, newRecs);
}

// the page as the store keeps it after the first keystroke
async function kept(recs: unknown[]) {
	const p = await plan(recs, typeset);
	if (!('patch' in p)) throw new Error(JSON.stringify(p));
	return recordsAfterPatch(recs, p.patch);
}

describe('planPatch', () => {
	it('puts the paragraph serial back on the lines it keeps, where the next keystroke reads its parameters', async () => {
		const after = await kept(page());
		const params = { i: 1 } as ParaParams;
		expect(paragraphOf(after, bandOn(after), (pi) => (pi === 1 ? params : undefined))).toBe(params);
	});

	it('still refuses a later edit that moves a float anchored after the block', async () => {
		const recs = page();
		recs[7].fa = 1;
		const after = await kept(recs);
		const longer = [
			...typeset,
			{ t: 'pen', y: 21, p: 150 },
			{ t: 'vg', x: 0, y: 21, w: 3, nw: 3, st: 0, sto: 0, sh: 0, sho: 0, gk: 2 },
			{ t: 'line', x: 0, y: 31, w: 345, h: 7, d: 2 },
			{ t: 'g', c: 68, f: 1, x: 0, y: 31, w: 5 }
		];
		expect(await plan(after, longer)).toEqual({ stage: 'float-anchor' });
	});
});
