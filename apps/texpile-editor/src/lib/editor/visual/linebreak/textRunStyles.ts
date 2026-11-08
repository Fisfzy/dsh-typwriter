// how a run of text in the visual editor is drawn, as far as its width goes
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

export type TextRunStyle = {
	/** every field below in one string, to keep widths under */
	key: string;
	font: string;
	letterSpacing: string;
	wordSpacing: string;
	kerning: CanvasFontKerning;
	caps: CanvasFontVariantCaps;
	stretch: CanvasFontStretch;
	/** the case the text is drawn in, which changes its width */
	transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
	/** false when the text alone does not give its width: a case change or a stretch canvas cannot make */
	measurable: boolean;
};

// the computed value is a percentage; canvas takes the keyword
const STRETCHES: Record<string, CanvasFontStretch> = {
	'50%': 'ultra-condensed',
	'62.5%': 'extra-condensed',
	'75%': 'condensed',
	'87.5%': 'semi-condensed',
	'100%': 'normal',
	normal: 'normal',
	'112.5%': 'semi-expanded',
	'125%': 'expanded',
	'150%': 'extra-expanded',
	'200%': 'ultra-expanded'
};
const TRANSFORMS = new Set(['none', 'uppercase', 'lowercase', 'capitalize']);

function styleOfElement(element: Element): TextRunStyle {
	const style = getComputedStyle(element);
	// style.font reads '' here: the editor turns ligatures off, which the shorthand cannot say
	const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
	const letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
	const wordSpacing = style.wordSpacing === 'normal' ? '0px' : style.wordSpacing;
	const kerning = style.fontKerning as CanvasFontKerning;
	const caps = style.fontVariantCaps as CanvasFontVariantCaps;
	const stretch = STRETCHES[style.fontStretch] ?? 'normal';
	const transform = (TRANSFORMS.has(style.textTransform) ? style.textTransform : 'none') as TextRunStyle['transform'];
	return {
		key: [font, letterSpacing, wordSpacing, kerning, caps, stretch, transform].join('|'),
		font,
		letterSpacing,
		wordSpacing,
		kerning,
		caps,
		stretch,
		transform,
		measurable: TRANSFORMS.has(style.textTransform) && style.fontStretch in STRETCHES
	};
}

function deepestElementAt(view: EditorView, pos: number): Element | null {
	const at = view.domAtPos(pos, 1);
	let node: Node | null = at.node.nodeType === Node.TEXT_NODE ? at.node : (at.node.childNodes[at.offset] ?? at.node);
	while (node?.firstChild) node = node.firstChild;
	if (!node) return null;
	return node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
}

export type RunStyleReader = {
	/** the style of a run of the document's text */
	ofRun(view: EditorView, block: HTMLElement, run: PMNode, pos: number): TextRunStyle | null;
	/** the style of the text an element draws (a suggestion's struck words) */
	ofElement(element: Element): TextRunStyle;
};

/** reads a style once for each set of marks in a block, and once per element; a block keeps its element across edits */
export function runStyleReader(): RunStyleReader {
	const seen = new WeakMap<HTMLElement, Map<string, TextRunStyle>>();
	const byElement = new WeakMap<Element, TextRunStyle>();
	return {
		ofRun(view, block, run, pos) {
			let styles = seen.get(block);
			if (!styles) seen.set(block, (styles = new Map()));
			const marks = run.marks.map((mark) => mark.type.name + JSON.stringify(mark.attrs)).join();
			let style = styles.get(marks);
			if (!style) {
				const element = deepestElementAt(view, pos);
				if (!element || !block.contains(element)) return null;
				styles.set(marks, (style = styleOfElement(element)));
			}
			return style;
		},
		ofElement(element) {
			let style = byElement.get(element);
			if (!style) byElement.set(element, (style = styleOfElement(element)));
			return style;
		}
	};
}
