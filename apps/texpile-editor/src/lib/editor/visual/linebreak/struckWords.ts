// a suggestion's struck out words, drawn by a widget at one position of a paragraph, as the line breaker's items need them
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { hasOldWords, pmSuggestionsKey } from '../extensions/pmSuggestionsState';
import type { OldRun } from '../extensions/pmSuggestionsPlace';

export type StruckWords = {
	/** one range's words. A suggestion can have several ranges in a paragraph, so its id alone names none of them */
	key: string;
	/** the paragraph offset the words sit at, between two characters */
	at: number;
	text: string;
	/** the runs of one formatting each, as offsets into `text` */
	runs: { from: number; to: number }[];
	element: HTMLElement;
	/** no words: a removed break drawn as the line end it was, which the line breaker ends a line at too */
	lineEnd?: boolean;
};

/** in text order; null while a widget has no element yet */
export function struckWordsIn(view: EditorView, paragraph: PMNode, pos: number, block: HTMLElement): StruckWords[] | null {
	const found: StruckWords[] = [];
	for (const range of pmSuggestionsKey.getState(view.state)?.ranges ?? []) {
		if (!hasOldWords(range) || range.from <= pos || range.from >= pos + paragraph.nodeSize) continue;
		const widgets = [...block.querySelectorAll<HTMLElement>(`.pm-suggest-old[data-comment="${CSS.escape(range.id)}"]`)].filter(
			(widget) => view.posAtDOM(widget, 0) === range.from
		);
		// words cut from the blocks on either side of a join are two widgets, one run of offsets
		const parts: [string | undefined, OldRun[]][] = range.gone
			? [
					['head', range.gone.head],
					['tail', range.gone.tail]
				]
			: [[undefined, range.old]];
		const key = `${range.id} ${range.from}`;
		let text = '';
		const mine: StruckWords[] = [];
		for (const [part, old] of parts) {
			if (old.length === 0) continue;
			const element = widgets.find((widget) => widget.dataset.part === part);
			if (!element) return null;
			const runs = old.map((run) => {
				const from = text.length;
				text += run.text;
				return { from, to: text.length };
			});
			mine.push({ key, at: range.from - pos, text: '', runs, element });
		}
		for (const words of mine) found.push({ ...words, text });
	}
	for (const element of block.querySelectorAll<HTMLElement>('[data-line-end]')) {
		const at = view.posAtDOM(element, 0) - pos;
		if (at > 0 && at < paragraph.nodeSize - 1) found.push({ key: `end ${at}`, at, text: '', runs: [], element, lineEnd: true });
	}
	// two at one position follow their order on the page
	return found.sort((a, b) => a.at - b.at || (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}
