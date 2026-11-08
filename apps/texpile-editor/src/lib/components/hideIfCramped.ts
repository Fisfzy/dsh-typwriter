// hides the node (visibility, so its width still measures) while it is wider than its parent, for
// a label that should vanish rather than run under the controls beside it
export function hideIfCramped(node: HTMLElement) {
	const parent = node.parentElement;
	if (!parent) return;
	function fit() {
		node.classList.toggle('invisible', node.offsetWidth > parent!.clientWidth);
	}
	const ro = new ResizeObserver(fit);
	ro.observe(parent);
	ro.observe(node);
	fit();
	return { destroy: () => ro.disconnect() };
}
