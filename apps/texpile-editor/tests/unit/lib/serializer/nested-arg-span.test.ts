// A block whose last argument ends in a nested call (`\section{Proof of Theorem~\ref{thm:main}}`)
// had its verbatim slice end one brace short: the missing `}` fell into the inter-block gap and
// was lost the moment the NEXT block regenerated. A runaway argument at compile time.
import { describe, it, expect } from 'vitest';
import { Fragment, type Node } from 'prosemirror-model';
import { schema } from '$lib/languages/latex/schema/latexPMSchema';
import { parseLatexFile, serializeLatexFile } from '$lib/workspace/latexRoundtrip';

function file(body: string): string {
	return `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
}

/** replace the paragraph holding `text` with one plain paragraph, so the block after the block
 * under test regenerates while the block under test stays pristine */
function editParagraph(doc: Node, text: string): Node {
	const kids: Node[] = [];
	for (let i = 0; i < doc.childCount; i++) {
		const child = doc.child(i);
		kids.push(child.textContent.includes(text) ? schema.node('paragraph', null, [schema.text('EDITED')]) : child);
	}
	return doc.copy(Fragment.fromArray(kids));
}

function saveAfterEditing(body: string, text: string): string {
	const parsed = parseLatexFile(file(body));
	return serializeLatexFile(parsed, editParagraph(parsed.doc, text));
}

describe('verbatim span of a block ending inside a nested argument', () => {
	it.each([
		'\\section{Proof of Theorem~\\ref{thm:main}}',
		'\\section{Related Work\\label{sec:rel}}',
		'\\subsection{\\texttt{code}}',
		'\\section{Title\\footnote{note}}'
	])('%s keeps its closing brace when the next paragraph is edited', (heading) => {
		const out = saveAfterEditing(`${heading}\n\nBody text here.`, 'Body text');
		expect(out).toContain(heading);
		expect(out).toContain('EDITED');
	});

	it('a paragraph ending in nested inline macros keeps every closer', () => {
		const out = saveAfterEditing('Text \\textbf{a\\emph{b}}\n\nNext paragraph.', 'Next paragraph');
		expect(out).toContain('Text \\textbf{a\\emph{b}}');
	});

	it('an untouched save is still byte-identical', () => {
		const src = file('\\section{Proof of Theorem~\\ref{thm:main}}\n\nBody text here.');
		const parsed = parseLatexFile(src);
		expect(serializeLatexFile(parsed, parsed.doc)).toBe(src);
	});
});
