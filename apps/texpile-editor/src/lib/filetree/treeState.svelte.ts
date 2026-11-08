// Which folders are open and which rows are selected, plus the click grammar that drives
// both (plain / ctrl / shift, VSCode-style).
import { samePath, type TreeEntry } from '$lib/workspace/fileSystem';
import { isInside, sepOf } from './treePaths';

type StateHooks = {
	tree: () => TreeEntry[];
	onOpen: (entry: TreeEntry) => void;
};

export class FileTreeState {
	expanded = $state<Record<string, boolean>>({});
	selected = $state<string[]>([]);
	anchorPath: string | null = null; // shift-range pivot; the last plain/ctrl-clicked row

	constructor(private hooks: StateHooks) {}

	/** the tree in on-screen order, honouring which folders are expanded (shift-range domain). */
	private flattenVisible(entries: TreeEntry[] = this.hooks.tree(), out: TreeEntry[] = []): TreeEntry[] {
		for (const e of entries) {
			out.push(e);
			if (e.type === 'dir' && this.expanded[e.path]) this.flattenVisible(e.children ?? [], out);
		}
		return out;
	}

	findEntry(path: string, entries: TreeEntry[] = this.hooks.tree()): TreeEntry | null {
		for (const e of entries) {
			if (e.path === path) return e;
			if (e.type === 'dir') {
				const hit = this.findEntry(path, e.children ?? []);
				if (hit) return hit;
			}
		}
		return null;
	}

	/** selected entries with nested ones pruned; a child handled after its parent moved is a dead path */
	selectedEntries(): TreeEntry[] {
		const paths = this.selected.filter((p) => !this.selected.some((other) => other !== p && isInside(p, other)));
		return paths.map((p) => this.findEntry(p)).filter((e): e is TreeEntry => !!e);
	}

	/** open every folder above `path`; false when the tree holds no such entry yet */
	reveal(path: string): boolean {
		const opened: string[] = [];
		function under(dir: string): boolean {
			const sep = path[dir.length];
			return (sep === '/' || sep === sepOf(path)) && samePath(path.slice(0, dir.length), dir);
		}
		function walk(entries: TreeEntry[]): boolean {
			for (const e of entries) {
				if (samePath(e.path, path)) return true;
				if (e.type === 'dir' && under(e.path) && walk(e.children ?? [])) {
					opened.push(e.path);
					return true;
				}
			}
			return false;
		}
		if (!walk(this.hooks.tree())) return false;
		for (const dir of opened) this.expanded[dir] = true;
		return true;
	}

	/** collapse the selection onto this row unless it is already part of it */
	ensureSelected(entry: TreeEntry): void {
		if (!this.selected.includes(entry.path)) {
			this.selected = [entry.path];
			this.anchorPath = entry.path;
		}
	}

	handleRowClick(e: MouseEvent, entry: TreeEntry): void {
		if (e.ctrlKey || e.metaKey) {
			this.selected = this.selected.includes(entry.path) ? this.selected.filter((p) => p !== entry.path) : [...this.selected, entry.path];
			this.anchorPath = entry.path;
			return;
		}
		if (e.shiftKey && this.anchorPath) {
			const order = this.flattenVisible().map((x) => x.path);
			const a = order.indexOf(this.anchorPath);
			const b = order.indexOf(entry.path);
			if (a >= 0 && b >= 0) {
				this.selected = order.slice(Math.min(a, b), Math.max(a, b) + 1);
				return;
			}
		}
		this.selected = [entry.path];
		this.anchorPath = entry.path;
		if (entry.type === 'dir') this.expanded[entry.path] = !this.expanded[entry.path];
		else this.hooks.onOpen(entry);
	}
}
