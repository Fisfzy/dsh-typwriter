// @vitest-environment jsdom
// mathlive re-renders its suggestion popover by destroying the visible panel and inserting a
// fresh display:none one (visible again only after its 32ms show timeout) - the flash the
// bridge exists to remove. These drive the observer with the same remove+add mutation batches.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installSuggestionPopoverFlashFix } from '$lib/editor/visual/extensions/mathlivebridge/suggestionPopoverFlashFix';

const ID = 'mathlive-suggestion-popover';

function makePanel(opts: { visible: boolean; current?: boolean }): HTMLElement {
	const panel = document.createElement('div');
	panel.id = ID;
	if (opts.visible) panel.classList.add('is-visible', 'top-tip');
	panel.style.top = '120px';
	panel.style.left = '340px';
	if (opts.current) panel.innerHTML = '<ul><li class="ML__popover__current">x</li></ul>';
	return panel;
}

function flushObserver(): Promise<void> {
	return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
	document.body.innerHTML = '';
	Element.prototype.scrollIntoView = vi.fn();
	installSuggestionPopoverFlashFix();
});

describe('suggestion popover flash bridge', () => {
	it('carries visibility, position and tip class across a same-batch re-render', async () => {
		const old = makePanel({ visible: true });
		document.body.appendChild(old);
		await flushObserver();
		// mathlive's re-render: remove and replace synchronously, replacement starts hidden
		const fresh = makePanel({ visible: false, current: true });
		fresh.style.top = '';
		fresh.style.left = '';
		old.remove();
		document.body.appendChild(fresh);
		await flushObserver();
		expect(fresh.classList.contains('is-visible')).toBe(true);
		expect(fresh.classList.contains('top-tip')).toBe(true);
		expect(fresh.style.top).toBe('120px');
		expect(fresh.style.left).toBe('340px');
		expect(fresh.querySelector('.ML__popover__current')!.scrollIntoView).toHaveBeenCalled();
	});

	it('leaves a first open alone, so the deliberate fade-in still runs', async () => {
		const fresh = makePanel({ visible: false });
		document.body.appendChild(fresh);
		await flushObserver();
		expect(fresh.classList.contains('is-visible')).toBe(false);
	});

	it('does not force visibility when the removed panel never showed', async () => {
		const old = makePanel({ visible: false });
		document.body.appendChild(old);
		await flushObserver();
		const fresh = makePanel({ visible: false });
		old.remove();
		document.body.appendChild(fresh);
		await flushObserver();
		expect(fresh.classList.contains('is-visible')).toBe(false);
	});

	it('a plain close (remove without replacement) is a no-op', async () => {
		const old = makePanel({ visible: true });
		document.body.appendChild(old);
		await flushObserver();
		old.remove();
		await flushObserver();
		expect(document.getElementById(ID)).toBeNull();
	});
});
