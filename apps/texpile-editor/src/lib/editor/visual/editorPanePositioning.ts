// popovers attached to the editor's content: kept inside the pane that scrolls the text, and hidden while what they
// belong to is scrolled out of it, instead of floating over the toolbar or the terminal
import { scrollingPane } from './scrollingPane';

function editorPane(): HTMLElement | 'clippingAncestors' {
	const editor = document.querySelector<HTMLElement>('.texpile-main-editor');
	return (editor && scrollingPane(editor)) ?? 'clippingAncestors';
}

export function inEditorPane<const T extends object>(positioning: T): T & { hideWhenDetached: true; boundary: typeof editorPane } {
	return { ...positioning, hideWhenDetached: true, boundary: editorPane };
}
