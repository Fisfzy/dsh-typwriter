// Files arriving from outside the workspace: dropped from the OS file manager or pasted
// from the clipboard.

export type ImportItem = {
	/** destination path relative to the drop/paste target dir (forward slashes). */
	relPath: string;
	file: globalThis.File;
};

// walks the webkitGetAsEntry tree so a dropped FOLDER imports its contents, and reads bytes
// rather than OS paths, which is also what makes it work for clipboard files
export async function collectDropItems(e: DragEvent): Promise<ImportItem[]> {
	const out: ImportItem[] = [];
	const items = [...(e.dataTransfer?.items ?? [])];
	const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
	if (!entries.length) {
		for (const f of e.dataTransfer?.files ?? []) out.push({ relPath: f.name, file: f });
		return out;
	}
	function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
		return new Promise((resolve) => {
			const reader = dir.createReader();
			const acc: FileSystemEntry[] = [];
			function step() {
				return reader.readEntries(
					(batch) => {
						if (!batch.length) return resolve(acc);
						acc.push(...batch);
						step(); // readEntries returns at most ~100 per call
					},
					() => resolve(acc)
				);
			}
			step();
		});
	}
	async function walk(entry: FileSystemEntry, prefix: string): Promise<void> {
		if (entry.isFile) {
			const f = await new Promise<globalThis.File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)).catch(
				() => null
			);
			if (f) out.push({ relPath: prefix + entry.name, file: f });
		} else if (entry.isDirectory) {
			for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child, prefix + entry.name + '/');
		}
	}
	for (const entry of entries) await walk(entry, '');
	return out;
}

// a pasted screenshot arrives as a nameless "image.png"; give it a recognizable name
export function namePastedFiles(files: globalThis.File[]): ImportItem[] {
	return files.map((f, i) => {
		let name = f.name || 'pasted-image.png';
		if (/^image\.(png|jpe?g|gif|webp)$/i.test(name)) name = name.replace(/^image/i, 'pasted-image');
		if (files.length > 1 && files.every((x) => x.name === files[0].name)) name = name.replace(/(\.[^.]+)$/, `-${i + 1}$1`);
		return { relPath: name, file: f };
	});
}
