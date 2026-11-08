// @vitest-environment jsdom
// box() must keep the writable's notification contract (safe_not_equal): the visual editor's
// menuUpdatePlugin re-assigns the SAME EditorView every transaction and the toolbars' active-mark
// effects re-run on exactly that poke - plain === equality would freeze them at mount state.
// Observed through observe() (runes compile only in .svelte.ts, so the effect lives there);
// observe fires once at attach and once more on the effect's first flush, hence the baseline of 2.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { box } from '$lib/runes/box.svelte';
import { observe } from '$lib/runes/observe.svelte';

function watch<T>(b: { current: T }): { runs: () => number; stop: () => void } {
	let n = 0;
	const stop = observe(
		() => b.current,
		() => n++
	);
	flushSync();
	return { runs: () => n, stop };
}

describe('box notification contract', () => {
	it('signals on a new value', () => {
		const b = box(1);
		const w = watch(b);
		const base = w.runs();
		b.current = 2;
		flushSync();
		expect(w.runs()).toBe(base + 1);
		w.stop();
	});

	it('does not signal on an equal primitive (writable parity)', () => {
		const b = box('a');
		const w = watch(b);
		const base = w.runs();
		b.current = 'a';
		flushSync();
		expect(w.runs()).toBe(base);
		w.stop();
	});

	it('signals on a same-reference object set (the toolbar poke)', () => {
		const view = { state: 1 };
		const b = box<object | null>(view);
		const w = watch(b);
		const base = w.runs();
		b.current = view;
		flushSync();
		expect(w.runs()).toBe(base + 1);
		w.stop();
	});

	// the setter's equality check and poke increment read box state; untracked, or a WRITER inside
	// an effect adopts the box as a dependency and a same-ref republish loops forever
	// (effect_update_depth_exceeded on workspace mount, via DocRegistries.publish)
	it('a write inside a tracked scope does not adopt the box as a dependency', () => {
		const view = { state: 1 };
		const b = box<object | null>(view);
		let runs = 0;
		const stop = observe(
			() => {
				runs++;
				b.current = view; // same-ref poke from inside the tracked read
				return runs;
			},
			() => {}
		);
		expect(() => flushSync()).not.toThrow();
		expect(runs).toBeLessThanOrEqual(3);
		stop();
	});
});
