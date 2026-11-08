import { describe, it, expect } from 'vitest';
import { formatShareCode, generateShareCode, normalizeShareCode, isValidShareCode } from '$lib/collab/e2e/shareCode';
import { deriveSessionKeys, sha256Hex } from '$lib/collab/e2e/keys';
import { seal, unseal } from '$lib/collab/e2e/seal';

describe('collab crypto', () => {
	it('generates valid, distinct share codes', () => {
		const a = generateShareCode();
		const b = generateShareCode();
		expect(isValidShareCode(a)).toBe(true);
		expect(isValidShareCode(b)).toBe(true);
		expect(a).not.toBe(b);
		expect(a).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){4}-[A-Z2-9]$/);
	});

	it('normalizes separator and case noise to the same derivations', async () => {
		const code = generateShareCode();
		const sloppy = code.toLowerCase().replace(/-/g, ' ');
		expect(normalizeShareCode(sloppy)).toBe(normalizeShareCode(code));
		const k1 = await deriveSessionKeys(code);
		const k2 = await deriveSessionKeys(sloppy);
		expect(k1.roomId).toBe(k2.roomId);
		expect(k1.joinProof).toBe(k2.joinProof);
	});

	// what the join field applies on every keystroke, so a typed code ends up looking like the one
	// being read off the host's screen rather than 26 undifferentiated characters
	describe('formatShareCode', () => {
		it('leaves a generated code exactly as generated', () => {
			const code = generateShareCode();
			expect(formatShareCode(code)).toBe(code);
		});

		it('groups a bare code, and adds NO trailing separator at a boundary', () => {
			// the load-bearing case: a trailing hyphen here would be re-added the moment backspace
			// removed it, and the field could never be deleted backwards through
			expect(formatShareCode('ABCDE')).toBe('ABCDE');
			expect(formatShareCode('ABCDEF')).toBe('ABCDE-F');
			expect(formatShareCode('ABCDEFGHJKMNPQRSTVWXYZ2345')).toBe('ABCDE-FGHJK-MNPQR-STVWX-YZ234-5');
		});

		it('is idempotent, since it runs over its own output every keystroke', () => {
			const code = generateShareCode();
			for (const s of [code, 'ABCDEF', 'abc de-fgh', '']) expect(formatShareCode(formatShareCode(s))).toBe(formatShareCode(s));
		});

		it('never changes which code was entered', () => {
			for (const s of ['abcdefghjkmnpqrstvwxyz2345', 'ABCDE FGHJK/MNPQR', 'a-b-c-d-e-f'])
				expect(normalizeShareCode(formatShareCode(s))).toBe(normalizeShareCode(s).slice(0, 26));
		});

		it('caps at a full code, so pasting something longer cannot grow the field', () => {
			const long = formatShareCode('ABCDEFGHJKMNPQRSTVWXYZ2345' + 'EXTRA');
			expect(normalizeShareCode(long)).toHaveLength(26);
			expect(isValidShareCode(long)).toBe(true);
		});

		it('keeps the letters the alphabet omits, so a mistyped code fails visibly', () => {
			// I/L/O/U have no digit to fold into (0 and 1 are excluded too), so there is nothing to
			// correct them TO. Swallowing them would leave the field looking complete with a character
			// silently gone; kept, it just stays invalid
			expect(formatShareCode('AIBLC')).toBe('AIBLC');
			expect(isValidShareCode(formatShareCode('ABCDEFGHJKMNPQRSTVWXYZ234I'))).toBe(false);
			// punctuation and the excluded DIGITS do go, which is what makes a pasted code paste cleanly
			expect(formatShareCode('AB/CD 01E')).toBe('ABCDE');
		});
	});

	it('derives room, proof, and key that differ from each other and per code', async () => {
		const k1 = await deriveSessionKeys(generateShareCode());
		const k2 = await deriveSessionKeys(generateShareCode());
		expect(k1.roomId).not.toBe(k2.roomId);
		expect(k1.joinProof).not.toBe(k2.joinProof);
		expect(k1.roomId).not.toBe(k1.joinProof);
		expect(k1.roomId).toHaveLength(32);
		expect(k1.joinProof).toHaveLength(64);
		expect(await sha256Hex(k1.joinProof)).toHaveLength(64);
	});

	it('seal/unseal round-trips and rejects tampering and foreign keys', async () => {
		const { contentKey } = await deriveSessionKeys(generateShareCode());
		const msg = new TextEncoder().encode('hello \\LaTeX{} world');
		const sealed = await seal(contentKey, msg);
		expect(new Uint8Array(await unseal(contentKey, sealed))).toEqual(msg);
		// distinct nonces: sealing twice never yields the same bytes
		expect(await seal(contentKey, msg)).not.toEqual(sealed);
		const flipped = sealed.slice();
		flipped[flipped.length - 1] ^= 0xff;
		await expect(unseal(contentKey, flipped)).rejects.toThrow();
		const other = await deriveSessionKeys(generateShareCode());
		await expect(unseal(other.contentKey, sealed)).rejects.toThrow();
	});
});
