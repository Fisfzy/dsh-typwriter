// The insert/delete alignment guess: which run of paragraphs is NEW and which pair is the
// pending edit. Pure buffer-vs-buffer -- the engine never sees the two versions together,
// so this stays a heuristic; a wrong alignment builds a patch whose calibration cannot
// match the page, so it falls to the full pass instead of splicing wrong content.
import type { Para } from './splitParas';

export type Align = { j: number; mod: number | null; score: number };

// shared-prefix + shared-suffix length: which unmatched paragraph is the EDIT of which
function sim(a: Para, b: Para): number {
	const x = a.text;
	const y = b.text;
	const n = Math.min(x.length, y.length);
	let p = 0;
	while (p < n && x[p] === y[p]) p++;
	let s = 0;
	while (s < n - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
	return p + s;
}

// Try every insert (or delete) position j inside the unmatched window and accept it when
// the rest of the window agrees except AT MOST ONE modified pair -- the pending-patch
// paragraph that never advanced the baseline (the normal state mid-writing). Among valid
// alignments prefer no-modification, then the pairing whose modified texts are most
// similar (a transposed pairing would splice swapped content). `short` = the side without
// the extra paragraphs, `long` = with them; j indexes the start of the inserted/deleted
// RUN of length k in LONG, mod the modified one in SHORT.
export function scanAlignment(short: Para[], long: Para[], fi: number, bi: number, k: number): Align | null {
	let best: Align | null = null;
	for (let j = fi; j <= long.length - k - bi; j++) {
		let mod: number | null = null;
		let ok = true;
		for (let i = fi; i <= short.length - 1 - bi && ok; i++) {
			const li = i < j ? i : i + k;
			if (short[i].text !== long[li].text) {
				if (mod !== null) ok = false;
				else mod = i;
			}
		}
		if (!ok) continue;
		const score = mod === null ? Infinity : sim(short[mod], long[mod < j ? mod : mod + k]);
		if (!best || score > best.score) best = { j, mod, score };
	}
	return best;
}
