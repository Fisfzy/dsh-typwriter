// a request from outside the tree (the tab strip's menu) to open the folders above a file and select it
import { box } from '$lib/runes/box.svelte';

export const treeRevealRequest = box<{ path: string; seq: number } | null>(null);
let seq = 0;

export function revealInTree(path: string): void {
	treeRevealRequest.current = { path, seq: ++seq };
}
