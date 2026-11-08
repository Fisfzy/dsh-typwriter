// the copy an undoable delete recovers from; sited under the app's own data dir by the caller
import { readdir, mkdir, stat, cp } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Bytes in a file or a whole directory tree, giving up as soon as `limit` is passed.
 *
 * The early exit is the point: this runs before every delete, and walking a node_modules to find
 * out it is 400 MB would cost more than the copy it is meant to avoid. Anything over the limit only
 * needs to be known as "too big", not measured.
 */
async function sizeOf(p: string, limit: number): Promise<number> {
	let total = 0;
	async function walk(target: string): Promise<boolean> {
		let st;
		try {
			st = await stat(target);
		} catch {
			return true; // vanished mid-walk; nothing to copy for it either
		}
		if (!st.isDirectory()) {
			total += st.size;
			return total <= limit;
		}
		let entries;
		try {
			entries = await readdir(target, { withFileTypes: true });
		} catch {
			return true;
		}
		for (const e of entries) if (!(await walk(join(target, e.name)))) return false;
		return true;
	}
	await walk(p);
	return total;
}

/**
 * Copy an entry somewhere the file tree's undo can fetch it back from, BEFORE it is deleted.
 *
 * Returns null when the entry is too large to be worth copying, and null means "this delete will
 * not be undoable" - the caller records no history rather than offering an undo that would take a
 * minute and a second copy of a large folder to honour. The delete itself still happens, and still
 * goes to the OS recycle bin, so the file is not gone either way.
 *
 * The copy lands OUTSIDE the workspace (the caller sites it under the app's own data directory), so
 * nothing appears in the user's project and there is nothing for `git add -A` to sweep up. The cost
 * of being off-volume is that this is a real copy rather than a rename, which is exactly why the
 * size limit exists.
 */
export async function backupForUndo(path: string, backupDir: string, maxBytes: number): Promise<string | null> {
	if (await sizeOf(path, maxBytes).then((n) => n > maxBytes)) return null;
	// its own slot per entry: two files called figure.png, or the same path deleted twice, would
	// otherwise collide - and the name inside the slot is what the restore path is rebuilt from
	const slot = join(backupDir, `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`);
	await mkdir(slot, { recursive: true });
	const dest = join(slot, basename(path));
	try {
		await cp(path, dest, { recursive: true });
	} catch {
		return null; // unreadable, or it moved under us: no backup, so no undo offered
	}
	return dest;
}
