import { describe, it, expect } from 'vitest';
import { roundtrip, editBlock, blockTypes } from './mdTestUtils';
import { parseMarkdownFile } from '$lib/languages/markdown/visual/roundtrip';

const BOM = String.fromCharCode(0xfeff);

describe('file edges', () => {
	// M4
	it('a byte order mark stays out of the body and comes back on save', () => {
		const src = `${BOM}---\ntitle: x\n---\n\n# T\n`;
		const parsed = parseMarkdownFile(src);
		expect(parsed.preamble).toBe(`${BOM}---\ntitle: x\n---`);
		expect(parsed.doc.child(0).type.name).toBe('heading');
		expect(roundtrip(src)).toBe(src);
		expect(editBlock(src, 0, 'EDITED')).toBe(`${BOM}---\ntitle: x\n---\n\nEDITED\n`);
		expect(parseMarkdownFile(`${BOM}# T\n`).doc.child(0).type.name).toBe('heading');
		expect(editBlock(`${BOM}# T\n`, 0, 'EDITED')).toBe(`${BOM}EDITED\n`);
	});

	// M6
	it('CR-only line endings do not duplicate the body', () => {
		const src = '# T\r\rpara one\r\rpara two\r';
		expect(roundtrip(src)).toBe(src);
		expect(editBlock(src, 1, 'EDITED')).toBe('# T\n\nEDITED\n\npara two\r');
	});

	// M23
	it('a CRLF file gets CRLF in its regenerated blocks', () => {
		const src = '# T\r\n\r\npara one\r\n\r\npara two\r\n';
		expect(roundtrip(src)).toBe(src);
		expect(editBlock(src, 1, 'EDITED')).toBe('# T\r\n\r\nEDITED\r\n\r\npara two\r\n');
	});

	// M19
	it('frontmatter needs a key line, and closes on ... or +++ too', () => {
		const hr = '---\n\ntext\n\n---\n\nmore\n';
		expect(parseMarkdownFile(hr).hadDocumentEnv).toBe(false);
		expect(blockTypes(hr)).toEqual(['horizontal_rule', 'paragraph', 'horizontal_rule', 'paragraph']);
		const dots = '---\na: 1\n...\n\ntext\n';
		const toml = '+++\ntitle = "x"\n+++\n\ntext\n';
		expect(parseMarkdownFile(dots).preamble).toBe('---\na: 1\n...');
		expect(parseMarkdownFile(toml).preamble).toBe('+++\ntitle = "x"\n+++');
		for (const src of [hr, dots, toml]) expect(roundtrip(src)).toBe(src);
		expect(editBlock(dots, 0, 'EDITED')).toBe('---\na: 1\n...\n\nEDITED\n');
		expect(editBlock(toml, 0, 'EDITED')).toBe('+++\ntitle = "x"\n+++\n\nEDITED\n');
	});
});
