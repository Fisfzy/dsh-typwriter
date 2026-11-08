import type { ListItem } from './columnList';

// a row's glyphs can reach a little past the box they sit in (an accent, a descender)
const HOLD = 0.5;

/** the box among items [from, to) whose extent holds baseline y, the nearest by baseline when boxes overlap; -1 when none */
export function holdingBox(items: ListItem[], y: number, from = 0, to = items.length): number {
	let best = -1,
		bd = Infinity;
	for (let k = from; k < to; k++) {
		const it = items[k];
		if (it.t !== 'b' || y < it.y - it.h - HOLD || y > it.y + it.d + HOLD) continue;
		if (Math.abs(it.y - y) < bd) {
			bd = Math.abs(it.y - y);
			best = k;
		}
	}
	return best;
}
