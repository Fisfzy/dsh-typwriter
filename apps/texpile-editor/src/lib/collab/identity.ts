// how you appear to the other people in a session: your name, and the color it carries
import { userData } from '$lib/storage/userData';
import { colorFor } from '$lib/components/initialColor';
import { guestColor } from './guestColors';

export type PresenceRole = 'host' | 'guest';

export function presenceIdentity(role: PresenceRole, clientId = 0, name = userData.current.collabName): { name: string; color: string } {
	const typed = name.trim();
	return {
		name: typed || (role === 'host' ? 'Host' : 'Guest'),
		color: typed ? colorFor(typed) : guestColor(clientId)
	};
}
