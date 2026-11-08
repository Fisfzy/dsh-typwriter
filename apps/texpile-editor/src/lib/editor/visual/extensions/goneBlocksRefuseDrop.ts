// nothing is dropped on the block standing for blocks a suggestion took out
import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

// the block is not the document, so a drop on it lands where the blocks were taken out, among the suggestion's own
// parts. The pointer goes through it during a drag (dropPastNodeViews), so the test is by where it is
function overGoneBlocks(view: EditorView, event: DragEvent): boolean {
	for (const box of view.dom.querySelectorAll('.pm-suggest-gone')) {
		const r = box.getBoundingClientRect();
		if (event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom) return true;
	}
	return false;
}

export function refuseDropOnGoneBlocks(): Plugin {
	return new Plugin({
		view(view) {
			const doc = view.dom.ownerDocument;
			// on the page: the drop cursor is drawn outside the editor, and one already showing has to go
			function refuse(on: boolean) {
				doc.documentElement.classList.toggle('pm-drop-refused', on);
			}
			// before ProseMirror and its drop cursor hear of it: a dragover nobody takes shows the pointer as no drop,
			// and the drop never comes
			function dragover(event: DragEvent) {
				const over = view.dom.contains(event.target as Node) && overGoneBlocks(view, event);
				refuse(over);
				if (!over) return;
				event.stopPropagation();
			}
			function drop(event: DragEvent) {
				refuse(false);
				if (!view.dom.contains(event.target as Node) || !overGoneBlocks(view, event)) return;
				event.preventDefault();
				event.stopPropagation();
			}
			function done() {
				refuse(false);
			}
			doc.addEventListener('dragover', dragover, true);
			doc.addEventListener('drop', drop, true);
			doc.addEventListener('dragend', done, true);
			return {
				destroy() {
					doc.removeEventListener('dragover', dragover, true);
					doc.removeEventListener('drop', drop, true);
					doc.removeEventListener('dragend', done, true);
				}
			};
		}
	});
}
