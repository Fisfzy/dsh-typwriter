// Where a comment is attached, in a form that survives the file being edited by something that
// is not this app.
//
// Overleaf never needs this: it owns the document store, so every edit passes through its ranges
// tracker and an offset can never go stale. Our files sit on disk. Someone edits main.tex in vim,
// or pulls a branch, and every offset after the change is wrong - silently, which is the bad kind.
// So an offset is only ever a HINT here, and the quote plus its surrounding context is what the
// comment is really pinned to. This is the W3C Web Annotation TextQuoteSelector model, the same
// thing Hypothesis anchors highlights with.
//
// Inside a live editing session none of this runs: CodeMirror maps the decorations through each
// transaction, which is exact and free. Re-anchoring happens on load, and after an external
// change to the file.

export { buildAnchor, resolveAnchor, type CommentAnchor, type ResolvedAnchor } from './anchorSearch';

/** which markup family a file is written in; derived from its name, never stored */
export type AnchorDialect = 'tex' | 'md' | 'typ';

/** anything the visual editor does not render reads as LaTeX */
export function dialectOfPath(path: string): AnchorDialect {
	const p = path.toLowerCase();
	if (p.endsWith('.md') || p.endsWith('.markdown')) return 'md';
	if (p.endsWith('.typ')) return 'typ';
	return 'tex';
}
