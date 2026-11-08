import { it, expect } from 'vitest';
import { lagOf, toLocal, toShared } from '$lib/collab/lagOffsets';

it("draws a collaborator's caret where their words will appear, not ahead by them", () => {
	const local = 'We prove the bound.';
	const shared = 'We prove THEIRS the bound.';
	const lag = lagOf(local, shared);
	// their caret, at the end of what they typed
	expect(toLocal(lag, shared.indexOf('the bound'))).toBe(local.indexOf('the bound'));
	// inside words still on the way: where they will appear
	expect(toLocal(lag, shared.indexOf('EIRS'))).toBe(local.indexOf('the bound'));
	expect(toLocal(lag, shared.indexOf('bound'))).toBe(local.indexOf('bound'));
	// and this side's caret after the words, in the shared text
	expect(toShared(lag, local.indexOf('bound'))).toBe(shared.indexOf('bound'));
	expect(toShared(lagOf(shared, shared), 5)).toBe(5);
});
