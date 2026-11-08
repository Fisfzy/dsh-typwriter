// a position moved out of the blocks it starts or ends, up to a level
import type { Node as PMNode } from 'prosemirror-model';

/** out through every block `pos` is the start or the end of, while it is deeper than `depth` */
export function liftPosition(doc: PMNode, pos: number, depth: number): number {
	let at = pos;
	for (;;) {
		const $at = doc.resolve(at);
		if ($at.depth <= depth) return at;
		if ($at.parentOffset === 0) at = $at.before();
		else if ($at.parentOffset === $at.parent.content.size) at = $at.after();
		else return at;
	}
}
