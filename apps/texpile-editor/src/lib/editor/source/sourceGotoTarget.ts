import type { EditorState } from '@codemirror/state';

// SyncTeX gives only a line number, which is stale whenever the buffer differs from the compiled
// .tex. when the double-clicked word is known, anchor on content instead: select it on the
// reported line, else on the nearest line containing it. this is what survives line drift.
export function resolveGotoTarget(
	doc: EditorState['doc'],
	req: { line: number; selectText?: string; column?: number }
): { from: number; to: number } {
	const line = Math.min(Math.max(1, Math.floor(req.line)), doc.lines);
	// the Typst preview knows the clicked character, not just its line
	if (req.column !== undefined) {
		const at = doc.line(line);
		const pos = at.from + Math.min(Math.max(0, req.column), at.length);
		return { from: pos, to: pos };
	}
	const word = req.selectText?.trim();
	if (word && word.length >= 2) {
		const here = doc.line(line);
		const at = here.text.indexOf(word);
		if (at !== -1) return { from: here.from + at, to: here.from + at + word.length };
		// line drifted, find every line containing the word
		const hits: { line: number; from: number }[] = [];
		for (let i = 1; i <= doc.lines; i++) {
			const l = doc.line(i);
			const idx = l.text.indexOf(word);
			if (idx !== -1) hits.push({ line: i, from: l.from + idx });
		}
		if (hits.length === 1) return { from: hits[0].from, to: hits[0].from + word.length }; // unique -> certain
		if (hits.length > 1) {
			const best = hits.reduce((b, h) => (Math.abs(h.line - line) < Math.abs(b.line - line) ? h : b));
			return { from: best.from, to: best.from + word.length };
		}
	}
	const pos = doc.line(line).from;
	return { from: pos, to: pos };
}
