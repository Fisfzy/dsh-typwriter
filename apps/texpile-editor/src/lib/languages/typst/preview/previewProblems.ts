// the Problems panel's view of tinymist's live LSP diagnostics, in the parsed-log shape the
// panel already renders; per-file lists accumulate in the map, this flattens the project view
import { workspaceRoot } from '$lib/workspace/workspaceStore';
import type { LogEntry } from '$lib/compileLog/compileLog';
import type { TypstDiagnostic } from '../intellisense/lspClient';

export function typstProblemsLog(liveDiags: ReadonlyMap<string, TypstDiagnostic[]>) {
	const root = (workspaceRoot.current ?? '').replace(/\\/g, '/');
	const entries: LogEntry[] = [];
	for (const [path, diags] of liveDiags) {
		const norm = path.replace(/\\/g, '/');
		// root-relative, the shape resolveLogPath() expects for click-to-jump
		const rel = root && norm.toLowerCase().startsWith(root.toLowerCase() + '/') ? norm.slice(root.length + 1) : norm;
		for (const d of diags) {
			if ((d.severity ?? 1) >= 3) continue; // info/hint stay in the editor gutter only
			entries.push({
				level: (d.severity ?? 1) <= 1 ? 'error' : 'warning',
				message: d.message.split('\n')[0],
				context: d.message,
				file: rel,
				line: d.range.start.line + 1,
				column: d.range.start.character + 1,
				raw: d.message
			});
		}
	}
	return {
		entries,
		errors: entries.filter((e) => e.level === 'error'),
		warnings: entries.filter((e) => e.level === 'warning'),
		badboxes: [],
		files: [],
		status: { fatal: false, emergencyStop: false, noPages: false },
		logPath: '',
		updatedAt: Date.now()
	};
}
