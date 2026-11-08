// the caret beside a suggestion's old words in the visual editor
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { typingSide } from '$lib/comments/activeSuggestions.svelte';
import { clickedSide, sideAtOldWords, type CaretSide } from '$lib/comments/oldWordsCaret';
import type { TypingSide } from '$lib/comments/suggestCompare';
import { pmSuggestionsKey, struckAt, type PmSuggestionsMeta } from './pmSuggestionsState';

function setCaret(view: EditorView, caret: CaretSide, tr: Transaction = view.state.tr): void {
	view.dispatch(tr.setMeta(pmSuggestionsKey, { type: 'caret', caret } satisfies PmSuggestionsMeta));
}

// the words, without the block standing for whole blocks taken out: that one is out of the line at a
// line's end, and a click beside it says nothing about which side of the words it meant
function oldWordsElements(view: EditorView, at: number): HTMLElement[] {
	const ids = new Set(struckAt(view.state, at).map((r) => r.id));
	return [...view.dom.querySelectorAll<HTMLElement>('.pm-suggest-old:not(.pm-suggest-gone)')].filter((el) =>
		ids.has(el.dataset.comment ?? '')
	);
}

function stepAtOldWords(view: EditorView, forward: boolean): boolean {
	const { state } = view;
	const sel = state.selection;
	if (!(sel instanceof TextSelection) || !sel.empty) return false;
	const here = sel.head;
	const want: TypingSide = forward ? 'after' : 'before';
	const struck = struckAt(state, here);
	if (struck.length && sideAtOldWords(pmSuggestionsKey.getState(state)?.caret ?? null, here, struck.map(typingSide)) !== want) {
		setCaret(view, { at: here, side: want });
		return true;
	}
	const next = here + (forward ? 1 : -1);
	const $here = sel.$head;
	if (next < $here.start() || next > $here.end() || struckAt(state, next).length === 0) return false;
	const between = state.doc.textBetween(Math.min(here, next), Math.max(here, next), '', '￼');
	if (/[\uD800-\uDFFF]/.test(between)) return false;
	setCaret(
		view,
		{ at: next, side: forward ? 'before' : 'after' },
		state.tr.setSelection(TextSelection.create(state.doc, next)).scrollIntoView()
	);
	return true;
}

/** old words at the caret that an arrow the given way steps across before anything else moves */
export function oldWordsAhead(state: EditorState, forward: boolean): boolean {
	const sel = state.selection;
	if (!(sel instanceof TextSelection) || !sel.empty) return false;
	const struck = struckAt(state, sel.head);
	const side = sideAtOldWords(pmSuggestionsKey.getState(state)?.caret ?? null, sel.head, struck.map(typingSide));
	return struck.length > 0 && side !== (forward ? 'after' : 'before');
}

/** a caret stepped over something to `at`: old words there are met on the side it came from */
export function landBesideOldWords(state: EditorState, tr: Transaction, at: number, forward: boolean): Transaction {
	if (struckAt(state, at).length === 0) return tr;
	return tr.setMeta(pmSuggestionsKey, { type: 'caret', caret: { at, side: forward ? 'before' : 'after' } } satisfies PmSuggestionsMeta);
}

// ProseMirror steps the caret across a widget before the browser moves it a line, which here is a
// jump the width of the old words; the browser's own move keeps the column
function moveLineAtOldWords(view: EditorView, forward: boolean, extend: boolean): boolean {
	const sel = view.state.selection;
	if (!(sel instanceof TextSelection) || (!sel.empty && !extend)) return false;
	if (struckAt(view.state, sel.head).length === 0) return false;
	if (!extend && view.endOfTextblock(forward ? 'down' : 'up')) return false;
	const dom = view.dom.ownerDocument.getSelection();
	if (!dom) return false;
	dom.modify(extend ? 'extend' : 'move', forward ? 'forward' : 'backward', 'line');
	return true;
}

export function oldWordsKeyDown(view: EditorView, event: KeyboardEvent): boolean {
	if (event.ctrlKey || event.altKey || event.metaKey) return false;
	if (event.key === 'ArrowUp' || event.key === 'ArrowDown') return moveLineAtOldWords(view, event.key === 'ArrowDown', event.shiftKey);
	if (event.shiftKey) return false;
	if (event.key === 'ArrowLeft') return stepAtOldWords(view, false);
	if (event.key === 'ArrowRight') return stepAtOldWords(view, true);
	return false;
}

// the block standing for blocks taken out whole is no place for a caret, and left to the browser a click on it
// put one somewhere else in the document: it goes to the join, on the side of the words the block stands by
function clickOnGoneBlocks(view: EditorView, event: MouseEvent): boolean {
	const box = event.target instanceof Element ? event.target.closest<HTMLElement>('.pm-suggest-gone') : null;
	if (!box || !view.dom.contains(box)) return false;
	const range = pmSuggestionsKey.getState(view.state)?.ranges.find((r) => r.gone && r.id === box.dataset.comment);
	if (!range) return false;
	const sel = TextSelection.near(view.state.doc.resolve(range.from));
	const words = oldWordsElements(view, sel.head);
	const tr = view.state.tr.setSelection(sel);
	if (words.length === 0) view.dispatch(tr);
	else
		setCaret(
			view,
			{ at: sel.head, side: box.compareDocumentPosition(words[0]) & Node.DOCUMENT_POSITION_PRECEDING ? 'after' : 'before' },
			tr
		);
	view.focus();
	return true;
}

export function oldWordsClick(view: EditorView, pos: number, event: MouseEvent): boolean {
	if (clickOnGoneBlocks(view, event)) return true;
	const words = oldWordsElements(view, pos);
	if (words.length === 0) return false;
	const side = clickedSide(words, event.clientX, event.clientY);
	if (side) setCaret(view, { at: pos, side }, view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
	return false;
}

function domCaretSide(view: EditorView, at: number): TypingSide | null {
	const dom = view.dom.ownerDocument.getSelection();
	const node = dom?.focusNode;
	if (!dom || !node || node !== dom.anchorNode || dom.focusOffset !== dom.anchorOffset || !view.dom.contains(node)) return null;
	const words = oldWordsElements(view, at);
	if (words.length === 0 || words.some((el) => el.contains(node))) return null;
	try {
		if (view.posAtDOM(node, dom.focusOffset) !== at) return null;
	} catch {
		return null;
	}
	const caret = document.createRange();
	caret.setStart(node, dom.focusOffset);
	const first = document.createRange();
	first.selectNode(words[0]);
	return caret.compareBoundaryPoints(Range.START_TO_START, first) <= 0 ? 'before' : 'after';
}

/**
 * The side the browser put the caret on, when its own move (a line up or down) lands it at old words.
 * Taken before the view redraws: a widget on the other side makes ProseMirror move the caret across
 * it, and any selection it writes costs the browser the column it was keeping.
 */
export function caretSideWhereItLanded(view: EditorView, trs: readonly Transaction[], state: EditorState): Transaction | null {
	if (!trs.some((tr) => tr.selectionSet) || trs.some((tr) => tr.docChanged || tr.getMeta(pmSuggestionsKey))) return null;
	const sel = state.selection;
	if (!(sel instanceof TextSelection) || !sel.empty) return null;
	const struck = struckAt(state, sel.head);
	if (struck.length === 0) return null;
	const side = domCaretSide(view, sel.head);
	const drawn = sideAtOldWords(pmSuggestionsKey.getState(state)?.caret ?? null, sel.head, struck.map(typingSide));
	if (!side || side === drawn) return null;
	return state.tr.setMeta(pmSuggestionsKey, { type: 'caret', caret: { at: sel.head, side } } satisfies PmSuggestionsMeta);
}
