import { m } from '$lib/paraglide/messages';

/** what the main process found in the bytes (electron/src/fs/textDecode.ts); 'other' is a legacy 8-bit encoding */
export type SourceEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'binary' | 'other';

export type SourceRead = { text: string; encoding: SourceEncoding };

/** Texpile reads and writes UTF-8 only; anything else opens read-only rather than being saved back mangled. */
export function sourceEncodingError(encoding: SourceEncoding): string | null {
	if (encoding === 'utf16le' || encoding === 'utf16be') return m.wsview_load_error_utf16();
	if (encoding === 'other') return m.wsview_load_error_not_utf8();
	if (encoding === 'binary') return m.wsview_read_only_binary();
	return null;
}
