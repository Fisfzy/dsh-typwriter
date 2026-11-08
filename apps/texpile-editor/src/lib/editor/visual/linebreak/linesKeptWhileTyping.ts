// lines above an edit stay where they are while someone types in a paragraph: breaking it as a whole on every key
// moves words, and hyphens, on lines the writer is not touching. It is broken as a whole once the caret leaves it
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { isHeldBlock } from './heldBlocks';
import type { KeptBreaks, ParagraphBreaks } from './paragraphBreaks';
import { wordBeingTypedKey } from './wordBeingTyped';

export type LinesKeptWhileTyping = {
	/** the paragraphs this update leaves to be broken again, on top of those whose text changed */
	toBreakAgain(before: EditorState, state: EditorState): PMNode[];
	/** the breaks to keep each time this paragraph is broken while the caret stays in it */
	take(paragraph: PMNode): KeptBreaks | undefined;
	forget(): void;
};

export function linesKeptWhileTyping(chosenFor: (paragraph: PMNode) => ParagraphBreaks | undefined): LinesKeptWhileTyping {
	let pending = new WeakMap<PMNode, KeptBreaks>();
	// broken with kept lines, so not yet the breaks the whole paragraph would get
	let unsettled = new WeakSet<PMNode>();

	function earlierBreaks(paragraph: PMNode): KeptBreaks | undefined {
		const chosen = chosenFor(paragraph);
		// a paragraph that changed twice before it was broken (a composition) carries its kept breaks along
		return typeof chosen === 'object' ? { marks: chosen.marks, unchangedTo: Infinity } : pending.get(paragraph);
	}

	return {
		toBreakAgain(before, state) {
			const again: PMNode[] = [];
			const left = before.selection.$head.parent;
			const { $head } = state.selection;
			const paragraph = $head.parent;
			const typed = wordBeingTypedKey.getState(before) ?? null;
			// a word held whole there is as unfinished as kept lines are
			if (left !== paragraph && (unsettled.has(left) || pending.has(left) || typed)) {
				pending.delete(left);
				again.push(left);
			}
			if (!isHeldBlock(paragraph)) return again;
			const pos = $head.before();
			const released = typed !== null && typed.from !== wordBeingTypedKey.getState(state)?.from;
			// a finished word may now split, and its first half belongs on the line above: that one line is open again
			const beforeWord = released && typed.from > pos && typed.from < pos + paragraph.nodeSize ? typed.from - pos - 1 : Infinity;

			if (before.doc === state.doc) {
				const earlier = released && left === paragraph ? earlierBreaks(paragraph) : undefined;
				if (earlier) {
					pending.set(paragraph, { marks: earlier.marks, unchangedTo: Math.min(earlier.unchangedTo, beforeWord) });
					again.push(paragraph);
				}
				return again;
			}
			if (chosenFor(paragraph)) return again;
			const old = pos < before.doc.content.size ? before.doc.nodeAt(pos) : null;
			if (!old || !old.sameMarkup(paragraph)) return again;
			const earlier = earlierBreaks(old);
			const changedAt = old.content.findDiffStart(paragraph.content);
			if (earlier && changedAt !== null)
				pending.set(paragraph, { marks: earlier.marks, unchangedTo: Math.min(earlier.unchangedTo, changedAt + 1, beforeWord) });
			return again;
		},
		// not handed out once only: redrawing a suggestion's struck words breaks the paragraph again before the next key
		take(paragraph) {
			const kept = pending.get(paragraph);
			if (kept) unsettled.add(paragraph);
			else unsettled.delete(paragraph);
			return kept;
		},
		forget() {
			pending = new WeakMap();
			unsettled = new WeakSet();
		}
	};
}
