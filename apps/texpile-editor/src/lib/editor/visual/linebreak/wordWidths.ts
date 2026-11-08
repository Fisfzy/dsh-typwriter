// widths of pieces of text as the editor lays them out, measured on a canvas so no layout is forced
import type { TextRunStyle } from './textRunStyles';

const MOST_WIDTHS_PER_STYLE = 50000;
// CSS capitalize raises the first letter of each word; a word here starts after anything but a letter or a digit
const WORD_START = /(^|[^\p{L}\p{N}])(\p{L})/gu;

let context: CanvasRenderingContext2D | null = null;
let applied = '';
const widths = new Map<string, Map<string, number>>();

function contextFor(style: TextRunStyle): CanvasRenderingContext2D {
	context ??= document.createElement('canvas').getContext('2d')!;
	if (applied !== style.key) {
		context.font = style.font;
		context.letterSpacing = style.letterSpacing;
		context.wordSpacing = style.wordSpacing;
		context.fontKerning = style.kerning;
		context.fontVariantCaps = style.caps;
		context.fontStretch = style.stretch;
		applied = style.key;
	}
	return context;
}

function drawnAs(style: TextRunStyle, text: string): string {
	switch (style.transform) {
		case 'uppercase':
			return text.toUpperCase();
		case 'lowercase':
			return text.toLowerCase();
		case 'capitalize':
			return text.replace(WORD_START, (_, before: string, letter: string) => before + letter.toUpperCase());
		default:
			return text;
	}
}

export function textWidth(style: TextRunStyle, text: string): number {
	let known = widths.get(style.key);
	if (!known) widths.set(style.key, (known = new Map()));
	let width = known.get(text);
	if (width === undefined) {
		if (known.size >= MOST_WIDTHS_PER_STYLE) known.clear();
		width = contextFor(style).measureText(drawnAs(style, text)).width;
		known.set(text, width);
	}
	return width;
}

/** a face that finished loading changes what the same font string measures */
export function forgetTextWidths(): void {
	widths.clear();
	applied = '';
}
