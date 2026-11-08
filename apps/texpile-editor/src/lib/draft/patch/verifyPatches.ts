/* eslint-disable @typescript-eslint/no-explicit-any */
import { glyphRows } from '../geometry/glyphRows';
import { VERIFY_DRIFT } from '../heuristics/tolerances';
import { sameCodepointsDigitTolerant } from '../geometry/rowEquality';
import type { PageRecord } from '../geometry/geometry.types';
import { patchInk, type Patch } from './patch.types';

export type VerifyContext = {
	pageRecords(n: number): PageRecord[];
	emit(kind: string, detail?: unknown): void;
};

// The engine grading its own guesses: when a compile lands, every still-active patch's
// painted rows are content-matched (digit-tolerant) against the FRESH records and the
// vertical drift measured. `patch-verify ok:false` = the instant preview showed
// something the recompile had to fix -- the metric the replay harness minimizes.
export function verifyPatches(ctx: VerifyContext, activePatches: Map<number, Patch | Patch[]>): void {
	for (const [n, patch] of activePatches) {
		const plist = Array.isArray(patch) ? patch : [patch];
		const freshG = ctx.pageRecords(n).filter((x: any) => x.t === 'g');
		for (const p of plist) {
			// rows built per COLUMN: on a grid-aligned twocolumn page whole-page rows merge
			// the two columns' baselines into one sequence and nothing single-column matches
			const fresh = glyphRows(
				freshG.filter((x: any) => x.x >= p.band.colL - 2 && x.x <= p.band.colR + 2),
				12
			);
			const pred = glyphRows(
				patchInk(p).filter((x: any) => x.t === 'g'),
				12
			);
			// a patch that brings no glyphs of its own (the receiver of a moved break) still claims where its rows go
			if (!pred.length && !p.flowPred?.length) continue;
			let found = 0;
			let drift = 0;
			let xdrift = 0;
			for (const row of pred) {
				let best: { dy: number; dx: number } | null = null;
				for (const fr of fresh)
					if (sameCodepointsDigitTolerant(fr.cs, row.cs)) {
						const dy = Math.abs(fr.y - row.y);
						if (best === null || dy < best.dy) best = { dy, dx: Math.abs(fr.left - row.left) };
					}
				if (best !== null) {
					found++;
					drift = Math.max(drift, best.dy);
					xdrift = Math.max(xdrift, best.dx);
				}
			}
			// signed first-row delta separates "painted too high" from "too low"
			let dy0: number | null = null;
			if (pred.length)
				for (const fr of fresh)
					if (sameCodepointsDigitTolerant(fr.cs, pred[0].cs)) {
						const dy = fr.y - pred[0].y;
						if (dy0 === null || Math.abs(dy) < Math.abs(dy0)) dy0 = dy;
					}
			// verdicts: 'wrong' = found content painted at the wrong place (the real bug
			// signal; x counts -- a missed \parindent is a placement error too); 'stale' =
			// the compile contained newer text than the patch (normal mid-typing grading
			// noise); 'unknown' = nothing matched (usually a fully superseded patch, but
			// worth eyeballing via `near`)
			const verdict =
				drift > VERIFY_DRIFT || xdrift > VERIFY_DRIFT ? 'wrong' : found === pred.length ? 'ok' : found > 0 ? 'stale' : 'unknown';
			const near =
				verdict === 'ok'
					? undefined
					: fresh
							.filter((fr) => pred.length && Math.abs(fr.y - pred[0].y) < 45)
							.map(
								(fr) =>
									`${fr.y.toFixed(1)}:${fr.cs
										.slice(0, 7)
										.map((c: number) => String.fromCodePoint(c))
										.join('')}`
							);
			// grade the flow claim too: the rows below the band, at their predicted
			// (delta-shifted) positions. A row found only OUTSIDE the column (or not at
			// all) means the live render placed the column/page break somewhere the
			// recompile did not -- invisible to the band grading above.
			let flow: { flowRows: number; flowFound: number; flowMoved: number; flowDrift: number } | undefined;
			if (p.flowPred?.length) {
				let flowFound = 0;
				let flowMoved = 0;
				let flowDrift = 0;
				// whole-page rows for the moved check only: a row that crossed the column
				// break appears merged with its new neighbour column's baseline, so it is a
				// contiguous SUBSEQUENCE of a merged row, never an exact row match
				const freshAll = glyphRows(freshG, 12);
				function containsSeq(hay: number[], needle: number[]) {
					for (let s = 0; s + needle.length <= hay.length; s++) {
						let okS = true;
						for (let i = 0; i < needle.length && okS; i++)
							if (hay[s + i] !== needle[i] && !(hay[s + i] >= 0x30 && hay[s + i] <= 0x39 && needle[i] >= 0x30 && needle[i] <= 0x39))
								okS = false;
						if (okS) return true;
					}
					return false;
				}
				for (const row of p.flowPred) {
					let bestDy: number | null = null;
					for (const fr of fresh)
						if (sameCodepointsDigitTolerant(fr.cs, row.cs)) {
							const dyF = Math.abs(fr.y - row.y);
							if (bestDy === null || dyF < bestDy) bestDy = dyF;
						}
					if (bestDy !== null) {
						flowFound++;
						flowDrift = Math.max(flowDrift, bestDy);
					} else if (row.cs.length >= 8 && freshAll.some((fr) => containsSeq(fr.cs, row.cs))) {
						flowMoved++; // still on the page, but across the column break
					} else {
						flowMoved++; // off the page (next column/page) or superseded text
					}
				}
				flow = { flowRows: p.flowPred.length, flowFound, flowMoved, flowDrift: +flowDrift.toFixed(1) };
			}
			ctx.emit('patch-verify', {
				page: n,
				rows: pred.length,
				found,
				drift: +drift.toFixed(1),
				xdrift: +xdrift.toFixed(1),
				dy0: dy0 === null ? null : +dy0.toFixed(1),
				verdict,
				ok: verdict === 'ok',
				near,
				...(flow ?? {})
			});
		}
	}
}
