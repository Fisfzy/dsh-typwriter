// Holds every scrollable ancestor still across a block-exit landing. A gap-cursor landing is
// by construction adjacent to the field being left - already on screen - so no scroll is ever
// wanted; but the sequence crosses a shadow-DOM blur, a refocus, and prosemirror-view's
// temporarily-editable caret anchoring for the invisible gap selection, and the browser nudges
// the viewport a few pixels through it. Restores synchronously and once more on the next tick,
// which covers the async tail without lingering long enough to fight a real user scroll.
export function withPinnedScroll(around: Element, fn: () => void): void {
	const saved: [Element, number, number][] = [];
	for (let el: Element | null = around; el; el = el.parentElement) saved.push([el, el.scrollTop, el.scrollLeft]);
	const root = document.scrollingElement;
	if (root && !saved.some(([el]) => el === root)) saved.push([root, root.scrollTop, root.scrollLeft]);
	function restore(): void {
		for (const [el, top, left] of saved) {
			if (el.scrollTop !== top) el.scrollTop = top;
			if (el.scrollLeft !== left) el.scrollLeft = left;
		}
	}
	fn();
	restore();
	setTimeout(restore, 0);
}
