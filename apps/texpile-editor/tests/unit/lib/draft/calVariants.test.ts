import { describe, expect, it } from 'vitest';
import { extraCalVariants } from '$lib/draft/heuristics/calVariants';

// The decision under test: which page-declared widths earn a calibration variant, and
// whether the variant carries a font prefix. Records mimic an ACL first page: 11pt body
// at \columnwidth, a parshape-narrowed 10pt abstract, grid-aligned second column.
const paper = { colW: 219.0864, textW: 455.2444 };

const pl = (y: number, w: number, x = 17) => ({ t: 'pl', x, y, w });
const g = (y: number, x: number, f: number) => ({ t: 'g', c: 97, f, x, y, w: 5 });
const font = (id: number, size: number) => ({ t: 'font', id, size });

function abstractPage() {
	const recs: Record<string, unknown>[] = [font(15, 10.95), font(41, 10)];
	// body lines at \columnwidth in both columns (dominant size 10.95)
	for (let i = 0; i < 20; i++) {
		recs.push(pl(300 + i * 13.6, paper.colW, 0), g(300 + i * 13.6, 5, 15));
		recs.push(pl(300 + i * 13.6, paper.colW, 240), g(300 + i * 13.6, 245, 15));
	}
	// the abstract: five narrowed lines at 10pt, 12pt leading, shifted right
	for (let i = 0; i < 5; i++) {
		recs.push(pl(120 + i * 12, 185, 17), g(120 + i * 12, 20, 41));
	}
	return recs;
}

describe('extraCalVariants', () => {
	it('learns the narrowed width with its own font size and leading', () => {
		const v = extraCalVariants(paper, abstractPage());
		expect(v).toHaveLength(1);
		expect(v[0].W).toBeCloseTo(185, 3);
		expect(v[0].pre).toContain('\\fontsize{10.0000pt}{12.0000pt}\\selectfont');
	});

	it('a same-size narrowed block gets a width-only variant', () => {
		const recs: Record<string, unknown>[] = [font(15, 10.95)];
		for (let i = 0; i < 8; i++) recs.push(pl(300 + i * 13.6, paper.colW, 0), g(300 + i * 13.6, 5, 15));
		for (let i = 0; i < 4; i++) recs.push(pl(100 + i * 13.6, 180, 20), g(100 + i * 13.6, 25, 15));
		const v = extraCalVariants(paper, recs);
		expect(v).toHaveLength(1);
		expect(v[0].pre).toBe('');
	});

	it('announced widths and stray boxes never become variants', () => {
		const recs: Record<string, unknown>[] = [font(15, 10.95)];
		for (let i = 0; i < 8; i++) recs.push(pl(300 + i * 13.6, paper.colW, 0), g(300 + i * 13.6, 5, 15));
		// within tolerance of \textwidth
		for (let i = 0; i < 4; i++) recs.push(pl(100 + i * 13.6, paper.textW - 1, 0));
		// two lines only: stray boxed material
		for (let i = 0; i < 2; i++) recs.push(pl(200 + i * 13.6, 150, 20));
		expect(extraCalVariants(paper, recs)).toHaveLength(0);
	});

	it('font tally ignores the grid-aligned neighbour column', () => {
		const recs: Record<string, unknown>[] = [font(15, 10.95), font(41, 10)];
		for (let i = 0; i < 12; i++) recs.push(pl(300 + i * 13.6, paper.colW, 240), g(300 + i * 13.6, 245, 15));
		// narrowed left-column cluster shares baselines with col-2 body glyphs; only its
		// own x-range glyphs (font 41) may vote
		for (let i = 0; i < 4; i++) {
			recs.push(pl(300 + i * 13.6, 185, 17), g(300 + i * 13.6, 20, 41));
		}
		const v = extraCalVariants(paper, recs);
		expect(v).toHaveLength(1);
		expect(v[0].pre).toContain('\\fontsize{10.0000pt}');
	});

	it('a page without pl records (older bridge) yields nothing', () => {
		expect(extraCalVariants(paper, [font(15, 10.95), g(100, 5, 15)])).toHaveLength(0);
	});
});
