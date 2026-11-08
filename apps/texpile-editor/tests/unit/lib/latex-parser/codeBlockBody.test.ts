// Where a listing's delimiter newlines live.
//
// `\begin{lstlisting}` and `\end{lstlisting}` each sit on their own line, and those two newlines
// are punctuation, not code - LaTeX itself discards the one after \begin{verbatim}. The importer
// used to hand them to the node, so every block opened with a blank first line and closed with a
// blank last one. The serializer writes both back unconditionally, so they were also duplicated:
// an edited block written out and read again gained a blank line at each end, and kept gaining.
import { describe, it, expect } from 'vitest';
import { Fragment, type Node } from 'prosemirror-model';
import { schema } from '$lib/languages/latex/schema/latexPMSchema';
import { parseLatexFile, serializeLatexFile } from '$lib/workspace/latexRoundtrip';

const wrap = (body: string) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
const CODE = 'def fib(n):\n    return n';

function firstCodeBlock(doc: Node): { node: Node; index: number } {
	for (let i = 0; i < doc.childCount; i++) {
		if (doc.child(i).type.name === 'code_block') return { node: doc.child(i), index: i };
	}
	throw new Error('no code_block');
}

/** replace one top-level child, the way a ProseMirror edit lands: same attrs, new content */
function editCode(doc: Node, index: number, node: Node, text: string): Node {
	const kids: Node[] = [];
	for (let i = 0; i < doc.childCount; i++) kids.push(i === index ? node.type.create(node.attrs, schema.text(text)) : doc.child(i));
	return doc.copy(Fragment.fromArray(kids));
}

describe('verbatim body', () => {
	it('holds the code and nothing else', () => {
		const parsed = parseLatexFile(wrap(`\\begin{lstlisting}[language=Python]\n${CODE}\n\\end{lstlisting}`));
		expect(firstCodeBlock(parsed.doc).node.textContent).toBe(CODE);
	});

	it("keeps blank lines inside the listing, which are the author's", () => {
		const spaced = 'first\n\n\nlast';
		const parsed = parseLatexFile(wrap(`\\begin{verbatim}\n${spaced}\n\\end{verbatim}`));
		expect(firstCodeBlock(parsed.doc).node.textContent).toBe(spaced);
	});

	it('tolerates an indented \\end, whose indentation is not code either', () => {
		const parsed = parseLatexFile(wrap(`\\begin{verbatim}\n${CODE}\n\t\\end{verbatim}`));
		expect(firstCodeBlock(parsed.doc).node.textContent).toBe(CODE);
	});

	// the accumulation: parse -> edit -> serialize -> parse must reach a fixed point, or the file
	// grows a blank line at each end on every save
	it('does not grow on an edit round trip', () => {
		const parsed = parseLatexFile(wrap(`\\begin{lstlisting}\n${CODE}\n\\end{lstlisting}`));
		const { node, index } = firstCodeBlock(parsed.doc);
		const edited = 'def fib(n):\n    return n + 1';

		const once = serializeLatexFile(parsed, editCode(parsed.doc, index, node, edited));
		expect(once).toContain(`\\begin{lstlisting}\n${edited}\n\\end{lstlisting}`);

		const reparsed = parseLatexFile(once);
		expect(firstCodeBlock(reparsed.doc).node.textContent).toBe(edited);

		// and again, since one clean pass could still be the first step of a slow drift
		const twice = firstCodeBlock(reparsed.doc);
		const out = serializeLatexFile(reparsed, editCode(reparsed.doc, twice.index, twice.node, edited));
		expect(firstCodeBlock(parseLatexFile(out).doc).node.textContent).toBe(edited);
	});

	// an untouched block is re-emitted from its captured source, so this path has to agree too
	it('leaves an untouched listing byte-identical', () => {
		const src = wrap(`\\begin{lstlisting}[language=Python]\n${CODE}\n\\end{lstlisting}`);
		const parsed = parseLatexFile(src);
		expect(serializeLatexFile(parsed, parsed.doc)).toContain(`\\begin{lstlisting}[language=Python]\n${CODE}\n\\end{lstlisting}`);
	});
});
