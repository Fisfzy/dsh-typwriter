// \item[label] labels are shown in the editor as leading bold text, so the serializer has to take
// that text back out before rewriting the bracket. Matching it against the raw source only worked
// for plain ascii labels: a tie, a dash ligature, math or nested markup all missed, and the label
// was written twice (once as [label], once as \textbf in the body). The run now carries its own
// mark, which also makes an edited label editable rather than demoted to bold body text.
import { describe, it, expect } from 'vitest';
import { Fragment, type Node } from 'prosemirror-model';
import { parseLatexFile, serializeLatexFile } from '$lib/workspace/latexRoundtrip';
import { withoutOrigins } from '$lib/editor/visual/parseOrigins';

function parse(body: string) {
	return parseLatexFile(`\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`);
}

function regenerate(body: string): string {
	const parsed = parse(body);
	// forget the source so every block goes through the deterministic rules, which is what an edit does
	const out = serializeLatexFile(parsed, withoutOrigins(parsed.doc));
	return out.slice(out.indexOf('\\begin{document}') + 16, out.lastIndexOf('\\end{document}')).trim();
}

/** replace the first inline node's text, keeping its marks, the way typing in the label would */
function retypeLabel(body: string, typed: string): string {
	const parsed = parse(body);
	const list = parsed.doc.child(0);
	const para = list.child(0);
	const rest: Node[] = [];
	para.forEach((n, _offset, i) => {
		if (i > 0) rest.push(n);
	});
	const edited = para.type.create(para.attrs, [para.type.schema.text(typed, para.child(0).marks), ...rest]);
	const next = list.type.create(list.attrs, Fragment.fromArray([edited]));
	return serializeLatexFile(parsed, parsed.doc.copy(Fragment.fromArray([next])));
}

describe('description item labels', () => {
	for (const label of ['Case~1', '2020--2021', '\\emph{x} y', 'A $x$ B', '(I)', 'Step 1', '\\textbf{Note}']) {
		it(`writes ${JSON.stringify(label)} once`, () => {
			const out = regenerate(`\\begin{description}\n\\item[${label}] body text\n\\end{description}`);
			// the label survives as the bracket, and the body is left holding nothing but the body
			expect(out).toContain(`\\item[${label}]`);
			const body = out
				.replace(/^\\begin\{description\}\s*\\item\[[\s\S]*?\]/, '')
				.replace(/\\par|\\end\{description\}/g, '')
				.trim();
			expect(body).toBe('body text');
		});
	}

	it('drops the bracket when the label text is gone entirely', () => {
		const parsed = parse('\\begin{description}\n\\item[Term] body\n\\end{description}');
		const list = parsed.doc.child(0);
		const para = list.child(0);
		// the whole leading run replaced by unmarked text: nothing is the label any more
		const retyped = para.type.create(para.attrs, para.type.schema.text('something else entirely'));
		const edited = list.type.create(list.attrs, Fragment.fromArray([retyped]));
		const out = serializeLatexFile(parsed, parsed.doc.copy(Fragment.fromArray([edited])));
		expect(out).toMatch(/\\item\s+something else entirely/);
		expect(out).not.toContain('[Term]');
	});

	it('keeps a label on its own paragraph when the item goes on in another', () => {
		const out = regenerate('\\begin{description}\n\\item[Term] \\par\nbody text\n\\end{description}');
		const list = parse(out.slice(out.indexOf('\\begin'))).doc.child(0);
		expect(list.childCount).toBe(2);
		expect(list.child(0).textContent).toBe('Term');
	});
});

// The label is ordinary bold text at the head of the item, so people edit it there. It used to be
// written back from the source regardless of what the editor showed.
describe('editing a description label', () => {
	it('writes the label the user typed', () => {
		const out = retypeLabel('\\begin{description}\n\\item[Term] body text\n\\end{description}', 'Concept');
		expect(out).toContain('\\item[Concept]');
		expect(out).not.toContain('[Term]');
		expect(out).not.toContain('\\textbf{Concept}'); // not left behind in the body as well
	});

	// re-typing the same text must not turn the tie into the no-break space it renders as
	it('keeps the source bytes when the label still says the same thing', () => {
		const out = retypeLabel('\\begin{description}\n\\item[Case~1] body text\n\\end{description}', 'Case\u00a01');
		expect(out).toContain('\\item[Case~1]');
	});

	it('keeps a character typed at the start of the label', () => {
		const out = retypeLabel('\\begin{description}\n\\item[Term] body text\n\\end{description}', ',Term');
		expect(out).toContain('\\item[,Term]');
	});
});

// the labelled paragraph's bytes run from the label to the body, the bracket's `]` between them:
// they read as that paragraph only right after the item's `\item[`
describe('a labelled paragraph away from the head of its item', () => {
	const ITEM = '\\begin{description}\n\\item[Term] its definition.\n\\end{description}';

	it('written on its own, as the paragraph Shift+Tab leaves, keeps its label as bold and no bracket', () => {
		const parsed = parse(ITEM);
		const out = serializeLatexFile(parsed, parsed.doc.copy(Fragment.from(parsed.doc.child(0).child(0))));
		expect(out).toContain('\n\\textbf{Term} its definition.\n');
	});

	it('after a paragraph put in front of it in its item, writes no stray bracket', () => {
		const parsed = parse(ITEM);
		const list = parsed.doc.child(0);
		const lead = list.type.schema.node('paragraph', null, [list.type.schema.text('Lead.')]);
		const next = list.type.create(list.attrs, Fragment.fromArray([lead, list.child(0)]));
		const out = serializeLatexFile(parsed, parsed.doc.copy(Fragment.from(next)));
		expect(out).not.toContain('Term]');
		expect(out).toContain('Term');
	});
});

describe('a bullet item with a label of its own', () => {
	// the label is its math alone: no text for the mark to ride on
	it('keeps a label that is all math as the bracket', () => {
		const out = regenerate('\\begin{itemize}\n  \\item plain\n  \\item[$\\star$] starred\n\\end{itemize}');
		expect(out).toContain('\\item[$\\star$] starred');
	});
});
