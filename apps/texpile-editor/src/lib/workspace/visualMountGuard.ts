// A renderer that dies building the visual editor (out of memory on a huge file) would be
// restored straight back into the same build. The path is noted before the build and forgotten
// once that file's editor is on screen, so a note still there at the next open means the build
// never finished, and that file opens in Source instead.
import { samePath } from './fileSystem';

const KEY = 'texpile:visualMounting';
const MAX_NOTES = 8;

function stored(): string[] {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown;
		return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
	} catch {
		return [];
	}
}

function store(paths: string[]): void {
	try {
		if (paths.length === 0) localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, JSON.stringify(paths.slice(-MAX_NOTES)));
	} catch {
		/* storage off: the guard is a convenience */
	}
}

export function noteVisualMount(path: string): void {
	const rest = stored().filter((p) => !samePath(p, path));
	store([...rest, path]);
}

/** only the noted file's own build clears its note: a restart may show another file first */
export function visualMounted(path: string): void {
	const all = stored();
	const rest = all.filter((p) => !samePath(p, path));
	if (rest.length !== all.length) store(rest);
}

/** true once, for a file whose build never finished last time */
export function visualMountDied(path: string): boolean {
	const all = stored();
	const rest = all.filter((p) => !samePath(p, path));
	if (rest.length === all.length) return false;
	store(rest);
	return true;
}
