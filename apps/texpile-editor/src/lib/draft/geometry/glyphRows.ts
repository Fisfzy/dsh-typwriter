import { ROW_CLUSTER } from '../heuristics/tolerances';
import type { GlyphRow, PageRecord } from './geometry.types';

/** the engine's own baseline among glyphs that round to one: the value most of them sit on */
export function exactBaseline(glyphs: PageRecord[]): number {
	const count = new Map<number, number>();
	for (const g of glyphs) count.set(g.y, (count.get(g.y) ?? 0) + 1);
	let best = glyphs[0].y as number;
	for (const [y, n] of count) if (n > (count.get(best) ?? 0)) best = y;
	return best;
}

// Group glyphs into visual text rows (script baselines clustered like colBase), each a
// codepoint sequence + x offsets sorted by x. Shared by all locate tiers.
export function glyphRows(glyphs: PageRecord[], gap: number): GlyphRow[] {
	const yc = new Map<number, PageRecord[]>();
	for (const g of glyphs) {
		const y = +g.y.toFixed(1);
		const a = yc.get(y);
		if (a) a.push(g);
		else yc.set(y, [g]);
	}
	const rawYs = [...yc.keys()].sort((a, b) => a - b);
	const out: GlyphRow[] = [];
	for (let i = 0; i < rawYs.length;) {
		let j = i,
			rep = rawYs[i];
		let all = yc.get(rawYs[i])!.slice();
		while (j + 1 < rawYs.length && rawYs[j + 1] - rawYs[j] <= gap * ROW_CLUSTER) {
			j++;
			const cur = yc.get(rawYs[j])!;
			if (cur.length > yc.get(rep)!.length) rep = rawYs[j];
			all = all.concat(cur);
		}
		all.sort((a, b) => a.x - b.x);
		out.push({
			y: rep,
			base: exactBaseline(yc.get(rep)!),
			cs: all.map((g) => g.c as number),
			xs: all.map((g) => g.x as number),
			left: Math.min(...all.map((g) => g.x as number))
		});
		i = j + 1;
	}
	return out;
}
