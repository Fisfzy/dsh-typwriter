import { box } from '$lib/runes/box.svelte';
import type { LatexLogParseResult } from '$lib/compileLog/compileLog';

/** parse result of the latest compile's .log; null before the first compile. set by WorkspaceView's log watcher. */
export type CompileLogState = {
	logPath: string;
	/** epoch ms of the log state this was parsed from. */
	updatedAt: number;
} & LatexLogParseResult;

export const compileLog = box<CompileLogState | null>(null);

/** collapse "." and ".." segments; ".." never climbs past the first segment (a drive or the root) */
function collapse(path: string): string {
	const out: string[] = [];
	for (const seg of path.split('/')) {
		if (seg === '.' || (seg === '' && out.length > 0)) continue;
		if (seg === '..' && out.length > 1) out.pop();
		else if (seg !== '..') out.push(seg);
	}
	return out.join('/');
}

/**
 * A path the engine printed, rewritten to be relative to the workspace root.
 *
 * The engine prints paths relative to the directory it RAN in, and under latexmk -cd that is the
 * main file's folder, not the root: a broken \input in latex/parts/body.tex comes back as
 * "./parts/body.tex". Everything downstream - the Problems panel, the guest bridge, the MCP
 * surface - resolves against the root, so this is where the two are reconciled, once, at the point
 * where the command that produced the log is still known.
 *
 * Paths outside the workspace (TeX installation files) are returned untouched: they are shown but
 * not clickable, and rewriting them would only lose information.
 */
export function rebaseLogFile(file: string, base: string, root: string): string {
	const f = file.replace(/\\/g, '/').trim();
	if (!f) return file;
	const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '');
	const abs = /^(?:[A-Za-z]:\/|\/)/.test(f) ? collapse(f) : collapse(`${base.replace(/\\/g, '/').replace(/\/+$/, '')}/${f}`);
	return abs.toLowerCase().startsWith(rootNorm.toLowerCase() + '/') ? abs.slice(rootNorm.length + 1) : file;
}

/** resolves a log-printed path (usually "./sub/x.tex", relative to the workspace root) to an
 *  absolute path. null for files outside the workspace (TeX installation files), shown but not clickable. */
export function resolveLogPath(root: string, file: string | undefined): string | null {
	if (!root || !file) return null;
	let f = file.replace(/\\/g, '/').trim();
	if (/^(?:[A-Za-z]:\/|\/)/.test(f)) {
		// absolute: only inside the workspace (case-insensitive compare, Windows)
		const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '');
		return f.toLowerCase().startsWith(rootNorm.toLowerCase() + '/') ? f : null;
	}
	f = f.replace(/^\.\//, '');
	if (f.startsWith('../')) return null; // outside the folder
	const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '');
	return `${rootNorm}/${f}`;
}
