// Every row is a real byte sequence, decoded the way fsService.read() decodes it.
import { describe, expect, it } from 'vitest';
import { decodeText } from '../../../../../electron/src/fs/textDecode';

const TEXT = '\\section{Caf\u00e9}\nDer wei\u00df.\n';
const ASCII = '\\section{Plain}\nNo accents.\n';

const utf16be = (s: string) => Buffer.from(s, 'utf16le').swap16();
const withBom = (bom: number[], body: Buffer) => Buffer.concat([Buffer.from(bom), body]);

describe('decodeText', () => {
	it('reads UTF-8, with or without a BOM, and keeps the BOM as text', () => {
		expect(decodeText(Buffer.from(TEXT, 'utf8'))).toEqual({ content: TEXT, encoding: 'utf8' });
		expect(decodeText(withBom([0xef, 0xbb, 0xbf], Buffer.from(TEXT, 'utf8')))).toEqual({
			content: '\uFEFF' + TEXT,
			encoding: 'utf8bom'
		});
	});

	// a file that went through a lossy conversion carries the replacement character as content;
	// the text scan this replaced called that "not UTF-8" and locked the file
	it('a literal U+FFFD is content, not a decoding error', () => {
		const text = 'co\uFFFDncides\n';
		expect(decodeText(Buffer.from(text, 'utf8'))).toEqual({ content: text, encoding: 'utf8' });
	});

	it('a legacy 8-bit encoding is readable but marked, so it opens read-only', () => {
		const r = decodeText(Buffer.from(TEXT, 'latin1'));
		expect(r.encoding).toBe('other');
		expect(r.content).toContain('Caf\uFFFD');
	});

	// pure ASCII in UTF-16 is the case a decode check alone misses: its padding NULs are valid UTF-8
	it('UTF-16 is decoded for reading, with or without a BOM, pure ASCII included', () => {
		expect(decodeText(withBom([0xff, 0xfe], Buffer.from(TEXT, 'utf16le')))).toEqual({ content: TEXT, encoding: 'utf16le' });
		expect(decodeText(withBom([0xfe, 0xff], utf16be(TEXT)))).toEqual({ content: TEXT, encoding: 'utf16be' });
		expect(decodeText(Buffer.from(ASCII, 'utf16le'))).toEqual({ content: ASCII, encoding: 'utf16le' });
		expect(decodeText(utf16be(ASCII))).toEqual({ content: ASCII, encoding: 'utf16be' });
	});

	it('a zero byte off the UTF-16 grid is binary', () => {
		expect(decodeText(Buffer.from([0x41, 0x42, 0x00, 0x00, 0x43, 0x44, 0x00, 0x45])).encoding).toBe('binary');
	});
});
