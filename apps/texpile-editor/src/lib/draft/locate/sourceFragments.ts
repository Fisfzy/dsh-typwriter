/* eslint-disable @typescript-eslint/no-explicit-any */
import { pageColumns } from '../geometry/pageColumns';
import type { LocateContext } from './locate.types';

/** pi: the paragraph the compile recorded this line's parameters under */
export type SourceLine = { x: number; y: number; w: number; h: number; pi?: number };
/** one contiguous run of the paragraph's lines inside a single column */
export type SourceFrag = { pageNo: number; lines: SourceLine[]; stamps: number[] };
export type SourceFragsResult = { frags: SourceFrag[] } | { bail: string; detail?: unknown };

/** line boxes whose left edges are within this (pt) sit in the same column */
const COL_SAME = 4;

// The page lines the compile attributed to this stretch of source, grouped into the columns
// they occupy and returned in reading order.
//
// Matching is by BASENAME: the stamp records the file the engine was reading, which is the
// name it was \input by, while the caller holds a workspace path.
//
// A paragraph that straddles a break is several fragments, and the split point between them
// is the fact the search tiers have to guess at -- the stamp states it. Reading order is page
// then column left edge, which is the order the fragments are set in (the callers refuse
// right-to-left pages before asking).
export function sourceFragments(ctx: LocateContext, srcFiles: string[], file: string, line: number, endLine: number): SourceFragsResult {
	const want = file.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
	const ids = srcFiles.map((f, i) => (f.toLowerCase() === want ? i + 1 : 0)).filter(Boolean);
	if (!ids.length) return { bail: 'file-not-stamped', detail: { want } };
	const found: SourceFrag[] = [];
	const colOf = new Map<SourceFrag, number>();
	for (const p of ctx.pageNumbers()) {
		const recs = ctx.pageRecords(p) as any[];
		const cols = pageColumns(recs);
		for (const r of recs) {
			if (r.t !== 'pl' || r.s === undefined) continue;
			if (r.s < line || r.s > endLine) continue;
			if (r.sf !== undefined && !ids.includes(r.sf)) continue;
			// the column box the compile recorded holds the line: an abstract's title and body, or a display
			// and the text around it, start at other left edges in one column. A page that recorded no
			// columns (multicol, a float page) groups by NEARNESS of the left edge instead, loose enough for
			// a hanging indent, since columns stand a column-width apart
			const ci = cols.findIndex((c) => r.x >= c.x - COL_SAME && r.x <= c.x + c.w);
			const f =
				found.find((k) => k.pageNo === p && (ci >= 0 ? colOf.get(k) === ci : !colOf.has(k) && Math.abs(k.lines[0].x - r.x) <= COL_SAME)) ??
				({ pageNo: p, lines: [], stamps: [] } as SourceFrag);
			if (ci >= 0 && !f.lines.length) colOf.set(f, ci);
			f.lines.push({ x: r.x, y: r.y, w: r.w, h: r.h ?? 0, ...(r.pi === undefined ? {} : { pi: r.pi }) });
			// the source line this galley line came from, kept so a caller can ask where the
			// block's output actually STARTS -- a leading \centerline or \label produces none
			f.stamps.push(r.s);
			if (f.lines.length === 1) found.push(f);
		}
	}
	if (!found.length) return { bail: 'no-source-records', detail: { line, endLine } };
	const frags = found.sort((a, b) => a.pageNo - b.pageNo || a.lines[0].x - b.lines[0].x);
	for (const f of frags) f.lines.sort((a, b) => a.y - b.y);
	return { frags };
}
