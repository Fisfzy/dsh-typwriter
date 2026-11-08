// Blocks separated by a SINGLE newline must keep that separator across a no-edit save.
//
// Found by running our round trip over typst's own test suite (text/raw.typ). A code fence could
// never be recognised as pristine, so it always regenerated - and regeneration forces exactly one
// blank line between blocks. `#set page(..)` written directly above a fence came back with a blank
// line inserted, on every single save, in a file the user had not touched.
//
// Both dialects are covered because both had the defect, and the machinery underneath
// (blockAssembly) is shared with LaTeX.
import { describe, it, expect } from 'vitest';
import { parseTypstFile, serializeTypstFile } from '$lib/languages/typst/visual/roundtrip';
import { parseMarkdownFile, serializeMarkdownFile } from '$lib/languages/markdown/visual/roundtrip';

const FENCE = '```';

const TYPST: Record<string, string> = {
	'set rule then fence': `#set page(width: auto)\n${FENCE}typ\nx\n${FENCE}\n`,
	'fence then set rule': `${FENCE}typ\nx\n${FENCE}\n#set page(width: auto)\n`,
	'paragraph then fence': `Text.\n${FENCE}typ\nx\n${FENCE}\n`,
	'fence then paragraph': `${FENCE}typ\nx\n${FENCE}\nText.\n`,
	'a real blank line stays exactly one': `#set page(width: auto)\n\n${FENCE}typ\nx\n${FENCE}\n`,
	'two fences back to back': `${FENCE}typ\na\n${FENCE}\n${FENCE}typ\nb\n${FENCE}\n`
};

const MARKDOWN: Record<string, string> = {
	'paragraph then fence': `Text.\n${FENCE}js\nx\n${FENCE}\n`,
	'fence then paragraph': `${FENCE}js\nx\n${FENCE}\nText.\n`,
	'a real blank line stays exactly one': `Text.\n\n${FENCE}js\nx\n${FENCE}\n`
};

describe('typst: a single newline between blocks survives a no-edit save', () => {
	for (const [name, src] of Object.entries(TYPST)) {
		it(name, () => {
			const parsed = parseTypstFile(src);
			expect(serializeTypstFile(parsed, parsed.doc)).toBe(src);
		});
	}
});

describe('markdown: the same schema line had the same effect', () => {
	for (const [name, src] of Object.entries(MARKDOWN)) {
		it(name, () => {
			const parsed = parseMarkdownFile(src);
			expect(serializeMarkdownFile(parsed, parsed.doc)).toBe(src);
		});
	}
});
