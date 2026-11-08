// @vitest-environment jsdom
// The diff's working side is the FILE, so it is editable and every keystroke has to reach the
// buffer - the same handler the source editor calls. Two things have to hold for that to be safe.
//
// The version side must stay read-only: it is bytes in git and there is nowhere to write them.
//
// And the panel must not rebuild itself when its own edit comes back. `modified` is a snapshot the
// parent re-takes on refresh and after a save; a rebuild throws the view away, and doing that while
// someone is typing takes their caret to the top of the file mid-sentence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { EditorView } from '@codemirror/view';
import Harness from './DiffPanelHarness.svelte';

type HarnessExports = {
	setOriginal: (v: string) => void;
	setModified: (v: string) => void;
	setLayout: (v: 'unified' | 'split') => void;
};

let host: HTMLDivElement;
let app: HarnessExports | null = null;

beforeEach(() => {
	host = document.createElement('div');
	document.body.appendChild(host);
	// CodeMirror measures on mount; jsdom lays nothing out, and a 0-height scroller is harmless here
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
});

afterEach(() => {
	if (app) unmount(app as unknown as Record<string, unknown>);
	app = null;
	host.remove();
});

function render(props: { readOnly?: boolean; onModifiedInput?: (v: string) => void } = {}): HarnessExports {
	app = mount(Harness, { target: host, props }) as unknown as HarnessExports;
	flushSync();
	return app;
}

/** the editable surface CodeMirror renders; there is one per mounted editor */
const contents = () => [...host.querySelectorAll('.cm-content')] as HTMLElement[];
const editable = () => contents().filter((el) => el.getAttribute('contenteditable') === 'true');

/** an edit through CodeMirror's own pipeline, as a keystroke would arrive */
function type(el: HTMLElement, text: string) {
	const view = EditorView.findFromDOM(el);
	if (!view) throw new Error('no CodeMirror view on that element');
	view.dispatch({ changes: { from: 0, insert: text } });
}

describe('DiffPanel', () => {
	it('lets the working copy be edited and reports every change', () => {
		const seen: string[] = [];
		render({ onModifiedInput: (v) => seen.push(v) });

		const [working] = editable();
		expect(working, 'the working side should be editable').toBeTruthy();

		type(working, 'X');
		flushSync();
		expect(seen.at(-1)).toBe('Xone\ntwo\n');
	});

	it('keeps the saved version read-only in the side-by-side layout', () => {
		const h = render({ onModifiedInput: () => {} });
		h.setLayout('split');
		flushSync();
		// two editors, and exactly one takes input: the version has nowhere to write back to
		expect(contents()).toHaveLength(2);
		expect(editable()).toHaveLength(1);
	});

	it('stays read-only when there is no handler to write through', () => {
		render();
		expect(editable()).toHaveLength(0);
	});

	// a co-edited file is edited through the Y-bound source editor; this pane holds plain text and
	// would replace the whole shared document out from under whoever else is typing
	it('stays read-only while the file is being co-edited', () => {
		render({ readOnly: true, onModifiedInput: () => {} });
		expect(editable()).toHaveLength(0);
	});

	// the caret guard: a snapshot carrying back what was just typed describes the view that is
	// already mounted, so there is nothing to rebuild
	it('does not rebuild when its own edit returns as a new snapshot', () => {
		const seen: string[] = [];
		const h = render({ onModifiedInput: (v) => seen.push(v) });
		const before = contents()[0];

		type(editable()[0], 'X');
		flushSync();
		expect(seen.at(-1)).toBe('Xone\ntwo\n');

		h.setModified('Xone\ntwo\n'); // the parent re-snapshots and hands the same text back
		flushSync();

		expect(contents()[0], 'the mounted editor should survive its own edit').toBe(before);
	});

	it('rebuilds when the version being compared against changes', () => {
		const h = render({ onModifiedInput: () => {} });
		const before = contents()[0];

		h.setOriginal('one\nthree\n');
		flushSync();

		expect(contents()[0]).not.toBe(before);
	});
});
