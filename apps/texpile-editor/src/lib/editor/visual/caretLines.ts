// the visual lines of a text block, and the caret position on one of them nearest an x
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { lineBoxesOf, lineIndexAt, type LineBox } from './lineBoxes';

/** every place a caret can stand in a text block: never inside a formula, never inside a surrogate pair */
function caretPositions(block: PMNode, start: number): number[] {
	const out = [start];
	let at = start;
	block.forEach((child) => {
		if (child.isText) {
			const text = child.text ?? '';
			for (let i = 1; i <= text.length; i++) {
				const code = text.charCodeAt(i - 1);
				if (code < 0xd800 || code > 0xdbff) out.push(at + i);
			}
		} else out.push(at + child.nodeSize);
		at += child.nodeSize;
	});
	return out;
}

type BlockLines = { lines: LineBox[]; positions: number[] };

function readBlock(view: EditorView, blockPos: number): BlockLines | null {
	const block = view.state.doc.nodeAt(blockPos);
	const dom = view.nodeDOM(blockPos);
	if (!block?.isTextblock || !(dom instanceof HTMLElement)) return null;
	const lines = lineBoxesOf(dom);
	return lines.length ? { lines, positions: caretPositions(block, blockPos + 1) } : null;
}

// walks the positions rather than asking posAtCoords: that one answers only for points on screen
function nearestOnLine(
	view: EditorView,
	{ lines, positions }: BlockLines,
	from: number,
	step: -1 | 1,
	target: number,
	x: number
): number | null {
	let best: number | null = null;
	let off = Infinity;
	for (let i = from; i >= 0 && i < positions.length; i += step) {
		const caret = view.coordsAtPos(positions[i], 1);
		const line = lineIndexAt(lines, caret);
		if (line === target) {
			const d = Math.abs(caret.left - x);
			if (d < off) [best, off] = [positions[i], d];
		} else if (step > 0 ? line > target : line < target) break;
	}
	return best;
}

/** the position nearest x one visual line above (-1) or below (1) head, null when its block has no such line */
export function posOneLineAway(view: EditorView, blockPos: number, head: number, dir: -1 | 1, x: number): number | null {
	const block = readBlock(view, blockPos);
	const at = block?.positions.indexOf(head) ?? -1;
	if (!block || at < 0) return null;
	const target = lineIndexAt(block.lines, view.coordsAtPos(head, 1)) + dir;
	if (target < 0 || target >= block.lines.length) return null;
	return nearestOnLine(view, block, at + dir, dir, target, x);
}

/** the position nearest x on a block's first line when entered downwards (1), its last when entered upwards (-1) */
export function posOnEdgeLine(view: EditorView, blockPos: number, dir: -1 | 1, x: number): number | null {
	const block = readBlock(view, blockPos);
	if (!block) return null;
	const last = block.positions.length - 1;
	return nearestOnLine(view, block, dir > 0 ? 0 : last, dir, dir > 0 ? 0 : block.lines.length - 1, x);
}
