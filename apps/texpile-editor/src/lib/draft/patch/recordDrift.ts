/* eslint-disable @typescript-eslint/no-explicit-any -- page records are schemaless engine JSON */
/**
 * How far the records a patch DERIVED sit from the ones the engine then produced for the same
 * source. The derivation is only worth trusting while this stays at zero, so it runs whenever
 * a compile lands on a page whose records were adopted, and says so when it does not.
 */
export function recordDrift(
	adopted: any[],
	fresh: any[]
): { rows: number; freshRows: number; maxDy: number; maxDx: number; worst?: { ay: number; fy: number }[] } {
	function lines(rs: any[]) {
		return rs
			.filter((r) => r.t === 'pl' && r.y !== undefined)
			.map((r) => ({ x: r.x ?? 0, y: r.y }))
			.sort((a, b) => a.y - b.y || a.x - b.x);
	}
	const a = lines(adopted);
	const f = lines(fresh);
	let maxDy = 0;
	let maxDx = 0;
	const worst: { ay: number; fy: number }[] = [];
	// Paired by nearest line, not by index. Index pairing survives only while the two lists are
	// the same length: one missing row shifts every later comparison onto the wrong line, and
	// the numbers it then reports measure the gap between neighbours -- a column offset on a
	// two-column page, a page height across a break. The count difference is the real signal,
	// so it must not arrive wrapped in displacements nobody can act on.
	// Both axes, because y alone is ambiguous by construction on a multi-column page: every
	// line in column two shares its band of y with a line in column one.
	for (const p of a) {
		let best: { x: number; y: number } | null = null;
		let bestD = Infinity;
		for (const q of f) {
			const d = Math.abs(q.y - p.y) + Math.abs(q.x - p.x);
			if (d < bestD) {
				bestD = d;
				best = q;
			}
		}
		if (!best) break;
		if (Math.abs(p.y - best.y) > 0.05) worst.push({ ay: +p.y.toFixed(2), fy: +best.y.toFixed(2) });
		maxDy = Math.max(maxDy, Math.abs(p.y - best.y));
		maxDx = Math.max(maxDx, Math.abs(p.x - best.x));
	}
	// the WORST drifted rows: where the store disagrees decides shift-region bug vs scatter
	worst.sort((u, v) => Math.abs(v.ay - v.fy) - Math.abs(u.ay - u.fy));
	worst.length = Math.min(worst.length, 6);
	return { rows: a.length, freshRows: f.length, maxDy: +maxDy.toFixed(2), maxDx: +maxDx.toFixed(2), ...(worst.length ? { worst } : {}) };
}
