/* eslint-disable @typescript-eslint/no-explicit-any */
import { BP2PT } from '../texUnits';
import { COL_GUTTER } from './tolerances';

// Where to shine the "not instantly renderable" highlight when an edit falls to a full
// recompile. Synctex line attribution is too fuzzy to anchor a SPLICE (the locate tiers
// exist because of that), but a highlight only has to land on roughly the right rows, so
// the decision here is simply which boxes to trust: line-height boxes on their majority
// page, padded by a line gap. Null when synctex offers nothing -- the status line alone
// then carries the message.
export type HintBand = { page: number; top: number; bottom: number; colL: number; colR: number };

export function abandonBand(boxes: any[], paper: { colW: number; mx: number; my: number; blSkip: number }): HintBand | null {
	const lineBoxes = boxes.filter((b) => b.page && (b.H || 0) < 30);
	if (!lineBoxes.length) return null;
	const byPage = new Map<number, number>();
	for (const b of lineBoxes) byPage.set(b.page, (byPage.get(b.page) || 0) + 1);
	let page = lineBoxes[0].page,
		pc = -1;
	for (const [p, c] of byPage)
		if (c > pc) {
			pc = c;
			page = p;
		}
	const mine = lineBoxes.filter((b) => b.page === page);
	const ys = mine.map((b) => b.y * BP2PT - paper.my);
	const gap = paper.blSkip || 12;
	const left = Math.min(...mine.map((b) => (b.bl ?? b.x) * BP2PT - paper.mx));
	const colL = left - COL_GUTTER;
	return {
		page,
		top: Math.min(...ys) - gap,
		bottom: Math.max(...ys) + gap,
		colL,
		colR: colL + (paper.colW > 0 ? paper.colW : 400) + 2 * COL_GUTTER
	};
}
