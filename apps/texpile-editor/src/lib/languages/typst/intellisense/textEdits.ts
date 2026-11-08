// Apply LSP TextEdits to a document string. tinymist's formatter (typstyle) answers
// textDocument/formatting with MINIMIZED ranged edits - measured against 0.15.2, a small file came
// back as one edit spanning only the changed region - so a whole-document replace cannot be
// assumed and range arithmetic has to be right.
//
// LSP positions are line + character in UTF-16 code units, which is exactly what JS string
// indexing speaks, so offsets fall out of line starts plus the character count directly.

export type LspTextEdit = {
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	newText: string;
};

/** offset of every line start; the terminator lives with the line it ends */
function lineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
	return starts;
}

function offsetOf(starts: number[], text: string, pos: { line: number; character: number }): number {
	// a line past the end means "end of document" (LSP allows it as an open end)
	if (pos.line >= starts.length) return text.length;
	const start = starts[pos.line];
	const lineEnd = pos.line + 1 < starts.length ? starts[pos.line + 1] - 1 : text.length;
	// clamp to the line: a character past its end must not spill onto the next line
	return Math.min(start + Math.max(0, pos.character), lineEnd);
}

/** The LSP position of a document offset - the inverse of offsetOf, for requests that carry one
 *  (rename asks "what is at this position"). */
export function positionAt(text: string, offset: number): { line: number; character: number } {
	const starts = lineStarts(text);
	const at = Math.max(0, Math.min(offset, text.length));
	// last line start at or before the offset
	let lo = 0;
	let hi = starts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (starts[mid] <= at) lo = mid;
		else hi = mid - 1;
	}
	return { line: lo, character: at - starts[lo] };
}

/** Resolve an edit's range against `text`, as a plain offset pair. */
export function editRange(text: string, edit: LspTextEdit): { from: number; to: number } {
	const starts = lineStarts(text);
	const from = offsetOf(starts, text, edit.range.start);
	return { from, to: Math.max(from, offsetOf(starts, text, edit.range.end)) };
}

/**
 * The document with every edit applied. Edits are applied back-to-front so earlier ranges stay
 * valid, per LSP's rule that a single response's edits never overlap.
 */
export function applyTextEdits(text: string, edits: LspTextEdit[]): string {
	const starts = lineStarts(text);
	const resolved = edits
		.map((e) => ({ from: offsetOf(starts, text, e.range.start), to: offsetOf(starts, text, e.range.end), insert: e.newText }))
		.sort((a, b) => b.from - a.from || b.to - a.to);
	let out = text;
	for (const e of resolved) out = out.slice(0, e.from) + e.insert + out.slice(Math.max(e.from, e.to));
	return out;
}
