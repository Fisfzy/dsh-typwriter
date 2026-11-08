// Chrome's double click takes the space after the word with it, so typing a replacement swallows
// that space and two words run together ("tightfor"). CodeMirror stops at the word, and so does
// every word processor, so the visual editor should too.
import { Plugin, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

function trim(view: EditorView): void {
	const { state } = view;
	const sel = state.selection;
	if (sel.empty || !(sel instanceof TextSelection) || !sel.$from.sameParent(sel.$to)) return;
	const text = state.doc.textBetween(sel.from, sel.to);
	const kept = text.replace(/\s+$/, '');
	if (!kept || kept === text) return;
	view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, sel.from, sel.to - (text.length - kept.length))));
}

export function wordSelectionTrim(): Plugin {
	return new Plugin({
		props: {
			handleDOMEvents: {
				dblclick(view) {
					// the browser sets the selection after this handler returns, so the trim waits a tick
					setTimeout(() => trim(view), 0);
					return false;
				}
			}
		}
	});
}
