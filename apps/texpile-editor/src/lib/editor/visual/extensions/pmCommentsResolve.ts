// Placing review threads in the rendered document: a thread's range in the file, through the
// source map. Exact where prose is, the whole node where a node draws its own content, and
// nowhere when the map has no answer, which the panel then says
import type { Node as PMNode } from 'prosemirror-model';
import type { SourceMap } from '../sourceSpans';
import { pmAtOffset } from '../sourceMap';
import type { CommentRange } from './comments';
import type { PmCommentRange } from './pmComments';

export type FlatDoc = {
	/** the document's prose in reading order */
	text: string;
	/** index[i] = ProseMirror position of text[i]; the whole reason this exists instead of textBetween */
	index: number[];
};

/**
 * Atoms whose content ProseMirror still renders, through a hole its node view leaves open.
 *
 * A figure caption is ordinary prose - visible, editable, and exactly the sort of line a reviewer
 * wants to argue with - so it has to be walked like any other text. The image node is only an atom
 * for SELECTION purposes; imageNodeView hands back a contentDOM, so a decoration over the caption
 * renders normally.
 */
const ATOMS_WITH_PROSE = new Set(['image']);

/**
 * One walk over the document collecting its text AND where each character lives.
 *
 * Atoms (math, includes, chips) become a single object-replacement character rather than being
 * skipped: skipping them would splice their neighbours together, and a quote could then match
 * across content that is not text at all. Block boundaries emit one newline, so a quote can never
 * run silently across a paragraph edge - the flat text has a separator where the reader sees one.
 */
export function flattenDoc(doc: PMNode): FlatDoc {
	const index: number[] = [];
	let text = '';
	doc.descendants((node, pos) => {
		// entering any block after the first: separate it from what came before
		if (!node.isText && node.isBlock && text.length > 0 && !text.endsWith('\n')) {
			index.push(pos);
			text += '\n';
		}
		if (node.isText) {
			const s = node.text ?? '';
			for (let i = 0; i < s.length; i++) index.push(pos + i);
			text += s;
			return false;
		}
		// an EMPTY captionable atom still needs its placeholder: with nothing to walk it would
		// splice the blocks on either side of the figure together
		if (node.isAtom && !(ATOMS_WITH_PROSE.has(node.type.name) && node.content.size > 0)) {
			index.push(pos);
			text += '￼';
			return false;
		}
		return true;
	});
	return { text, index };
}

// nodes that draw their own content: a range inside one tints the node, since a decoration on the
// text inside would land where nothing of it is painted
const DRAWN_BY_THEMSELVES = new Set([
	'raw_latex',
	'code_block',
	'block_math',
	'inline_math',
	'inline_latex',
	'citation',
	'ref',
	'label',
	'includedoc'
]);

/** the document range for a range of the file: the characters it maps to, or the node that draws them */
export function pmRangeOf(doc: PMNode, map: SourceMap, from: number, to: number): { from: number; to: number; node?: boolean } | null {
	const size = doc.content.size;
	if (from === to) {
		const at = pmAtOffset(map, from, -1);
		return at === null ? null : { from: Math.min(at, size), to: Math.min(at, size) };
	}
	const a = pmAtOffset(map, from, 1);
	const b = pmAtOffset(map, to, -1);
	if (a === null || b === null) return null;
	const pmFrom = Math.min(a, b, size);
	const pmTo = Math.min(Math.max(a, b), size);
	const $from = doc.resolve(pmFrom);
	for (let d = $from.depth; d > 0; d--) {
		if (DRAWN_BY_THEMSELVES.has($from.node(d).type.name)) return { from: $from.before(d), to: $from.after(d), node: true };
	}
	return { from: pmFrom, to: pmTo };
}

/** every thread's range in this document, and the ids of those the map could not place */
export function placePmComments(doc: PMNode, ranges: CommentRange[], map: SourceMap): { ranges: PmCommentRange[]; lost: string[] } {
	const out: PmCommentRange[] = [];
	const lost: string[] = [];
	for (const r of ranges) {
		const placed = pmRangeOf(doc, map, r.from, r.to);
		if (!placed) {
			lost.push(r.id);
			continue;
		}
		out.push({ id: r.id, from: placed.from, to: placed.to, resolved: r.resolved, ...(placed.node ? { node: true } : {}) });
	}
	return { ranges: out, lost };
}
