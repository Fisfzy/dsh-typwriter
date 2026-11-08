// focus on mount and select the base name (keep the extension, like VSCode).
export function focusSelect(node: HTMLInputElement): void {
	function grab() {
		node.focus();
		const dot = node.value.lastIndexOf('.');
		if (dot > 0) node.setSelectionRange(0, dot);
		else node.select();
	}
	grab();
	// a closing Skeleton menu (Zag) refocuses its trigger a microtask later and steals the field.
	// grab it back ONCE; a re-assert loop was tried and made the field impossible to leave
	requestAnimationFrame(() => {
		if (node.isConnected && document.activeElement !== node) grab();
	});
}
