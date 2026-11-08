// @vitest-environment jsdom
// A paragraph break has no glyph of its own, so a suggestion that only adds or removes one used to
// draw at zero width, or not at all. Splitting a paragraph is an ordinary edit and has to be visible.
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editMode } from '$lib/comments/activeSuggestions.svelte';
import { cmSuggestions, setSuggestionRanges, type SuggestionRange } from '$lib/editor/source/cmSuggestions';

const TEXT = `One paragraph of prose.\n\nA second one follows it.\n`;

function drawn(text: string, ranges: SuggestionRange[]) {
	editMode.current = 'suggesting';
	const place = document.createElement('div');
	document.body.appendChild(place);
	const view = new EditorView({ state: EditorState.create({ doc: text, extensions: [cmSuggestions()] }), parent: place });
	view.dispatch({ effects: setSuggestionRanges.of(ranges) });
	const seen = {
		old: [...view.dom.querySelectorAll('.cm-suggest-old')].map((e) => e.textContent),
		bars: [...view.dom.querySelectorAll('.cm-suggest-break')].map((e) => (e.className.includes('removed') ? 'removed' : 'added')),
		lines: view.dom.querySelectorAll('.cm-suggest-break-lines').length,
		rowBreaks: view.dom.querySelectorAll('.cm-suggest-old br').length
	};
	view.destroy();
	return seen;
}

describe('a suggestion that only moves a paragraph break', () => {
	it('shows the break a split added', () => {
		// the file already holds the split; the suggestion covers the two newlines it put in
		const at = TEXT.indexOf('\n\n');
		const seen = drawn(TEXT, [{ id: 'split', from: at, to: at + 2, restore: '', mine: true }]);
		// the blank lines it opened carry the bar down their edge, as a diff does
		expect(seen.lines).toBeGreaterThan(0);
	});

	it('shows the break a join took out', () => {
		const at = TEXT.indexOf('prose.') + 'prose.'.length;
		const seen = drawn(`One paragraph of prose.A second one follows it.\n`, [
			{ id: 'join', from: at, to: at, restore: '\n\n', mine: true }
		]);
		expect(seen.bars).toEqual(['removed']);
		expect(seen.old).toEqual([]);
	});

	it('keeps struck words on the lines they held, with a bar only for the blank line between them', () => {
		const at = TEXT.indexOf('prose.');
		const seen = drawn(TEXT, [{ id: 'words', from: at, to: at, restore: 'verse.\n\nAnother', mine: true }]);
		expect(seen.old).toEqual(['verse.Another']);
		expect(seen.rowBreaks).toBe(2);
		expect(seen.bars).toEqual(['removed']);
	});
});
