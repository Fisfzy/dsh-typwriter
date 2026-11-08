// Open/closed state for the in-app Zotero picker dialog, plus the insert context it will act
// on. A module singleton like the command palette's: the dialog mounts once in WorkspaceView
// and any entry point (context menu, palette) opens it by setting this.
import type { ZoteroInsertDeps } from './insertFromZotero';

class ZoteroPickerState {
	open = $state(false);
	/** where the eventual insert goes; captured when the dialog opens, cleared with it */
	deps = $state.raw<ZoteroInsertDeps | null>(null);

	show(deps: ZoteroInsertDeps): void {
		this.deps = deps;
		this.open = true;
	}

	hide(): void {
		this.open = false;
		this.deps = null;
	}
}

export const zoteroPicker = new ZoteroPickerState();
