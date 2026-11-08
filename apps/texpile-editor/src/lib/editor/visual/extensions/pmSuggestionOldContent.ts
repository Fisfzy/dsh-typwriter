// what a change took out, drawn where it stood
import type { Fragment, Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { chipLetters } from '$lib/editor/spellcheck/blockSpellText';
import type { GoneContent, OldRun } from './pmSuggestionTypes';

function runsOf(content: Fragment): OldRun[] {
	const runs: OldRun[] = [];
	content.forEach((node) => {
		if (node.isText) runs.push({ text: node.text!, marks: node.marks });
		else if (node.isInline) {
			// an accent chip draws as its letter, and its letter is what the reader would miss
			const letters = chipLetters(node);
			runs.push(letters ? { text: letters, marks: node.marks } : { text: '￼', marks: node.marks, node });
		}
	});
	return runs;
}

// the innermost node a slice leaves open at one end
function openEnd(fragment: Fragment, depth: number, last: boolean): PMNode | null {
	let node = last ? fragment.lastChild : fragment.firstChild;
	for (let d = 1; d < depth && node; d++) node = last ? node.lastChild : node.firstChild;
	return node;
}

type OldContent = { runs: OldRun[]; gone: GoneContent | null };

// a textblock the change takes from its very start, or to its very end, went whole, and so did every
// block around it that it opens or closes: the depth of the outermost, or null when it went in part
function wholeAt($pos: ResolvedPos, shared: number, atEnd: boolean): number | null {
	if ($pos.parentOffset !== (atEnd ? $pos.parent.content.size : 0)) return null;
	let depth = $pos.depth;
	while (depth - 1 > shared && $pos.index(depth - 1) === (atEnd ? $pos.node(depth - 1).childCount - 1 : 0)) depth--;
	return depth;
}

export function oldContent(doc: PMNode, from: number, to: number): OldContent {
	if (to <= from) return { runs: [], gone: null };
	const $from = doc.resolve(from);
	const $to = doc.resolve(to);
	if ($from.sameParent($to) && $from.parent.isTextblock) return { runs: runsOf(doc.slice(from, to).content), gone: null };
	const slice = doc.slice(from, to);
	const shared = $from.sharedDepth(to);
	const first = slice.openStart ? openEnd(slice.content, slice.openStart, false) : null;
	const last = slice.openEnd ? openEnd(slice.content, slice.openEnd, true) : null;
	const head = first?.isTextblock ? first : null;
	const tail = last?.isTextblock && last !== first ? last : null;
	// drawn as the blocks they were rather than as words run on at the join
	const headWhole = head ? wholeAt($from, shared, false) : null;
	const tailWhole = tail ? wholeAt($to, shared, true) : null;
	const blocks: PMNode[] = [];
	let depthOf = Infinity;
	// a block taken out whole is drawn whole (a table as a table); only the ones the change cuts
	// through are opened up, and a row or a cell does not stand alone
	function collect(node: PMNode, depth: number, first: boolean, last: boolean) {
		const at = shared + depth;
		const whole = first && at === headWhole ? $from.node(at) : last && at === tailWhole ? $to.node(at) : null;
		if (!whole && (node === head || node === tail)) return;
		const cut = (first && depth <= slice.openStart) || (last && depth <= slice.openEnd);
		if (whole || node.isTextblock || node.isLeaf || node.isAtom || (!cut && node.type.isInGroup('block'))) {
			blocks.push(whole ?? node);
			depthOf = Math.min(depthOf, at - 1);
		} else node.forEach((child, _, i) => collect(child, depth + 1, first && i === 0, last && i === node.childCount - 1));
	}
	slice.content.forEach((node, _, i) => collect(node, 1, i === 0, i === slice.content.childCount - 1));
	return {
		runs: [],
		gone: {
			head: head && headWhole === null ? runsOf(head.content) : [],
			blocks,
			tail: tail && tailWhole === null ? runsOf(tail.content) : [],
			depth: blocks.length ? depthOf : shared
		}
	};
}
