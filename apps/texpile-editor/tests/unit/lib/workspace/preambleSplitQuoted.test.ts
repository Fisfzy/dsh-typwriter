// a \begin{document} written inside a preamble filecontents block was taken as the real one, so
// the real \usepackage lines and wrapper ended up inside one editable paragraph
import { describe, it, expect } from 'vitest';
import { parseLatexFile, serializeLatexFile } from '$lib/workspace/latexRoundtrip';

const FILE = `\\documentclass{article}
\\begin{filecontents}{sub.tex}
\\documentclass{article}
\\begin{document}
inner
\\end{document}
\\end{filecontents}
\\usepackage{amsmath}
\\begin{document}
Real body.
\\end{document}
`;

// a chapter about LaTeX that spells the wrapper out in \verb was split at the \verb, and the
// visual editor showed the eleven characters between the two
const CHAPTER = `\\chapter{Splitting}

The file is split at the first \\verb|\\begin{document}| and the last \\verb|\\end{document}|.

\\begin{lstlisting}
\\begin{document}
\\end{document}
\\end{lstlisting}

More prose after the listing.
`;

describe('preamble split', () => {
	it('skips a \\begin{document} quoted inside filecontents', () => {
		const parsed = parseLatexFile(FILE);
		expect(parsed.preamble).toContain('\\usepackage{amsmath}');
		expect(parsed.preamble.endsWith('\\begin{document}')).toBe(true);
		expect(parsed.doc.textContent).toContain('Real body.');
		expect(parsed.doc.textContent).not.toContain('usepackage');
		expect(serializeLatexFile(parsed, parsed.doc)).toBe(FILE);
	});

	it('skips markers inside \\verb and listings, so a chapter stays a fragment', () => {
		const parsed = parseLatexFile(CHAPTER);
		expect(parsed.hadDocumentEnv).toBe(false);
		expect(parsed.doc.textContent).toContain('More prose after the listing.');
		expect(serializeLatexFile(parsed, parsed.doc)).toBe(CHAPTER);
	});

	it('still finds the real wrapper after a quoted one', () => {
		const file = `\\documentclass{article}\n\\begin{document}\nSee \\verb|\\begin{document}| here.\n\\end{document}\n`;
		const parsed = parseLatexFile(file);
		expect(parsed.hadDocumentEnv).toBe(true);
		expect(parsed.doc.textContent).toContain('See');
		expect(serializeLatexFile(parsed, parsed.doc)).toBe(file);
	});
});
