import { describe, it, expect } from 'vitest';
import { parseMarkdownFile, serializeMarkdownFile } from '$lib/languages/markdown/visual/roundtrip';
import { roundtrip, gen, editBlock, blockTypes } from './mdTestUtils';

describe('link reference definitions', () => {
	// M1
	it('are blocks of their own, so editing a neighbour keeps them', () => {
		const src = 'para one\n\n[r]: https://r\n\npara two [x][r]\n';
		expect(blockTypes(src)).toEqual(['paragraph', 'raw_latex', 'paragraph']);
		expect(roundtrip(src)).toBe(src);
		expect(editBlock(src, 0, 'EDITED')).toBe('EDITED\n\n[r]: https://r\n\npara two [x][r]\n');
		expect(editBlock(src, 2, 'EDITED')).toBe('para one\n\n[r]: https://r\n\nEDITED\n');
	});

	it('survive at the end of the file and inside a container', () => {
		expect(editBlock('- a\n\n[Unreleased]: https://u/compare\n', 0, 'EDITED')).toBe('EDITED\n\n[Unreleased]: https://u/compare\n');
		expect(gen('> [r]: u\n\n[a][r]\n')).toBe('> [r]: u\n\n[a](u)');
		expect(gen('- [a][r]\n\n  [r]: u\n')).toBe('- [a](u)\n\n  [r]: u');
	});

	it('still resolve the links that use them', () => {
		expect(gen('[a][r] text\n\n[r]: https://r "T"\n')).toBe('[a](https://r "T") text\n\n[r]: https://r "T"');
	});
});

describe('footnotes', () => {
	// M5
	it('definitions are verbatim blocks and references verbatim chips', () => {
		const src = 'Text[^1] and[^note].\n\n[^1]: Note\n[^note]: Longer note text.\n';
		expect(blockTypes(src)).toEqual(['paragraph', 'raw_latex', 'raw_latex']);
		expect(roundtrip(src)).toBe(src);
		expect(gen(src)).toBe('Text[^1] and[^note].\n\n[^1]: Note\n\n[^note]: Longer note text.');
		expect(editBlock(src, 0, 'EDITED')).toBe('EDITED\n\n[^1]: Note\n[^note]: Longer note text.\n');
	});

	it('a multi-line definition stays one block', () => {
		const src = 'x[^a]\n\n[^a]: first line\n    second line\n\nafter\n';
		expect(blockTypes(src)).toEqual(['paragraph', 'raw_latex', 'paragraph']);
		expect(gen(src)).toBe('x[^a]\n\n[^a]: first line\n    second line\n\nafter');
	});

	it('an undefined label is kept as written, not escaped', () => {
		expect(gen('see [^nope]\n')).toBe('see [^nope]');
	});

	// a large edit that takes the definition out: the editor keeps the chip, and so must the file read back
	it('a reference whose definition is deleted reads back as the chip the editor shows', () => {
		const src = 'Text[^1] and more.\n\n[^1]: Note\n';
		const parsed = parseMarkdownFile(src);
		const kept = parsed.doc.copy(parsed.doc.content.cut(0, parsed.doc.child(0).nodeSize));
		const written = serializeMarkdownFile(parsed, kept);
		expect(written).toBe('Text[^1] and more.\n');
		expect(parseMarkdownFile(written).doc.eq(kept)).toBe(true);
	});

	it('a link whose text starts with a caret stays a link', () => {
		expect(gen('[^x](https://x)\n')).toBe('[^x](https://x)');
	});
});
