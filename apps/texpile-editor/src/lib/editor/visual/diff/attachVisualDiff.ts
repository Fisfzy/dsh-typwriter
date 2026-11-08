// Adds the diff layer to the editor already on screen, so the comparison keeps that editor's node
// views, maths and tables. A second read-only ProseMirror would rebuild all of it and still look
// nothing like the editor.
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { visualDiffKey, visualDiffPlugin, type VisualDiffInput } from './visualDiffPlugin';

// Both paths below run the editor's plugins, one of which writes a rune the calling $effect reads.
// Re-applying unconditionally is therefore an infinite loop; the parsed version is one object per
// parse, so reference identity settles it.
const applied = new WeakMap<EditorView, PMNode | null>();

function hasDiffPlugin(view: EditorView): boolean {
	return !!visualDiffKey.get(view.state);
}

/** show `input`'s changes, or clear them when null. Safe to call repeatedly. */
export function attachVisualDiff(view: EditorView, input: VisualDiffInput | null): void {
	const wanted = input?.oldDoc ?? null;
	if (applied.has(view) && applied.get(view) === wanted) return;
	applied.set(view, wanted);

	const attached = hasDiffPlugin(view);

	if (input && attached) {
		// a meta keeps history, comments and node views; reconfiguring again would not
		view.dispatch(view.state.tr.setMeta(visualDiffKey, input));
		return;
	}

	if (input && !attached) {
		// The view stays editable: what is on screen is the working copy, and the version is the
		// read-only half, which lives in the plugin. Locking it could not hold anyway - `editable`
		// governs ProseMirror's own surface, while the frontmatter fields sit outside it and the
		// CodeMirror islands own their editing state, so the prose locked and the formulas did not.
		view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, visualDiffPlugin(input)] }));
		return;
	}

	if (!input && attached) {
		const attachedPlugin = visualDiffKey.get(view.state);
		view.updateState(
			view.state.reconfigure({
				plugins: view.state.plugins.filter((pl) => pl !== attachedPlugin)
			})
		);
	}
}

export function attachVisualDiffOutsideComposition(view: EditorView, input: VisualDiffInput | null): (() => void) | undefined {
	function apply() {
		attachVisualDiff(view, input);
	}
	if (!view.composing) {
		apply();
		return;
	}
	view.dom.addEventListener('compositionend', apply, { once: true });
	return () => view.dom.removeEventListener('compositionend', apply);
}
