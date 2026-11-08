export type VisibleBox = { top: number; bottom: number; left: number; right: number };

/** the part of the window `el` can show through: the window, cut down by every ancestor that clips */
export function visibleBox(el: HTMLElement): VisibleBox {
	const box = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
	for (let cur = el.parentElement; cur; cur = cur.parentElement) {
		const cs = getComputedStyle(cur);
		if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
		const r = cur.getBoundingClientRect();
		box.top = Math.max(box.top, r.top);
		box.left = Math.max(box.left, r.left);
		box.bottom = Math.min(box.bottom, r.bottom);
		box.right = Math.min(box.right, r.right);
	}
	return box;
}
