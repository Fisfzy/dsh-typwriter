/* eslint-disable @typescript-eslint/naming-convention -- TeX geometry shorthand: W = column width, G = gutter */
import type { PageRecord } from '../geometry/geometry.types';

// Column-left candidates for a page. Clustering per-row leftmost-x finds a column only when
// some row STARTS in it -- on a page where every col-2 row shares its baseline y with a col-1
// row (flushbottom twocolumn grids align), the row minimum always lands in col 1 and col 2 is
// invisible to it. So union in geometric candidates from the known \columnwidth: L0 + W +
// \columnsep (the ENGINE's when the manifest carries it, the 10pt default otherwise), and
// right-anchored maxX - W. False candidates are harmless: callers test candidates and a
// wrong column just yields losing runs.
export function columnCandidates(allG: PageRecord[], W: number, G: number, colSep?: number): number[] {
	const lineMinX = new Map<number, number>();
	for (const gl of allG) {
		const y = Math.round(gl.y);
		const c = lineMinX.get(y);
		if (c === undefined || gl.x < c) lineMinX.set(y, gl.x);
	}
	const leftCount = new Map<number, number>();
	for (const x of lineMinX.values()) {
		const k = Math.round(x);
		leftCount.set(k, (leftCount.get(k) || 0) + 1);
	}
	const uniq = [...leftCount.keys()].sort((a, b) => a - b);
	const cands: number[] = [];
	for (let i = 0; i < uniq.length;) {
		let j = i,
			rep = uniq[i],
			rc = leftCount.get(uniq[i]) as number;
		while (j + 1 < uniq.length && uniq[j + 1] - uniq[i] <= W * 0.5) {
			j++;
			const c = leftCount.get(uniq[j]) as number;
			if (c > rc) {
				rc = c;
				rep = uniq[j];
			}
		}
		cands.push(rep);
		// the cluster MIN too: on a page dominated by an indented block (an abstract), the
		// max-count rep is the indent, and a window opened there cuts off anything at the
		// true column left -- a section number, whose loss then anchors a splice at the
		// title (probed: BERT p1 elected 17.9 over 0 and duplicated the heading's "1")
		if (rep - uniq[i] > G) cands.push(uniq[i]);
		i = j + 1;
	}
	if (!cands.length) return cands;
	const L0 = Math.min(...cands);
	const maxRight = Math.max(...allG.map((g) => g.x as number));
	if (maxRight - L0 > 1.3 * W)
		for (const c of [L0 + W + (colSep && colSep > 0 ? colSep : 10), maxRight - W])
			if (!cands.some((x) => Math.abs(x - c) <= G)) cands.push(c);
	return cands.sort((a, b) => a - b);
}
