import { describe, it, expect } from 'vitest';
import { figureRasterScale, HIDPI_SCALE, MAX_RASTER_EDGE } from '$lib/editor/visual/extensions/image/pdfRasterScale';

describe('figureRasterScale', () => {
	it('keeps the hidpi scale for an ordinary column-width figure', () => {
		expect(figureRasterScale(400, 250)).toBe(HIDPI_SCALE);
	});

	it('caps a poster-size drawing at the raster edge instead of 2x', () => {
		const scale = figureRasterScale(2233, 962);
		expect(scale).toBeLessThan(1);
		expect(Math.round(2233 * scale)).toBe(MAX_RASTER_EDGE);
	});

	it('caps on the taller edge too', () => {
		expect(Math.round(3000 * figureRasterScale(600, 3000))).toBe(MAX_RASTER_EDGE);
	});
});
