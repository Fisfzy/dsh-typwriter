// a chip, formula or code block claims every event, so a block dragged onto one was dropped nowhere (and a code
// block's CodeMirror pasted a copy of the text into itself). While the editor's own drag runs they let the pointer
// through (app.css) and the drop lands beside them
import { Plugin } from 'prosemirror-state';

export function dropPastNodeViewsPlugin(): Plugin {
	return new Plugin({
		view(view) {
			const doc = view.dom.ownerDocument;
			// the block handle starts its drag outside the editor, so the flag follows view.dragging, not a dragstart
			function follow() {
				return view.dom.classList.toggle('pm-own-drag', view.dragging != null);
			}
			function clear() {
				return view.dom.classList.remove('pm-own-drag');
			}
			// after the drop has been placed: placing it reads the pointer's target again
			function clearAfterDrop() {
				return setTimeout(clear);
			}
			doc.addEventListener('dragover', follow, true);
			doc.addEventListener('drop', clearAfterDrop, true);
			doc.addEventListener('dragend', clear, true);
			return {
				destroy() {
					doc.removeEventListener('dragover', follow, true);
					doc.removeEventListener('drop', clearAfterDrop, true);
					doc.removeEventListener('dragend', clear, true);
				}
			};
		}
	});
}
