// Copying out of the markdown editor. The bug this pins: the context menu's Copy served every
// non-typst dialect through sliceToLatex, and PM's schema check does NOT reject md-schema nodes
// under the tex schema's doc - so `## Title` came off the clipboard as `\subsection{Title}`.
import { describe, it, expect } from 'vitest';
import { Slice } from 'prosemirror-model';
import { mdSchema } from '$lib/languages/markdown/visual/schema';
import { sliceToMarkdown } from '$lib/languages/markdown/visual/clipboard';
import { sliceToLatex } from '$lib/editor/visual/extensions/latexClipboard';
import { parseMarkdownFile } from '$lib/languages/markdown/visual/roundtrip';

describe('sliceToMarkdown', () => {
	it('serializes a block selection as markdown, not LaTeX', () => {
		const doc = mdSchema.node('doc', null, [
			mdSchema.node('heading', { level: 2 }, [mdSchema.text('Title')]),
			mdSchema.node('paragraph', null, [mdSchema.text('hello '), mdSchema.text('world', [mdSchema.marks.strong.create()])])
		]);
		expect(sliceToMarkdown(new Slice(doc.content, 0, 0))).toBe('## Title\n\nhello **world**');
		// the regression itself: the same slice through the LaTeX serializer yields tex markup
		expect(sliceToLatex(new Slice(doc.content, 0, 0))).toContain('\\subsection{Title}');
	});

	it('keeps inline marks when the selection is inside one paragraph', () => {
		const doc = mdSchema.node('doc', null, [
			mdSchema.node('paragraph', null, [mdSchema.text('be '), mdSchema.text('bold', [mdSchema.marks.strong.create()])])
		]);
		// from just before 'bold' to the end of the paragraph
		expect(sliceToMarkdown(doc.slice(4, 9))).toBe('**bold**');
	});

	it('re-serializes a partially selected paragraph rather than restoring its whole source', () => {
		// the parse knows the block by node; blockAssembly may only re-emit its bytes for that very
		// block, and a truncated selection is another node with other content
		const { doc } = parseMarkdownFile('the whole original sentence.\n');
		expect(sliceToMarkdown(doc.slice(1, 10))).toBe('the whole');
	});

	it('returns an empty string for an empty slice', () => {
		expect(sliceToMarkdown(Slice.empty)).toBe('');
	});
});
