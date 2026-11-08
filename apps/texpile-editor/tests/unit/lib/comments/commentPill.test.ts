// @vitest-environment jsdom
// The floating Comment button, and the control that gets rid of it. It floats OVER the line above
// the selection, so when it is unwanted it is not merely noise - it hides text. That makes the off
// switch part of the feature, and these cover the switch rather than the placement (jsdom lays
// nothing out, so the coordinates the pill computes are not meaningful here).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '$lib/languages/latex/schema/latexPMSchema';
import { settings } from '$lib/settings';
import { pmComments } from '$lib/editor/visual/extensions/pmComments';
import { refiner, type SelectionRefiner } from '$lib/ai/selectionRefiner';
import { refineCard } from '$lib/ai/refineCardState.svelte';

let host: HTMLDivElement;
let view: EditorView | null = null;

function mountWithSelection(): HTMLElement {
	const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello world')])]);
	const state = EditorState.create({ doc, plugins: pmComments({ onAdd: () => {}, sourceAnchor: () => null }) });
	view = new EditorView(host, { state });
	// jsdom lays nothing out, so the real coordsAtPos gives the pill nowhere to go and it hides for
	// the wrong reason. Fixed coordinates well inside the window put the branching under test.
	view.coordsAtPos = () => ({ top: 100, bottom: 116, left: 50, right: 60 });
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
	return host.querySelector('.cm-comment-add-row') as HTMLElement;
}

const press = (el: Element) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

beforeEach(() => {
	host = document.createElement('div');
	document.body.appendChild(host);
	settings.current = { ...settings.current, commentPill: true };
	// ResizeObserver is not in jsdom, and the plugin observes the editor to reposition
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

afterEach(() => {
	view?.destroy();
	view = null;
	host.remove();
	vi.unstubAllGlobals();
});

describe('comment pill', () => {
	it('offers the Comment button and a way to turn it off', () => {
		const row = mountWithSelection();
		expect(row).not.toBeNull();
		expect(row.querySelectorAll('button:not([hidden])').length).toBe(2);
		// shown for a real selection - without this the two "hidden" cases below prove nothing
		expect(row.style.display).toBe('flex');
	});

	it('the dismiss control turns the setting off, not just this one showing', () => {
		const row = mountWithSelection();
		press(row.querySelector('.cm-comment-add-off')!);
		expect(settings.current.commentPill).toBe(false);
		// and it leaves immediately rather than lingering until the next selection change
		expect(row.style.display).toBe('none');
	});

	it('offers Refine when an agent is set up, and opens its card', () => {
		refiner.current = { available: true, busy: false } as SelectionRefiner;
		try {
			const row = mountWithSelection();
			const buttons = row.querySelectorAll('button:not([hidden])');
			expect(buttons.length).toBe(3);
			press(buttons[1]);
			expect(refineCard.current).not.toBeNull();
		} finally {
			refiner.current = null;
			refineCard.current = null;
		}
	});

	it('stays away entirely once turned off', () => {
		settings.current = { ...settings.current, commentPill: false };
		const row = mountWithSelection();
		expect(row.style.display).toBe('none');
	});

	it('comes back when the setting is turned on again, without a new selection', () => {
		settings.current = { ...settings.current, commentPill: false };
		const row = mountWithSelection();
		expect(row.style.display).toBe('none');
		settings.current = { ...settings.current, commentPill: true };
		// the pill follows the setting through an effect, which flushes on the microtask
		flushSync();
		expect(row.style.display).toBe('flex');
	});
});
