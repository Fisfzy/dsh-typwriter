// Papers define their own display-math shortcuts: \newcommand{\bea}{\begin{eqnarray}} paired with
// \newcommand{\eea}{\end{eqnarray}}. Only the pair of definitions says the span between the two is
// maths; read as prose, every ^ and _ inside it gets text-escaped into something that no longer
// compiles. \def-defined pairs were already understood, \newcommand ones were not.
import { describe, it, expect } from 'vitest';
import { parseLatexFile, serializeLatexFile } from '$lib/workspace/latexRoundtrip';
import { withoutOrigins } from '$lib/editor/visual/parseOrigins';

const PREAMBLE =
	'\\documentclass{article}\n\\newcommand{\\bea}{\\begin{eqnarray}}\n\\newcommand{\\eea}{\\end{eqnarray}}\n\\begin{document}\n';

function regenerate(body: string): string {
	const parsed = parseLatexFile(`${PREAMBLE}${body}\n\\end{document}\n`);
	// forget the source so every block regenerates, which is what an edit does
	return serializeLatexFile(parsed, withoutOrigins(parsed.doc));
}

describe('newcommand-defined math environment shortcuts', () => {
	it('keeps the maths between the pair verbatim', () => {
		const out = regenerate('Then we have \\bea\ng^{AB} = x_1 + y^2.\n\\eea');
		expect(out).toContain('g^{AB} = x_1 + y^2.');
		expect(out).not.toContain('\\^{}'); // the prose path would escape the superscript
	});

	// a list item's body is an argument of \item, which the span walk used to skip
	it('reaches a span inside a list item', () => {
		const out = regenerate('\\begin{enumerate}\n\\item If $f$, \\bea\na^{2}_k = b.\n\\eea\n\\end{enumerate}');
		expect(out).toContain('a^{2}_k = b.');
		expect(out).not.toContain('\\^{}');
	});

	// a group is reprinted by printRaw, which cannot see the mark: splicing the span out of one
	// deleted the maths outright, which is worse than escaping it
	it('leaves a span inside a group alone rather than losing it', () => {
		const out = regenerate('{\\it Assumption \\bea\nN^{(En)} \\le e,\n\\eea}');
		expect(out).toContain('N^');
		expect(out).toContain('\\le e,');
	});
});
