// the runs a regenerated list lands at are kept on its first item, which an edit to another item
// leaves untouched: they must be made again for the new members, not reused from the last save
import { describe, it, expect } from 'vitest';
import { Fragment, type Node } from 'prosemirror-model';
import { parseLatexFile, serializeLatexFileDetailed } from '$lib/workspace/latexRoundtrip';
import { parseMarkdownFile, serializeMarkdownFileDetailed } from '$lib/languages/markdown/visual/roundtrip';
import { pmToSource } from '$lib/editor/visual/sourceSpans';

function retype(doc: Node, path: number[], fn: (t: string) => string): Node {
	function go(node: Node, depth: number): Node {
		const kids: Node[] = [];
		if (depth === path.length) {
			let done = false;
			node.forEach((c) => {
				if (!done && c.isText) {
					kids.push(c.type.schema.text(fn(c.text!), c.marks));
					done = true;
				} else kids.push(c);
			});
		} else node.forEach((c, _o, i) => kids.push(i === path[depth] ? go(c, depth + 1) : c));
		return node.type.create(node.attrs, Fragment.fromArray(kids), node.marks);
	}
	return go(doc, 0);
}

function posOf(doc: Node, needle: string): number {
	let found = -1;
	doc.descendants((n, pos) => {
		if (found >= 0 || !n.isText) return found < 0;
		const at = n.text!.indexOf(needle);
		if (at >= 0) found = pos + at;
		return false;
	});
	if (found < 0) throw new Error(`no ${needle}`);
	return found;
}

describe('the runs of a regenerated construct', () => {
	it('markdown: are made for the edit at hand, not reused from an earlier edit that landed at the same place', () => {
		const md = '- first\n- second item\n  wrapped\n- third\n';
		const parsed = parseMarkdownFile(md);
		// two edits to the second item: both regenerate the list at offset 0 with the same neighbours
		serializeMarkdownFileDetailed(
			parsed,
			retype(parsed.doc, [1, 0], (t) => t.replace('second', 'seconX'))
		);
		// the second grows, so every run after it lands elsewhere than after the first edit
		const edited = retype(parsed.doc, [1, 0], (t) => t.replace('second', 'SECOND and longer'));
		const { text, map } = serializeMarkdownFileDetailed(parsed, edited);
		for (const word of ['first', 'SECOND', 'longer', 'wrapped', 'third']) {
			const off = pmToSource(map.leaves, posOf(edited, word) + 1);
			expect(off, word).not.toBeNull();
			expect(text.slice(off! - 1, off! - 1 + word.length)).toBe(word);
		}
	});

	it('latex: the same, for an itemize', () => {
		const tex =
			'\\documentclass{article}\n\\begin{document}\n\\begin{itemize}\n\\item first\n\\item second item\n\\item third\n\\end{itemize}\n\\end{document}\n';
		const parsed = parseLatexFile(tex);
		serializeLatexFileDetailed(
			parsed,
			retype(parsed.doc, [1, 0], (t) => t.replace('second', 'seconX'))
		);
		const edited = retype(parsed.doc, [1, 0], (t) => t.replace('second', 'SECOND and longer'));
		const { text, map } = serializeLatexFileDetailed(parsed, edited);
		for (const word of ['first', 'SECOND', 'longer', 'third']) {
			const off = pmToSource(map.leaves, posOf(edited, word) + 1);
			expect(off, word).not.toBeNull();
			expect(text.slice(off! - 1, off! - 1 + word.length)).toBe(word);
		}
	});
});
