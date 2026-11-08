// offsets between the shared text and the visual editor's, which lacks collaborators' words until a re-parse
// patches them in: a caret read from one and drawn in the other lands ahead or behind by those words otherwise
import { spliceDiff } from './spliceDiff';

export type TextLag = { index: number; remove: number; insert: string } | null;

/** what the shared text holds that the editor's does not show yet */
export function lagOf(local: string, shared: string): TextLag {
	return local === shared ? null : spliceDiff(local, shared);
}

/** a place in the shared text, in the editor's: inside words still on the way, where they will appear */
export function toLocal(lag: TextLag, offset: number): number {
	if (!lag || offset <= lag.index) return offset;
	if (offset >= lag.index + lag.insert.length) return offset - lag.insert.length + lag.remove;
	return lag.index;
}

/** a place in the editor's text, in the shared one */
export function toShared(lag: TextLag, offset: number): number {
	if (!lag || offset <= lag.index) return offset;
	if (offset >= lag.index + lag.remove) return offset + lag.insert.length - lag.remove;
	return lag.index;
}
