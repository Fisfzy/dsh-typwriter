/** the nearest ancestor that scrolls, the pane an element in the editor moves with */
export function scrollingPane(element: HTMLElement): HTMLElement | null {
	for (let node = element.parentElement; node; node = node.parentElement) {
		if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) return node;
	}
	return null;
}
