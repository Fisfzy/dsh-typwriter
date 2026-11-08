// The TeX that puts the daemon's paragraph where the page's stood: the font it opened in, the indent box
// it opened with, and every parameter TeX broke it and stacked its lines with (page-extract records them at
// the line break). Only the first paragraph takes them; one typed after it gets the document's own, as it
// would on the page, so the old values are handed back when the first one ends.
export type ParaParams = {
	i: number;
	font: { e: string; f: string; s: string; h: string; z: string; b: string } | null;
	ind: number;
	/** club, widow, interline, broken, display widow */
	pen: number[];
	/** pretolerance, tolerance, emergencystretch, looseness, linepenalty, hyphenpenalty, exhyphenpenalty,
	 *  adjdemerits, doublehyphendemerits, finalhyphendemerits, lefthyphenmin, righthyphenmin */
	lb: number[];
	/** glue as [width, stretch, stretch order, shrink, shrink order] */
	ls: number[];
	rs: number[];
	pf: number[];
	bs: number[];
	lk: number[];
	ll: number;
	hang: number[];
};

const ORDER = ['pt', 'fil', 'fill', 'filll'];

function dim(v: number): string {
	return `${v.toFixed(4)}pt`;
}

function glue(g: number[]): string {
	const [w, st, sto, sh, sho] = g;
	const stretch = st ? ` plus ${st.toFixed(4)}${ORDER[sto] ?? 'pt'}` : '';
	const shrink = sh ? ` minus ${sh.toFixed(4)}${ORDER[sho] ?? 'pt'}` : '';
	return `${dim(w)}${stretch}${shrink}`;
}

const COUNTS = ['clubpenalty', 'widowpenalty', 'interlinepenalty', 'brokenpenalty', 'displaywidowpenalty'];
const BREAKS = [
	'pretolerance',
	'tolerance',
	'emergencystretch',
	'looseness',
	'linepenalty',
	'hyphenpenalty',
	'exhyphenpenalty',
	'adjdemerits',
	'doublehyphendemerits',
	'finalhyphendemerits',
	'lefthyphenmin',
	'righthyphenmin'
];
const SKIPS: [keyof ParaParams, string][] = [
	['ls', 'leftskip'],
	['rs', 'rightskip'],
	['pf', 'parfillskip'],
	['bs', 'baselineskip'],
	['lk', 'lineskip']
];

/** the parameters as assignments, and the same registers' current values saved to put back */
export function paraPrefix(p: ParaParams): string {
	const sets: string[] = [];
	const names: string[] = [];
	COUNTS.forEach((n, k) => {
		sets.push(`\\${n}=${p.pen[k]}\\relax`);
		names.push(n);
	});
	BREAKS.forEach((n, k) => {
		sets.push(n === 'emergencystretch' ? `\\${n}=${dim(p.lb[k])}\\relax` : `\\${n}=${p.lb[k]}\\relax`);
		names.push(n);
	});
	for (const [key, n] of SKIPS) {
		sets.push(`\\${n}=${glue(p[key] as number[])}\\relax`);
		names.push(n);
	}
	sets.push(`\\lineskiplimit=${dim(p.ll)}\\relax`);
	names.push('lineskiplimit');
	// \item sets \clubpenalty from LaTeX's \@clubpenalty when its paragraph starts, after anything set here
	const club = '\\csname @clubpenalty\\endcsname';
	sets.push(`\\ifcsname @clubpenalty\\endcsname${club}=${p.pen[0]}\\relax\\fi`);
	const save = `\\edef\\TexpileParaRestore{${names.map((n) => `\\${n}=\\the\\${n}\\relax`).join('')}\\ifcsname @clubpenalty\\endcsname\\noexpand${club}=\\the${club}\\relax\\fi}`;
	const font = p.font
		? `\\fontencoding{${p.font.e}}\\fontfamily{${p.font.f}}\\fontseries{${p.font.s}}\\fontshape{${p.font.h}}\\fontsize{${p.font.z}}{${p.font.b}}\\selectfont `
		: '';
	// \baselineskip after \selectfont, which sets it from the size
	const hang = `\\hangindent=${dim(p.hang[0])}\\hangafter=${p.hang[1]}\\relax`;
	// the width of the page's indent box, the way a \noindent paragraph can open with it (an explicit box
	// draws CJK spacing beside it that TeX's own indent box does not)
	const indent = p.ind > 0 ? `\\hspace*{${dim(p.ind)}}` : '';
	return `${save}${font}${sets.join('')}${hang}\\AddToHookNext{para/after}{\\TexpileParaRestore}${indent}`;
}
