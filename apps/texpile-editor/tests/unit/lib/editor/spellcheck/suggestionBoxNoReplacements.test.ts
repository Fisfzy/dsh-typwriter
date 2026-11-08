// @vitest-environment jsdom
// harper returns no replacement list at all for a word it cannot place near anything it knows;
// the box mounted nothing for those, so the underline could never be acted on
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { createHarperSuggestionBox } from '$lib/editor/spellcheck/suggestionBoxFactory';

const problem = (replacements?: string[]) => ({
	from: 0,
	to: 15,
	msg: 'Did you mean to spell this word this way?',
	shortmsg: 'Spelling',
	type: 'UnknownWord',
	replacements,
	text: 'fwaawfawffwafwa'
});

// the box animates in; jsdom has no Web Animations
beforeAll(() => {
	if (!Element.prototype.animate) {
		Element.prototype.animate = (() => ({ cancel() {}, finished: Promise.resolve(), onfinish: null })) as never;
	}
});

afterEach(() => document.getElementById('harper-suggestion-container')?.remove());

describe('createHarperSuggestionBox', () => {
	it('opens for a flagged word that has no suggestions', () => {
		const box = createHarperSuggestionBox({
			error: problem() as never,
			errors: [problem() as never],
			position: { x: 10, y: 10 },
			onReplace: () => {},
			onIgnore: () => {},
			onClose: () => {},
			invalidateCache: () => {}
		});
		const container = document.getElementById('harper-suggestion-container');
		expect(container).not.toBeNull();
		// mounted with its actions; no suggestion rows to offer, so the word itself is not repeated
		expect(container!.textContent).toContain('Spelling');
		expect(container!.textContent).toMatch(/dictionary/i);
		box.destroy();
		expect(document.getElementById('harper-suggestion-container')).toBeNull();
	});
});
