// Reconciles the `value` prop with the CodeMirror document in both directions without echo
// loops: pushExternal folds an outside change in, and the flags let the update listener tell
// a user edit from our own push.
import { EditorView } from '@codemirror/view';
import { Transaction } from '@codemirror/state';
import { docText } from '$lib/editor/source/docText';
import { minimalEdit } from '$lib/editor/source/minimalEdit';
import { logDocReplace } from '$lib/debug/caretDoctor';

export class SourceValueSync {
	// true while pushing an external value into CM, so the update listener doesn't echo it back as a user edit
	syncing = false;
	// last text handed to onInput: pushExternal compares against this first, so our own
	// round-tripped edits skip the second full doc.toString() per keystroke
	lastEmitted: string | null = null;

	/** Reconcile an external value change into the document without echoing. addToHistory(false)
	 *  keeps it out of CM's undo stack, otherwise the next Ctrl+Z would "undo the undo" and bounce
	 *  back.
	 *
	 *  minimalEdit, not a whole-buffer swap: a change spanning every position leaves CodeMirror
	 *  nothing to map the caret onto, so any external push while typing threw away your place */
	pushExternal(view: EditorView, v: string): void {
		if (v !== this.lastEmitted && v !== docText(view.state.doc)) {
			const old = docText(view.state.doc);
			const edit = minimalEdit(old, v);
			logDocReplace({
				oldLen: old.length,
				newLen: v.length,
				from: edit.from,
				to: edit.to,
				insertLen: edit.insert.length,
				caret: view.state.selection.main.head
			});
			this.syncing = true;
			view.dispatch({ changes: edit, annotations: Transaction.addToHistory.of(false) });
			this.syncing = false;
		}
		// mirror CM's doc after every reconciliation, whichever branch ran, so lastEmitted can
		// never go stale and wrongly short-circuit a later external push
		this.lastEmitted = v;
	}
}
