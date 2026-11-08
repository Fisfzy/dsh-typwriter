// a stable presence color per client id, from the palette a name draws from
import { PRESENCE_COLORS } from '$lib/components/initialColor';

export const GUEST_COLORS = PRESENCE_COLORS;
export function guestColor(clientId: number): string {
	return GUEST_COLORS[clientId % GUEST_COLORS.length];
}
