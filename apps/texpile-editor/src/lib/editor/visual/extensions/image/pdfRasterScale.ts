// a figure is shown at column width at most, so past this many device pixels on its longer edge
// a bigger bitmap only costs memory: a 2233 pt wide drawing at 2x was a 34 MB decoded image
export const MAX_RASTER_EDGE = 2000;
export const HIDPI_SCALE = 2;

/** pdf.js viewport scale for a figure whose page is width x height at scale 1 */
export function figureRasterScale(width: number, height: number): number {
	const edge = Math.max(width, height);
	if (!(edge > 0)) return HIDPI_SCALE;
	return Math.min(HIDPI_SCALE, MAX_RASTER_EDGE / edge);
}
