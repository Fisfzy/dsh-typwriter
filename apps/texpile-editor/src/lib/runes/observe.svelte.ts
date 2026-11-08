import { untrack } from 'svelte';

// the runes replacement for store.subscribe in non-reactive scopes (plugin classes, module
// top-levels): onChange fires once synchronously now (as subscribe did) and again on every
// change to the reactive state `read` touches. The effect's first flush repeats the initial
// value once; every caller is an idempotent recompute, which is what makes this safe.
// onChange runs untracked, so what it reads never becomes a dependency - subscribe semantics.
export function observe<T>(read: () => T, onChange: (value: T) => void): () => void {
	onChange(read());
	return $effect.root(() => {
		$effect(() => {
			const value = read();
			untrack(() => onChange(value));
		});
	});
}
