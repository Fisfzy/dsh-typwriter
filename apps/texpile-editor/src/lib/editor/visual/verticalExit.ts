import type { EditorView } from 'prosemirror-view';

/** the document position one line above (dir -1) or below (dir 1) `pos`, at the same column; null
 * when the document has no line there */
export function positionOnAdjacentLine(view: EditorView, pos: number, dir: -1 | 1): number | null {
	const here = view.coordsAtPos(pos);
	const lineHeight = Math.max(here.bottom - here.top, 8);
	const found = view.posAtCoords({ left: here.left, top: dir < 0 ? here.top - lineHeight / 2 : here.bottom + lineHeight / 2 });
	if (!found) return null;
	const there = view.coordsAtPos(found.pos);
	// still overlapping this line vertically means the probe hit nothing above or below
	if (dir < 0 ? there.bottom > here.top : there.top < here.bottom) return null;
	return found.pos;
}
