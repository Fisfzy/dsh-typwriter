// back to the text after a comment is posted from the keyboard, the caret after the passage commented
// on rather than the passage still selected: the next keystroke writes on instead of over it
import { TextSelection } from 'prosemirror-state';
import type { EditorView as PMView } from 'prosemirror-view';
import type { EditorView as CMView } from '@codemirror/view';

export function returnToPmText(view: PMView): void {
	const { state } = view;
	view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(state.selection.to), -1)));
	view.focus();
}

export function returnToCmText(view: CMView): void {
	view.dispatch({ selection: { anchor: view.state.selection.main.to } });
	view.focus();
}
