// TeX's append_to_vlist at an edited band's edge: the glue between two boxes is \baselineskip less the depth
// above and the height below, or \lineskip when that falls under \lineskiplimit. The three are the ones the
// glue itself was computed from (page-extract stamps them at the line break), not the document's.
import type { ListGlue } from './columnList';

const LINESKIP = 1;
const BASELINESKIP = 2;
// records carry four decimals: a smaller change is the same dimension
const SAME = 5e-5;
// a width this close to the limit could fall either side of TeX's comparison
const LIMIT_EPS = 1e-3;

/** the glue once the depth above plus the height below grew by `grew`; null when the engine's choice cannot be read */
export function reInterlineEdge(g: ListGlue, grew: number): ListGlue | null {
	if (Math.abs(grew) < SAME) return g;
	if (!g.il || (g.gk !== LINESKIP && g.gk !== BASELINESKIP)) return null;
	const [, bst, bsh, lk, lst, lsh, ll] = g.il;
	if (g.gk === BASELINESKIP) {
		const w = g.nw - grew;
		if (Math.abs(w - ll) < LIMIT_EPS) return null;
		return w >= ll ? { ...g, nw: w, st: bst, sh: bsh, sto: 0, sho: 0 } : { ...g, nw: lk, st: lst, sh: lsh, sto: 0, sho: 0, gk: LINESKIP };
	}
	// \lineskip went in because \baselineskip came out under the limit, and more height only goes further under;
	// less height needs the depth above, which the glue does not record
	return grew >= 0 ? g : null;
}

/** is this the interline glue TeX put over the box after it */
export function isInterline(g: ListGlue): boolean {
	return g.gk === LINESKIP || g.gk === BASELINESKIP;
}
