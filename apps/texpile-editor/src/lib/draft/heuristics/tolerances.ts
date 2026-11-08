// The numerical tolerances the live path leans on, in one place. Each one compares two
// ENGINE-produced numbers (daemon box vs parsed page, through unit conversion and float
// rounding) or scales an engine-measured gap -- there is no TeX register to fetch for
// them, which is what keeps them heuristics. Values that DO have an engine register come
// from the manifest / daemon announce instead (see engineTruth).

/** half-gutter: how far a glyph may sit outside its column's [left, left+W] and still belong */
export const COL_GUTTER = 8;
/** baseline clusters closer than this fraction of the line gap merge into one visual row */
export const ROW_CLUSTER = 0.45;
/** a gap beyond this fraction of the line gap breaks a contiguous row run */
export const ROW_BREAK = 1.5;
/** band absorption: neighbouring baselines within this fraction of the gap may join the band */
export const BAND_EXTEND = 1.18;
/** cal spread vs page band spread agreement (pt) */
export const SPREAD_TOL = 0.7;
/** band line gap vs cal line gap agreement (pt); larger = glue-stretched vertical justification */
export const GLUE_GAP_TOL = 0.5;
/** two engine positions written to four decimals and subtracted: equal within this (pt) */
export const ENGINE_EPS = 0.05;
/** line gap fallback (pt) when the engine baselineskip is unknown and the cal is single-line */
export const LINE_GAP_FALLBACK = 12;
/** contiguous-flow walk: a gap beyond this many line gaps ends the text flow under a band */
export const FLOW_GAP = 2.5;
/** a shrink beyond this fraction of a line marks underflow (the reflow below is approximate) */
export const UNDERFLOW_FRACTION = 0.7;
/** patch grading: painted rows off by more than this many pt count as wrongly placed. Rows cluster on
 *  baselines rounded to 0.1pt, so this is the rounding and nothing more */
export const VERIFY_DRIFT = 0.15;
