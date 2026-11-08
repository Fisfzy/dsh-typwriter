import { describe, expect, it } from 'vitest';
import { abandonBand } from '$lib/draft/heuristics/abandonBand';
import { BP2PT } from '$lib/draft/texUnits';

// The decision under test: which synctex boxes a recompile highlight trusts -- line
// boxes only, majority page, padded by the engine line gap.
const paper = { colW: 219, mx: 54, my: 72, blSkip: 13.6 };
const box = (page: number, y: number, x = 60, H = 10) => ({ page, y, x, bl: x, W: 219, H });

describe('abandonBand', () => {
	it('bands the majority page and pads by a line gap', () => {
		const b = abandonBand([box(2, 300), box(2, 313), box(2, 326), box(3, 90)], paper)!;
		expect(b.page).toBe(2);
		expect(b.top).toBeCloseTo(300 * BP2PT - 72 - 13.6, 1);
		expect(b.bottom).toBeCloseTo(326 * BP2PT - 72 + 13.6, 1);
	});

	it('ignores tall structure boxes and pageless entries', () => {
		const b = abandonBand([box(1, 200), { page: 1, y: 400, x: 60, H: 600 }, { y: 10, x: 0, H: 5 }], paper)!;
		expect(b.page).toBe(1);
		expect(b.bottom).toBeLessThan(400 * BP2PT - 72);
	});

	it('nothing usable yields null, not a guess', () => {
		expect(abandonBand([], paper)).toBeNull();
		expect(abandonBand([{ page: 1, y: 100, x: 0, H: 200 }], paper)).toBeNull();
	});
});
