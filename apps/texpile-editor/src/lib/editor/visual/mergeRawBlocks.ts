// Import-time coalescing of adjacent raw source islands.
//
// A stack of comment lines, or of commands the editor keeps as code, imports as one raw block per
// line - a wall of separate boxes in the visual editor. This pass runs once on a freshly imported
// doc (LaTeX and Typst; the block spans are dialect-neutral) and merges each such run into a
// single raw_latex block whose text is the EXACT source slice of the whole run, inter-block
// whitespace included. Merging never invents or reorders bytes: it only happens when the members'
// spans prove source adjacency and the gaps between them are whitespace on consecutive lines.
//
// Only code merges: a block the editor draws as a command (the dialect says which) stays a block of its own.
//
// The merged block carries a span of its own, so it stays on the verbatim re-emission path; a
// member that could not carry a span disqualifies its run.
import { Fragment } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';
import { blockSpanOf, bytesSpan, noteBlockSpan, noteSpans, type BlockSpan } from './sourceSpans';

/** the dialect's commands the editor draws, which never merge */
export type DrawnCommand = (source: string) => boolean;

// a paragraph that is nothing but chips of code (plus breaks/whitespace): already uneditable as
// prose, so it may join a raw island run
function isChipParagraph(node: PMNode, drawn: DrawnCommand): boolean {
	if (node.type.name !== 'paragraph') return false;
	let chips = 0;
	let pure = true;
	node.forEach((child) => {
		if (child.type.name === 'inline_latex' && child.marks.length === 0 && !drawn(child.textContent)) chips++;
		else if (child.type.name === 'hard_break' || (child.isText && (child.text ?? '').trim() === '')) {
			// structural filler, fine
		} else pure = false;
	});
	return pure && chips > 0;
}

/** the block's own span: one whole construct with bytes of its own. A block of a multi-block
 *  construct, or one the parse could not place, has none to join by */
function ownSpan(node: PMNode): BlockSpan | null {
	const s = blockSpanOf(node);
	return s && s.size === 1 && s.srcTo > s.srcFrom ? s : null;
}

function mergeable(node: PMNode, drawn: DrawnCommand): boolean {
	if (!ownSpan(node)) return false;
	return (node.type.name === 'raw_latex' && !drawn(node.textContent)) || isChipParagraph(node, drawn);
}

// a blank line between two islands is the author's own break; they stay two blocks, each drawn, opened and deleted alone
const BLANK_LINE = /\n[ \t\r]*\n/;

/** may `node` extend a run ending in `prev`? adjacency is proven by the spans, the gap must be
 *  whitespace without a blank line, and raw blocks must agree on their dialect tag */
function extendsRun(prev: PMNode, node: PMNode, source: string, drawn: DrawnCommand): boolean {
	if (!mergeable(node, drawn)) return false;
	const a = ownSpan(prev)!;
	const b = ownSpan(node)!;
	if (b.srcFrom < a.srcTo) return false;
	const between = source.slice(a.srcTo, b.srcFrom);
	if (between.trim() !== '') return false;
	// a comment's slice carries its own line end, so the gap starts inside the slice before it
	const gap = /\s*$/.exec(source.slice(a.srcFrom, a.srcTo))![0] + between + /^\s*/.exec(source.slice(b.srcFrom, b.srcTo))![0];
	if (BLANK_LINE.test(gap)) return false;
	if (prev.type.name === 'raw_latex' && node.type.name === 'raw_latex' && String(prev.attrs.lang ?? '') !== String(node.attrs.lang ?? ''))
		return false;
	return true;
}

/**
 * Merge runs of adjacent raw islands in a top-level doc parsed from `source` (the text the
 * blocks' spans index). Returns the doc unchanged (same object) when there is nothing to merge.
 * The merged block's text opens and closes on no blank line: the whitespace trimmed off its
 * edges stays in the gaps beside its span, where the origins read it back from the source.
 */
export function mergeAdjacentRawBlocks(doc: PMNode, source: string, drawn: DrawnCommand = () => false): PMNode {
	const n = doc.childCount;
	const out: PMNode[] = [];
	let merged = false;

	for (let i = 0; i < n;) {
		let j = i;
		if (mergeable(doc.child(i), drawn)) {
			while (j + 1 < n && extendsRun(doc.child(j), doc.child(j + 1), source, drawn)) j++;
		}
		// a run must actually contain a raw block; two adjacent chip paragraphs stay paragraphs
		let hasRaw = false;
		for (let k = i; k <= j; k++) if (doc.child(k).type.name === 'raw_latex') hasRaw = true;
		if (j === i || !hasRaw) {
			out.push(doc.child(i));
			i++;
			continue;
		}

		const first = ownSpan(doc.child(i))!;
		const last = ownSpan(doc.child(j))!;
		const whole = source.slice(first.srcFrom, last.srcTo);
		const lead = /^\s*/.exec(whole)![0];
		const text = whole.trim();
		if (!text) {
			// nothing but whitespace survived: leave the run untouched rather than invent an island
			for (let k = i; k <= j; k++) out.push(doc.child(k));
			i = j + 1;
			continue;
		}

		const rawMember = (() => {
			for (let k = i; k <= j; k++) if (doc.child(k).type.name === 'raw_latex') return doc.child(k);
			return doc.child(i);
		})();
		const type = rawMember.type;
		const from = first.srcFrom + lead.length;
		const attrs: Record<string, unknown> = 'lang' in (type.spec.attrs ?? {}) ? { lang: rawMember.attrs.lang } : {};
		// the merged text is the source slice, so it maps byte for byte
		const block = type.create(attrs, noteSpans(type.schema.text(text), bytesSpan(text.length, from)));
		out.push(noteBlockSpan(block, { srcFrom: from, srcTo: from + text.length, size: 1 }));
		merged = true;
		i = j + 1;
	}

	return merged ? doc.copy(Fragment.fromArray(out)) : doc;
}
