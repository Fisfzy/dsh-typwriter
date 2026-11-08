import { describe, expect, it } from 'vitest';
import { columnList } from '$lib/draft/column/columnList';
import { heldLayout } from '$lib/draft/column/columnLayout';
import type { ListItem } from '$lib/draft/column/columnList';

// a one-column page: \topskip glue, two lines of a paragraph at \baselineskip 12pt, and the fil the output
// routine closes a ragged column with
export function page() {
	return [
		{ t: 'col', i: 2, x: 62, y: 150, w: 345, h: 100, d: 0, gs: 0, gsn: 0, gord: 1, g: 100, md: 5 },
		{ t: 'vbox', x: 62, y: 150, w: 345, h: 100, d: 0 },
		{ t: 'vg', x: 62, y: 50, w: 3, nw: 3, st: 0, sto: 0, sh: 0, sho: 0, gk: 10, c: 2 },
		{ t: 'pl', x: 62, y: 60, w: 345, h: 7, d: 2, c: 2, pi: 1 },
		{ t: 'g', c: 65, f: 1, x: 62, y: 60, w: 5 },
		{ t: 'pen', y: 62, p: 150, c: 2 },
		{ t: 'vg', x: 62, y: 62, w: 3, nw: 3, st: 0, sto: 0, sh: 0, sho: 0, gk: 2, c: 2, il: [12, 0, 0, 1, 0, 0, 0] },
		{ t: 'pl', x: 62, y: 72, w: 345, h: 7, d: 2, c: 2, pi: 1 },
		{ t: 'g', c: 66, f: 1, x: 62, y: 72, w: 5 },
		{ t: 'vg', x: 62, y: 74, w: 76, nw: 0, st: 1, sto: 1, sh: 0, sho: 0, gk: 0 },
		{ t: 'vboxend' },
		{ t: 'colend' }
	];
}

function line(h: number, d: number): ListItem {
	return { t: 'b', h, d, y: h, i: 0, line: true };
}

describe('columnList', () => {
	it('reads the column item for item, with the galley the page builder broke', () => {
		const list = columnList(page() as never[], 2);
		if ('refused' in list) throw new Error(list.refused);
		expect(list.items.map((it) => it.t)).toEqual(['g', 'b', 'p', 'g', 'b', 'g']);
		expect(list.galley).toEqual([0, 5]);
		expect([list.goal, list.maxDepth, list.end]).toEqual([100, 5, 11]);
	});

	// an item the walker did not write leaves a gap, and a list with a gap is not the page's
	it('refuses a column whose items do not account for its height', () => {
		const recs = page().filter((r) => r.t !== 'pen' && !(r.t === 'vg' && r.gk === 2));
		expect(columnList(recs as never[], 2)).toEqual({ refused: 'list-gap' });
	});
});

describe('heldLayout', () => {
	const list = columnList(page() as never[], 2);
	if ('refused' in list) throw new Error(list.refused);

	it('keeps every box where it was when \\topskip takes up a taller first line', () => {
		const held = heldLayout(list, 1, 1, [line(8, 2)], 10);
		expect(held?.top).toEqual([50, 52, 62, 62, 65, 74]);
		expect((held?.items[0] as { nw: number }).nw).toBe(2);
	});

	it('keeps the baseline while \\baselineskip glue stays above \\lineskiplimit, and not once \\lineskip takes over', () => {
		expect(heldLayout(list, 4, 4, [line(9.5, 2)], 10)?.top[4]).toBe(62.5);
		expect(heldLayout(list, 4, 4, [line(11, 2)], 10)).toBeNull();
	});
});
