import type { Node as PMNode } from 'prosemirror-model';

// past this, chromium's per-keystroke style, layout and hit-testing over the whole editable
// is what the user feels (a 251 KB single file: 72k DOM nodes, 120 ms a key); the root then
// carries TexpileEditor-large and its off-screen blocks skip rendering. nodeSize is O(1) and
// roughly the character count, so the threshold is about 150 KB of body text
export const LARGE_DOC_NODE_SIZE = 150_000;

export function isLargeDocument(doc: PMNode): boolean {
	return doc.nodeSize > LARGE_DOC_NODE_SIZE;
}
