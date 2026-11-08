import { describe, it, expect } from 'vitest';
import { Fragment, type Node } from 'prosemirror-model';
import { parseMarkdownFile, serializeMarkdownFileDetailed } from '$lib/languages/markdown/visual/roundtrip';
import { parseTypstFile } from '$lib/languages/typst/visual/roundtrip';
import { parseLatexFile, serializeLatexFileDetailed } from '$lib/workspace/latexRoundtrip';
import { blockAtPm, blockAtSource, offsetAtPm, pmAtOffset, topBlockAtPm } from '$lib/editor/visual/sourceMap';
import type { SourceMap } from '$lib/editor/visual/sourceSpans';

// a block inside a block: a caret or a comment with no characters of its own resolves inside the
// innermost block holding it, not somewhere in the top-level container, and the map a save makes
// knows the nested blocks as a parse does

function emptyParagraphPos(doc: Node): number {
	let at = -1;
	doc.descendants((n, pos) => {
		if (at < 0 && n.type.name === 'paragraph' && n.content.size === 0) at = pos + 1;
		return at < 0;
	});
	if (at < 0) throw new Error('no empty paragraph');
	return at;
}

describe('the innermost block', () => {
	it('markdown: a caret in an empty list item maps after its marker, not into the next item', () => {
		const src = '- alpha item\n- \n- gamma item\n\nTail.\n';
		const parsed = parseMarkdownFile(src);
		const pos = emptyParagraphPos(parsed.doc);
		const inner = blockAtPm(parsed.map, pos)!;
		expect(inner).not.toBe(topBlockAtPm(parsed.map, pos));
		expect(inner.srcFrom).toBe(src.indexOf('- \n') + 2);
		expect(offsetAtPm(parsed.map, pos, 1)).toBe(src.indexOf('- \n') + 2);
		expect(pmAtOffset(parsed.map, src.indexOf('- \n') + 2, 1)).toBe(pos);
	});

	it('typst: a caret in an empty list item maps after its marker', () => {
		const src = '- alpha item\n- \n- gamma item\n\nTail.\n';
		const parsed = parseTypstFile(src);
		const pos = emptyParagraphPos(parsed.doc);
		const off = offsetAtPm(parsed.map, pos, 1)!;
		expect(off).toBeGreaterThanOrEqual(src.indexOf('- \n') + 1);
		expect(off).toBeLessThanOrEqual(src.indexOf('- \n') + 2);
		expect(blockAtSource(parsed.map, off)!.pmFrom).toBe(pos - 1);
	});

	it('a byte inside a nested item resolves to that item, not the list', () => {
		const src = '- first item wrapped\n  by hand too\n- second item\n  - nested child\n  - nested other\n';
		const parsed = parseMarkdownFile(src);
		const at = src.indexOf('nested other');
		const b = blockAtSource(parsed.map, at)!;
		expect(src.slice(b.srcFrom, b.srcTo)).toBe('nested other');
		expect(topBlockAtSource(parsed.map, at)!.srcFrom).toBe(0);
	});
});

function topBlockAtSource(map: SourceMap, offset: number) {
	// the whole construct's range, for contrast with the innermost one
	return map.blocks.find((b) => b.srcFrom <= offset && offset <= b.srcTo) ?? null;
}

describe('the map a save makes knows the nested blocks', () => {
	function retypeFirstLeaf(doc: Node, path: number[], fn: (t: string) => string): Node {
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

	it('markdown: untouched, spliced and regenerated items all carry their ranges', () => {
		const src = '- first item wrapped\n  by hand too\n- second item\n  - nested child\n  - nested other\n\n> a quote\n> continued\n';
		const parsed = parseMarkdownFile(src);
		const parsedInner = parsed.map.inner!.length;
		// untouched: as the parse had them
		const same = serializeMarkdownFileDetailed(parsed, parsed.doc);
		expect(same.map.inner!.length).toBe(parsedInner);
		// one nested item retyped: the frame splice places every child
		const edited = retypeFirstLeaf(parsed.doc, [1, 2, 0], (t) => t.replace('other', 'OTHER'));
		const { text, map } = serializeMarkdownFileDetailed(parsed, edited);
		expect(map.inner!.length).toBe(parsedInner);
		const at = text.indexOf('nested OTHER');
		expect(text.slice(blockAtSource(map, at)!.srcFrom, blockAtSource(map, at)!.srcTo)).toBe('nested OTHER');
		const child = text.indexOf('nested child');
		expect(text.slice(blockAtSource(map, child)!.srcFrom, blockAtSource(map, child)!.srcTo)).toBe('nested child');
		// a paragraph put into an item afresh: placed by its runs
		const schema = parsed.doc.type.schema;
		const withNew = (() => {
			const item = parsed.doc.child(0);
			const fresh = schema.nodes.paragraph.create(null, schema.text('Brand new.'));
			const kids: Node[] = [];
			item.forEach((c) => kids.push(c));
			kids.push(fresh);
			const list = item.type.create(item.attrs, Fragment.fromArray(kids), item.marks);
			const docKids: Node[] = [];
			parsed.doc.forEach((c, _o, i) => docKids.push(i === 0 ? list : c));
			return parsed.doc.copy(Fragment.fromArray(docKids));
		})();
		const fresh = serializeMarkdownFileDetailed(parsed, withNew);
		const brand = fresh.text.indexOf('Brand new.');
		expect(brand).toBeGreaterThan(0);
		const b = blockAtSource(fresh.map, brand)!;
		expect(fresh.text.slice(b.srcFrom, b.srcTo)).toBe('Brand new.');
	});

	it('latex: a regenerated environment still places the paragraphs inside it', () => {
		const src = `\\documentclass{article}\n\\begin{document}\n\\begin{theorem}\nFirst step here.\n\nSecond step here.\n\\end{theorem}\n\\end{document}\n`;
		const parsed = parseLatexFile(src);
		expect(parsed.map.inner!.length).toBe(2);
		const edited = retypeFirstLeaf(parsed.doc, [0, 1], (t) => t.replace('Second', 'SECOND'));
		const { text, map } = serializeLatexFileDetailed(parsed, edited);
		expect(map.inner!.length).toBe(2);
		const at = text.indexOf('SECOND step');
		expect(text.slice(blockAtSource(map, at)!.srcFrom, blockAtSource(map, at)!.srcTo)).toBe('SECOND step here.');
		const first = text.indexOf('First step');
		expect(text.slice(blockAtSource(map, first)!.srcFrom, blockAtSource(map, first)!.srcTo)).toBe('First step here.');
	});
});
