// A one-way tick from "follow just sent a scroll" to the preview frame host.
//
// The viewer draws its jump ripple for every jump frame, and a follow jump must not draw one -
// but follow's frames are indistinguishable from a one-shot sync's on the wire. Only the sender
// knows which is which, and the sender (WorkspaceView's caret debounce) has no reference to the
// frame. This store is the wire between them: the sender bumps it, TypstPreview forwards a
// `quiet` message into the frame, and the bridge there swallows ripples for the next half second.
import { box } from '$lib/runes/box.svelte';

/** bumped once per follow scroll actually sent (after every guard has passed) */
export const followScrollTick = box(0);

export function noteFollowScroll(): void {
	followScrollTick.current += 1;
}

/**
 * Bumped when a GUEST's typst-scroll request is about to be resolved on the host. tinymist
 * broadcasts the resulting `jump` to every viewer socket, and while the relay routes it to only
 * the asking guest, the host's OWN pane holds a direct socket the relay never sees. TypstPreview
 * forwards this as a `freeze` message and the page bridge swallows jump/cursor frames for the
 * window - so a guest following its caret does not drag the host's view around.
 */
export const guestJumpFreezeTick = box(0);

export function noteGuestJumpFreeze(): void {
	guestJumpFreezeTick.current += 1;
}
