/**
 * A stable color for a name.
 *
 * A live session could hand out colors, but a comment log cannot: it is read on another machine,
 * months later, by someone who was never in a session. Deriving the color from the name means the
 * same person is the same color everywhere, for everyone, with nothing stored.
 *
 * A palette rather than a hashed hue: a hue wheel has stretches nobody would pick for a person,
 * olive and mud and slate among them, and a caret in one of those reads as a piece of the
 * interface rather than as somebody. These eight are all bright, tell each other apart, and carry
 * white text. Hex, because a peer's color crosses the session as untrusted text and the editors
 * only let hex through (see remoteCursors.ts).
 */
export const PRESENCE_COLORS = ['#e11d48', '#d97706', '#059669', '#7c3aed', '#0891b2', '#c026d3', '#65a30d', '#ea580c'] as const;

export function colorFor(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
	return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}
