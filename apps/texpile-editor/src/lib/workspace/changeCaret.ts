/**
 * Where to leave the caret after a whole-buffer swap (a cross-mode history step).
 *
 * The native PM/CM histories move the selection as part of their own step; this layer replaces the
 * source wholesale, so undo on a tab whose native history is gone left the caret wherever it was.
 * Diffing the two buffers gives the one place the user is looking for: the end of what changed.
 */
export function caretAfterChange(before: string, after: string): number | null {
	if (before === after) return null;
	const max = Math.min(before.length, after.length);
	let prefix = 0;
	while (prefix < max && before[prefix] === after[prefix]) prefix++;
	// suffix, never overlapping the common prefix in either buffer
	let suffix = 0;
	while (suffix < max - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
	// end of the changed run in the buffer being applied; a pure deletion lands where it was cut
	return after.length - suffix;
}
