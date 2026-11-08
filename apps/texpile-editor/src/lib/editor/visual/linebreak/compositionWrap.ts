// an input method's text grows at the caret and a held paragraph cannot re-wrap until it commits, so the caret's
// paragraph wraps on its own while a composition is open (app.css)
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

const compositionWrapKey = new PluginKey<DecorationSet>('texpile-composition-wrap');

// the paragraph is marked ahead of time and the switch goes on the root, which ProseMirror never reads back: a
// decoration or an attribute changed on the paragraph during the composition would be read as an edit and end it
function caretParagraph(state: EditorState): DecorationSet {
	const { $head } = state.selection;
	if (!$head.parent.isTextblock) return DecorationSet.empty;
	const from = $head.before();
	return DecorationSet.create(state.doc, [Decoration.node(from, from + $head.parent.nodeSize, { class: 'pm-line-caret' })]);
}

export function compositionWrapPlugin(): Plugin<DecorationSet> {
	return new Plugin<DecorationSet>({
		key: compositionWrapKey,
		state: {
			init: (_, state) => caretParagraph(state),
			apply(tr, marked, before, state) {
				if (!tr.docChanged && !tr.selectionSet) return marked;
				const was = before.selection.$head;
				const now = state.selection.$head;
				if (tr.docChanged || was.parent !== now.parent) return caretParagraph(state);
				return marked;
			}
		},
		props: { decorations: (state) => compositionWrapKey.getState(state) },
		view(view) {
			function started(): void {
				view.dom.classList.add('pm-composing');
			}
			function ended(): void {
				view.dom.classList.remove('pm-composing');
			}
			view.dom.addEventListener('compositionstart', started);
			view.dom.addEventListener('compositionend', ended);
			return {
				destroy() {
					view.dom.removeEventListener('compositionstart', started);
					view.dom.removeEventListener('compositionend', ended);
				}
			};
		}
	});
}
