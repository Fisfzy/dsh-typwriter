// widths of the inline node views in a paragraph (formulas, citations, raw chips), and word of it when one changes size
import { cssZoomOf } from '../lineBoxes';

export type InlineBoxWatch = {
	/** the room the node view takes on a line; it is watched from here on */
	widthOf(dom: HTMLElement): number;
	disconnect(): void;
};

function boxWidth(element: Element): number {
	let width = 0;
	// an inline box the browser has wrapped reports one rect for each line it is on
	for (const rect of element.getClientRects()) width += rect.width;
	return width;
}

export function inlineBoxWatch(onResize: (element: Element) => void): InlineBoxWatch {
	const measured = new WeakMap<Element, number>();
	// a math field fills its shadow tree after it is attached, which no mutation record reports
	const sizes = new ResizeObserver((entries) => {
		for (const { target } of entries) {
			const width = boxWidth(target);
			if (Math.abs(width - (measured.get(target) ?? width)) < 0.01) continue;
			measured.set(target, width);
			onResize(target);
		}
	});
	return {
		widthOf(dom) {
			// the node view's own element is often a bare inline span, which is never reported; its children are
			for (const element of [dom, ...dom.children]) {
				if (!measured.has(element)) sizes.observe(element);
				measured.set(element, boxWidth(element));
			}
			const style = getComputedStyle(dom);
			return measured.get(dom)! / cssZoomOf(dom) + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
		},
		disconnect: () => sizes.disconnect()
	};
}
