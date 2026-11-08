import { toggleMark } from 'prosemirror-commands';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { MarkType } from 'prosemirror-model';

export function markIsActive(state: EditorState, type: MarkType): boolean {
	const { from, to, empty } = state.selection;
	if (empty) return !!type.isInSet(state.storedMarks || state.selection.$head.marks());
	return state.doc.rangeHasMark(from, to, type);
}

/** color attr of the first `type` mark in the selection, else null. rangeHasMark only returns a boolean, so scan nodes for the mark instance (reading .attrs off the boolean froze the whole UI). */
export function activeMarkColor(state: EditorState, type: MarkType): string | null {
	const { from, to, empty } = state.selection;
	if (empty) {
		const mark = type.isInSet(state.storedMarks || state.selection.$head.marks());
		return mark ? mark.attrs.color : null;
	}
	let color: string | null = null;
	state.doc.nodesBetween(from, to, (node) => {
		if (color !== null) return false;
		const mark = type.isInSet(node.marks);
		if (mark) color = mark.attrs.color;
	});
	return color;
}

/**
 * THE link action, shared by the toolbars and the Insert menu of all three dialects (each passes
 * its own schema's mark).
 *
 * Every path that CREATES a link ends with the caret INSIDE it: the link tooltip opens on a caret
 * in a link, so the URL is immediately editable in place - no modal prompt, and the menu and the
 * toolbar behave identically. (The link mark is inclusive:false, so the exact end boundary sits
 * OUTSIDE the mark; `to - 1` is the last position that counts as inside.) A selection that is
 * already fully linked toggles the link off instead.
 */
export function toggleLinkCommand(type: MarkType): Command {
	return (state, dispatch) => {
		const { from, to, empty } = state.selection;
		// bare caret outside a link: insert the placeholder itself as linked text (toggleMark would
		// only arm a stored mark - the button looked like it did nothing)
		if (empty && !markIsActive(state, type)) {
			const text = state.schema.text('https://', [type.create({ href: 'https://' })]);
			if (dispatch) {
				const tr = state.tr.replaceSelectionWith(text, false);
				tr.setSelection(TextSelection.create(tr.doc, from + text.nodeSize - 1)).scrollIntoView();
				dispatch(tr);
			}
			return true;
		}
		// caret inside an existing link: the tooltip is already up; keep plain toggle semantics
		if (empty) return toggleMark(type, { href: 'https://', title: null })(state, dispatch);
		if (state.doc.rangeHasMark(from, to, type)) {
			dispatch?.(state.tr.removeMark(from, to, type).scrollIntoView());
			return true;
		}
		if (dispatch) {
			const tr = state.tr.addMark(from, to, type.create({ href: 'https://', title: null }));
			tr.setSelection(TextSelection.create(tr.doc, to - 1)).scrollIntoView();
			dispatch(tr);
		}
		return true;
	};
}
