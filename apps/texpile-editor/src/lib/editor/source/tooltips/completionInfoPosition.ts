import { Direction, type EditorView as CMView, type Rect } from '@codemirror/view';

const WIDTH = 400;
const MARGIN = 30;
const GAP = 4;

export function positionCompletionInfo(view: CMView, list: Rect, option: Rect, note: Rect, space: Rect) {
	const rtl = view.textDirection === Direction.RTL;
	const spaceLeft = list.left - space.left;
	const spaceRight = space.right - list.right;
	const noteWidth = note.right - note.left;
	const noteHeight = note.bottom - note.top;
	let left = rtl;
	if (left && spaceLeft < Math.min(noteWidth, spaceRight)) left = false;
	else if (!left && spaceRight < Math.min(noteWidth, spaceLeft)) left = true;

	let side: 'top' | 'bottom' = 'top';
	let offset: number;
	let maxWidth: number;
	const narrow = noteWidth > (left ? spaceLeft : spaceRight);
	if (!narrow) {
		offset = Math.max(space.top, Math.min(option.top, space.bottom - noteHeight)) - list.top;
		maxWidth = Math.min(WIDTH, left ? spaceLeft : spaceRight);
	} else {
		maxWidth = Math.min(WIDTH, (rtl ? list.right : space.right - list.left) - MARGIN);
		const caret = view.coordsAtPos(view.state.selection.main.head);
		const listBelow = !caret || list.top >= caret.bottom - 1;
		const lineTop = caret?.top ?? list.top;
		const lineBottom = caret?.bottom ?? list.bottom;
		if (listBelow && lineTop - GAP - noteHeight >= space.top) {
			side = 'bottom';
			offset = list.bottom - (lineTop - GAP);
		} else if (!listBelow && lineBottom + GAP + noteHeight <= space.bottom) {
			offset = lineBottom + GAP - list.top;
		} else if (listBelow) {
			offset = list.bottom - list.top + GAP;
		} else {
			side = 'bottom';
			offset = GAP + list.bottom - list.top;
		}
	}
	const { scaleX, scaleY } = view;
	return {
		style: `${side}: ${offset / scaleY}px; max-width: ${maxWidth / scaleX}px`,
		class: 'cm-completionInfo-' + (narrow ? (rtl ? 'left-narrow' : 'right-narrow') : left ? 'left' : 'right')
	};
}
