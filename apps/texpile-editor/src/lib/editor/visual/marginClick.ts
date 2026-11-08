// a click in the empty margin beside the text
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { oldWordsClick } from './extensions/pmOldWordsCaret';

/**
 * Puts the caret on the line level with the click, at its nearer end. Left to the browser, a click right of a
 * bullet item went to the item's start. Only a click on the background itself: the gutters hold the block handles
 */
export function caretFromMargin(event: MouseEvent, view: EditorView | null): void {
	if (!view || view.isDestroyed || event.button !== 0 || event.detail > 1 || event.target !== event.currentTarget) return;
	const box = view.dom.getBoundingClientRect();
	if (event.clientY < box.top || event.clientY > box.bottom) return;
	const left = Math.min(Math.max(event.clientX, box.left + 1), box.right - 1);
	const found = view.posAtCoords({ left, top: event.clientY });
	if (!found) return;
	event.preventDefault();
	const sel = TextSelection.near(view.state.doc.resolve(found.pos));
	view.dispatch(view.state.tr.setSelection(sel));
	// beside struck words, on the side the click was, as a click on the line is
	oldWordsClick(view, sel.head, event);
	view.focus();
}
