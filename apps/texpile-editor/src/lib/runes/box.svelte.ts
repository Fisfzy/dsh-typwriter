import { untrack } from 'svelte';

// the runes replacement for a module-level writable: a $state signal behind a stable
// { current } accessor object, callable from plain .ts modules (the rune compiles here)
export type Box<T> = {
	current: T;
};

/**
 * Holds by reference: reassigning .current signals, mutating the held value does not.
 *
 * Notification matches the writable this replaced (safe_not_equal): a same-reference
 * object/function assignment still signals. That poke is load-bearing - the visual editor's
 * menuUpdatePlugin re-assigns the same EditorView every transaction, and the toolbars' active-mark
 * effects re-run on exactly that. $state.raw alone (=== equality) would swallow it.
 */
export function box<T>(initial: T): Box<T> {
	let value = $state.raw(initial);
	let pokes = $state(0);
	return {
		get current(): T {
			void pokes;
			return value;
		},
		set current(next: T) {
			// untracked: the equality check reads `value` and the poke reads `pokes`, and inside an
			// effect those reads would make the WRITER depend on this box - an effect that assigns
			// the same object twice then re-triggers itself forever (store.set tracked nothing)
			untrack(() => {
				if (next === value && ((typeof next === 'object' && next !== null) || typeof next === 'function')) pokes += 1;
				value = next;
			});
		}
	};
}
