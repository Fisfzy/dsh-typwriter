import { it, expect } from 'vitest';
import { linesFromBoxes } from '$lib/editor/visual/lineBoxes';

it('keeps a tall formula on the line of the words beside it, and the next line apart', () => {
	const words = { top: 388, bottom: 412 };
	const fraction = { top: 380, bottom: 419 };
	const nextLine = { top: 419, bottom: 446 };
	const lineAbove = { top: 338, bottom: 365 };
	expect(linesFromBoxes([words, nextLine, fraction, lineAbove])).toEqual([
		{ top: 338, bottom: 365 },
		{ top: 380, bottom: 419 },
		{ top: 419, bottom: 446 }
	]);
});
