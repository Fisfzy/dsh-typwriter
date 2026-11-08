// which side of a suggestion's old words the caret stands on
import type { TypingSide } from './suggestCompare';

export type CaretSide = { at: number; side: TypingSide };

export function sideAtOldWords(caret: CaretSide | null, at: number, own: TypingSide[]): TypingSide | null {
	if (caret?.at === at) return caret.side;
	return own.every((s) => s === own[0]) ? (own[0] ?? null) : null;
}

export function clickedSide(words: Element[], x: number, y: number): TypingSide | null {
	const rects = words.flatMap((el) => [...el.getClientRects()]).filter((r) => r.width > 0 && r.height > 0);
	if (rects.length === 0) return null;
	const first = rects[0];
	const last = rects[rects.length - 1];
	const line = first.bottom - first.top;
	if (y < first.top - line / 2) return 'before';
	if (y > last.bottom + line / 2) return 'after';
	if (last.top >= first.bottom) return y < last.top ? 'before' : 'after';
	return x < (first.left + last.right) / 2 ? 'before' : 'after';
}
