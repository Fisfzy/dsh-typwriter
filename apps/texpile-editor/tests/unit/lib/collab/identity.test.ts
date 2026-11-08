// a chosen name has to win over both roles' defaults, and the color has to be the one that name
// carries on a comment, or the same person is two colors in one window
import { describe, it, expect, beforeEach } from 'vitest';
import { presenceIdentity } from '$lib/collab/identity';
import { colorFor } from '$lib/components/initialColor';
import { GUEST_COLORS } from '$lib/collab/guestColors';
import { updateUserData } from '$lib/storage/userData';

describe('presence identity', () => {
	beforeEach(() => updateUserData({ collabName: '' }));

	it('falls back to the role, and keeps two nameless peers apart', () => {
		expect(presenceIdentity('host')).toEqual({ name: 'Host', color: GUEST_COLORS[0] });
		expect(presenceIdentity('guest', 1)).toEqual({ name: 'Guest', color: GUEST_COLORS[1] });
	});

	it('uses the profile for both roles, in the nameable color', () => {
		updateUserData({ collabName: '  Mei  ' });
		expect(presenceIdentity('host')).toEqual({ name: 'Mei', color: colorFor('Mei') });
		expect(presenceIdentity('guest', 1)).toEqual({ name: 'Mei', color: colorFor('Mei') });
	});

	// the visual editor lets only hex through before a peer's color reaches a style string, so an
	// hsl one rendered every named peer in the same fallback grey (see remoteCursors.ts)
	it('hands out a color the editors will draw', () => {
		for (const name of ['Mei', 'Louis', 'a', 'Ada Lovelace', '张伟']) {
			updateUserData({ collabName: name });
			expect(presenceIdentity('host').color).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it('takes the name handed to it over the stored one', () => {
		updateUserData({ collabName: 'Mei' });
		expect(presenceIdentity('guest', 0, 'Louis').name).toBe('Louis');
	});
});
