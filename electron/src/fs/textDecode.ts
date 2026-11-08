// A text read: the bytes decoded, plus the encoding they were found in. Detection is byte-level
// (binaryProbe, VS Code's), then a strict UTF-8 check on top: Texpile writes UTF-8 only, so a file
// it cannot read losslessly opens read-only instead of being mangled on the first save.
import { isUtf8 } from 'node:buffer';
import { detectText, type TextEncoding } from './binaryProbe';

/** 'other' is a legacy 8-bit encoding such as Latin-1: readable, not writable back as UTF-8 */
export type SourceEncoding = TextEncoding | 'binary' | 'other';

export function decodeText(bytes: Buffer): { content: string; encoding: SourceEncoding } {
	const { binary, encoding } = detectText(bytes, bytes.length);
	if (binary) return { content: bytes.toString('utf-8'), encoding: 'binary' };
	if (encoding === 'utf16le' || encoding === 'utf16be') {
		const even = bytes.length % 2 ? bytes.subarray(0, bytes.length - 1) : bytes;
		const le = encoding === 'utf16le' ? even : Buffer.from(even).swap16();
		return { content: le.toString('utf16le').replace(/^\uFEFF/, ''), encoding };
	}
	return { content: bytes.toString('utf-8'), encoding: isUtf8(bytes) ? encoding : 'other' };
}
