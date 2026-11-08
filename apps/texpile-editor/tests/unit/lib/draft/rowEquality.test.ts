import { describe, expect, it } from 'vitest';
import { bandMatchesCalibration, firstRowMismatch } from '$lib/draft/geometry/rowEquality';

const row = (left: number, cs: number[]) => ({ cs, xs: cs.map((_, i) => left + i * 5) });

describe('bandMatchesCalibration', () => {
	// a paragraph running through a display: the page indents its first line, the daemon's \noindent box does not,
	// and each row's own glyphs still agree. Painted at one offset, the first line landed 15pt left of the page's
	const page = [row(77, [83, 111, 109]), row(222, [120, 61, 121]), row(62, [97, 110, 100])];

	it('refuses a reproduction whose rows start elsewhere against each other than the page rows do', () => {
		const unindented = [row(0, [83, 111, 109]), row(160, [120, 61, 121]), row(0, [97, 110, 100])];
		expect(firstRowMismatch(page, unindented)).toBe(1);
		expect(bandMatchesCalibration(page, unindented)).toBe(false);
	});

	it('takes the reproduction that sets every row at one offset', () => {
		const indented = [row(15, [83, 111, 109]), row(160, [120, 61, 121]), row(0, [97, 110, 100])];
		expect(bandMatchesCalibration(page, indented)).toBe(true);
	});
});
