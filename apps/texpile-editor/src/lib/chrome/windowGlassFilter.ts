// the filter a frosted sheet's blur ends with (app.css, url(#glass-opaque)): keeps the color, forces the alpha to 1.
// Chromium draws a blurred backdrop OVER the original, so over a see-through page the sharp text stays readable under
// its own blur; only an opaque copy covers it
const SVG = 'http://www.w3.org/2000/svg';

export function mountGlassOpaqueFilter(): void {
	if (document.getElementById('glass-opaque')) return;
	const svg = document.createElementNS(SVG, 'svg');
	svg.setAttribute('width', '0');
	svg.setAttribute('height', '0');
	svg.setAttribute('aria-hidden', 'true');
	// in flow it is an inline box, and the line it makes adds a strip to the page
	svg.style.position = 'absolute';
	const filter = document.createElementNS(SVG, 'filter');
	filter.id = 'glass-opaque';
	filter.setAttribute('color-interpolation-filters', 'sRGB');
	const matrix = document.createElementNS(SVG, 'feColorMatrix');
	matrix.setAttribute('type', 'matrix');
	matrix.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1');
	filter.append(matrix);
	svg.append(filter);
	document.body.append(svg);
}
