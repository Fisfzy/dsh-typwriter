// @vitest-environment jsdom
// The visual diff across the three dialects Texpile edits.
//
// Diffing documents rather than sources is what makes one implementation serve all three - there
// is no offset map per dialect to get wrong. But "it should work" is not evidence: each dialect
// has its own schema, its own attributes and its own node views, and the two things that decide
// whether the diff is right are per-schema. Which nodes render their own content (so a mark has
// to sit ON them), and which attributes are the importer's bookkeeping (so encoding them lights
// the whole document up).
import { describe, it, expect } from 'vitest';
import { parseMarkdownFile } from '$lib/languages/markdown/visual/roundtrip';
import { parseTypstFile } from '$lib/languages/typst/visual/roundtrip';
import { docChanges, changeDecorations } from '$lib/editor/visual/diff/docChanges';
import type { Node as PMNode } from 'prosemirror-model';

type Parse = (src: string) => PMNode;
const md: Parse = (src) => parseMarkdownFile(src).doc;
const typ: Parse = (src) => parseTypstFile(src).doc;

function added(parse: Parse, before: string, after: string): string[] {
	const newDoc = parse(after);
	return changeDecorations(parse(before), newDoc)
		.find()
		.filter((d) => d.spec?.diff === 'inline')
		.map((d) => newDoc.textBetween(d.from, d.to, ' ', ' ').trim())
		.filter(Boolean);
}

function markedNodes(parse: Parse, before: string, after: string): string[] {
	const newDoc = parse(after);
	return changeDecorations(parse(before), newDoc)
		.find()
		.filter((d) => d.spec?.diff === 'node')
		.map((d) => newDoc.nodeAt(d.from)?.type.name ?? '?');
}

describe('the visual diff in Markdown', () => {
	it('marks exactly the inserted words', () => {
		expect(added(md, 'The cat sat.', 'The very large cat sat.')).toEqual(['very large']);
	});

	it('finds nothing between identical documents', () => {
		expect(docChanges(md('# Title\n\nBody text.'), md('# Title\n\nBody text.'))).toEqual([]);
	});

	// CodeMirror renders a fenced block's text, so an inline mark inside it would paint nothing
	it('marks a fenced code block as a node', () => {
		const before = '# Title\n\n```js\nconst a = 1;\n```';
		const after = '# Title\n\n```js\nconst b = 2;\n```';
		expect(markedNodes(md, before, after)).toEqual(['code_block']);
	});

	it('does not light up the blocks nobody touched', () => {
		const before = 'First para.\n\nSecond para.\n\nThird para.';
		const after = 'First para.\n\nSecond para, edited.\n\nThird para.';
		expect(added(md, before, after).join(' ')).toContain('edited');
		expect(markedNodes(md, before, after)).toEqual([]);
	});
});

describe('the visual diff in Typst', () => {
	it('marks exactly the inserted words', () => {
		expect(added(typ, 'The cat sat.', 'The very large cat sat.')).toEqual(['very large']);
	});

	it('finds nothing between identical documents', () => {
		expect(docChanges(typ('= Title\n\nBody text.'), typ('= Title\n\nBody text.'))).toEqual([]);
	});

	it('marks a formula as a node, since MathLive renders it', () => {
		expect(markedNodes(typ, 'Text $a + b$ here.', 'Text $a + c$ here.')).toEqual(['inline_math']);
	});

	it('does not light up the blocks nobody touched', () => {
		const before = 'First para.\n\nSecond para.\n\nThird para.';
		const after = 'First para.\n\nSecond para, edited.\n\nThird para.';
		expect(added(typ, before, after).join(' ')).toContain('edited');
		expect(markedNodes(typ, before, after)).toEqual([]);
	});
});
