// the text blocks the line breaker takes: paragraphs and headings. Code is verbatim, and captions, notes and term
// titles belong to their float, table or list
import type { Node as PMNode } from 'prosemirror-model';

const HELD = new Set(['paragraph', 'heading']);

export function isHeldBlock(node: PMNode): boolean {
	return HELD.has(node.type.name);
}
