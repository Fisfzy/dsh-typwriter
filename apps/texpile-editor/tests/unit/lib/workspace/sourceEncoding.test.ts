// The verdict itself comes from the bytes in the main process (tests/unit/electron/textDecode);
// this is only the mapping from that verdict to the reason a reader sees.
import { describe, it, expect } from 'vitest';
import { sourceEncodingError } from '$lib/workspace/sourceEncoding';

describe('sourceEncodingError', () => {
	it('opens what Texpile can write back losslessly', () => {
		expect(sourceEncodingError('utf8')).toBeNull();
		expect(sourceEncodingError('utf8bom')).toBeNull();
	});

	it('names the reason for everything else', () => {
		expect(sourceEncodingError('other')).toMatch(/Latin-1/);
		expect(sourceEncodingError('utf16le')).toMatch(/UTF-16/);
		expect(sourceEncodingError('utf16be')).toMatch(/UTF-16/);
		expect(sourceEncodingError('binary')).toMatch(/binary/);
	});
});
