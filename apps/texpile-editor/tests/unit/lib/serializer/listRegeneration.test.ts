// A list regenerates as a whole group the moment one word inside it changes, so the shape it comes
// back in is what the reader is left with. See the verbatim layer in blockAssembly.
import { describe, it, expect } from 'vitest';
import { parseLatexFile, serializeLatexFile } from '$lib/workspace/latexRoundtrip';
import type { Node as PMNode } from 'prosemirror-model';

function doc(body: string) {
	return ['\\documentclass{article}', '\\begin{document}', body, '\\end{document}', ''].join('\n');
}

/** swap a word wherever it appears, the way typing over it would */
function swap(node: PMNode, from: string, to: string): PMNode {
	const json = JSON.parse(JSON.stringify(node.toJSON()));
	const walk = (n: Record<string, unknown>) => {
		if (typeof n.text === 'string' && n.text.includes(from)) n.text = (n.text as string).replace(from, to);
		if (Array.isArray(n.content)) for (const c of n.content) walk(c as Record<string, unknown>);
	};
	walk(json);
	return node.type.schema.nodeFromJSON(json);
}

/** what the file becomes once one word forces the block to regenerate */
function afterEditing(src: string, from: string, to: string): string {
	const p = parseLatexFile(src);
	return serializeLatexFile(p, swap(p.doc, from, to));
}

const CASES: [string, string][] = [
	['plain items', '\\begin{itemize}\n\\item A coarse grid resolves the flow.\n\\item A fine grid resolves the shock.\n\\end{itemize}'],
	[
		'a numbered list',
		'\\begin{enumerate}\n\\item A coarse grid resolves the flow.\n\\item A fine grid resolves the shock.\n\\end{enumerate}'
	],
	['one item only', '\\begin{itemize}\n\\item A coarse grid resolves the flow.\n\\end{itemize}'],
	[
		'prose on both sides',
		'Before the list.\n\n\\begin{itemize}\n\\item A coarse grid resolves the flow.\n\\end{itemize}\n\nAfter the list.'
	],
	[
		'labelled items',
		'\\begin{itemize}\n\\item[Note] A coarse grid resolves the flow.\n\\item[Also] A fine grid resolves the shock.\n\\end{itemize}'
	],
	[
		'an item holding two paragraphs',
		'\\begin{itemize}\n\\item A coarse grid resolves the flow.\n\nA second paragraph of the same item.\n\\item A fine grid resolves the shock.\n\\end{itemize}'
	],
	[
		'a nested list',
		'\\begin{itemize}\n\\item A coarse grid resolves the flow.\n\\begin{itemize}\n\\item A nested point.\n\\end{itemize}\n\\item A fine grid resolves the shock.\n\\end{itemize}'
	]
];

describe('a list that one edit forces to regenerate', () => {
	for (const [name, body] of CASES) {
		const src = doc(body);

		it(`${name}: an untouched save is byte-identical`, () => {
			const p = parseLatexFile(src);
			expect(serializeLatexFile(p, p.doc)).toBe(src);
		});

		it(`${name}: one word changed rewrites only that word`, () => {
			expect(afterEditing(src, 'coarse', 'crude')).toBe(src.replace('coarse', 'crude'));
		});
	}

	// the shape it must never come back in: the item text pushed onto its own line behind a \par
	it('never puts an item body on its own line', () => {
		const src = doc('\\begin{itemize}\n\\item A coarse grid resolves the flow.\n\\end{itemize}');
		const got = afterEditing(src, 'coarse', 'crude');
		expect(got).not.toMatch(/\\item\s*\n/);
		expect(got).not.toContain('\\par');
	});
});
