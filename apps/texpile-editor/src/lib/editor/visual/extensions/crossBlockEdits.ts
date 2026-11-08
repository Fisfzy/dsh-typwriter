// A deletion or typing across two blocks ProseMirror cannot join (a list item into a typst term's title)
// throws, and the key does nothing. The selection is taken out without joining its ends instead: each
// keeps its own block, and everything between them goes.
import { Plugin, TextSelection, type Transaction } from 'prosemirror-state';

/** the range taken out with its ends left in their own top-level blocks */
export function deleteApart(tr: Transaction, from: number, to: number): Transaction {
	const $from = tr.doc.resolve(from);
	const $to = tr.doc.resolve(to);
	if ($from.depth < 1 || $to.depth < 1 || $from.before(1) === $to.before(1)) return tr.delete(from, to);
	tr.delete($to.start(1), to);
	tr.delete($from.after(1), $to.before(1));
	return tr.delete(from, $from.end(1));
}

function throws(build: () => unknown): boolean {
	try {
		build();
		return false;
	} catch {
		return true;
	}
}

export const crossBlockEdits = new Plugin({
	props: {
		handleKeyDown(view, event) {
			if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
			const { state } = view;
			const sel = state.selection;
			if (!(sel instanceof TextSelection) || sel.empty || !throws(() => state.tr.deleteSelection())) return false;
			view.dispatch(deleteApart(state.tr, sel.from, sel.to).scrollIntoView());
			return true;
		},
		handleTextInput(view, from, to, text) {
			if (from === to || !throws(() => view.state.tr.insertText(text, from, to))) return false;
			view.dispatch(deleteApart(view.state.tr, from, to).insertText(text, from).scrollIntoView());
			return true;
		},
		handlePaste(view, _event, slice) {
			const sel = view.state.selection;
			if (!(sel instanceof TextSelection) || sel.empty || !throws(() => view.state.tr.replaceSelection(slice))) return false;
			view.dispatch(deleteApart(view.state.tr, sel.from, sel.to).replaceRange(sel.from, sel.from, slice).scrollIntoView());
			return true;
		},
		handleDOMEvents: {
			// ProseMirror's own cut copies and then throws taking the selection out: the copy is made as it makes it
			cut(view, event) {
				const sel = view.state.selection;
				const clipboard = event.clipboardData;
				if (!clipboard || !(sel instanceof TextSelection) || sel.empty || !throws(() => view.state.tr.deleteSelection())) return false;
				const { dom, text } = view.serializeForClipboard(sel.content());
				event.preventDefault();
				clipboard.clearData();
				clipboard.setData('text/html', dom.innerHTML);
				clipboard.setData('text/plain', text);
				view.dispatch(deleteApart(view.state.tr, sel.from, sel.to).scrollIntoView().setMeta('uiEvent', 'cut'));
				return true;
			}
		}
	}
});
