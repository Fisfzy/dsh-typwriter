// a container's children joined on the file's own gaps
import type { Node } from 'prosemirror-model';
import type { Ctx } from './types';
import { originsOf, type BlockOrigin } from '$lib/editor/visual/parseOrigins';
import type { BlockAssemblyOptions, PartsOptions } from './blockAssembly';
import { follows, inCell, optionChecks, type Splice } from './blockAssemblyUtils';

export function createVerbatimParts(options: BlockAssemblyOptions, leafSplice: Splice, segmentSplice: Splice, frameSplice: Splice) {
	const { joinedAround, ownBytes } = optionChecks(options);

	/**
	 * How many children starting at `i` may be emitted verbatim: 1 for a plain block the parse
	 * still knows; the whole construct for a multi-block source unit (one itemize is N list
	 * nodes), but only when EVERY member is present, in pristine order and unchanged, so a
	 * deleted/edited item can never be resurrected. 0 means regenerate.
	 */
	function verbatimRun(origins: (BlockOrigin | null)[], i: number): number {
		const o = origins[i];
		if (!o || !o.parse.verbatim || o.text === undefined) return 0;
		if (o.size === 1) return ownBytes(o) ? 1 : 0;
		if (o.member !== 0 || i + o.size > origins.length) return 0;
		for (let k = 1; k < o.size; k++) {
			const m = origins[i + k];
			if (!m || m.parse !== o.parse || m.index !== o.index + k || m.member !== k) return 0;
		}
		return o.size;
	}

	/**
	 * A container's children as the dialect rendered them, with every child the parse still knows
	 * written out as its bytes instead: the part's own leading and trailing whitespace is kept
	 * around the bytes, so the dialect's separation between blocks stays what it was. Contiguous
	 * pristine children re-join on the bytes the file had between them.
	 */
	function verbatimParts(parent: Node, parts: string[], opts: PartsOptions = {}): string[] {
		const n = parent.childCount;
		if (n === 0 || parts.length !== n) return parts;
		const { origins, was } = originsOf(parent);
		if (!origins.some(Boolean) && !was.some(Boolean)) return parts;
		const out = parts.slice();
		function cellCtx(i: number): Ctx {
			return { parent, index: i, isLastChild: i === n - 1, inTableCell: inCell(parent) };
		}
		// the part the last verbatim run went into, the trailing whitespace it ends on, and its origin
		let joinInto = -1;
		let joinTrail = '';
		let prev: BlockOrigin | null = null;
		let i = 0;
		while (i < n) {
			const found = opts.keep?.(i) ? 0 : verbatimRun(origins, i);
			const run = found > 0 && joinedAround(parent, i, i + found) ? 0 : found;
			if (run === 0) {
				// a changed container child keeps its frame the same way
				const spliced =
					!opts.keep?.(i) && was[i] && !joinedAround(parent, i, i + 1) && ownBytes(was[i]!)
						? (frameSplice(parent.child(i), was[i]!, cellCtx(i)) ??
							leafSplice(parent.child(i), was[i]!, cellCtx(i)) ??
							segmentSplice(parent.child(i), was[i]!, cellCtx(i)))
						: null;
				if (spliced) {
					out[i] = /^[ \t\r\n]*/.exec(parts[i])![0] + spliced.text + /[ \t\r\n]*$/.exec(parts[i])![0];
				}
				if (parts[i] !== '') prev = null;
				i++;
				continue;
			}
			const origin = origins[i]!;
			const node = parent.child(i);
			const bytes = options.shadowChunk ? options.shadowChunk(node, origin.text!) : origin.text!;
			const lead = /^[ \t\r\n]*/.exec(parts[i])![0];
			const trail = /[ \t\r\n]*$/.exec(parts[i + run - 1])![0];
			if (opts.join !== false && prev && joinInto >= 0 && follows(prev, origin) && origin.pre != null) {
				out[joinInto] = out[joinInto].slice(0, out[joinInto].length - joinTrail.length) + origin.pre + bytes + trail;
				for (let k = 0; k < run; k++) out[i + k] = '';
			} else {
				out[i] = lead + bytes + trail;
				for (let k = 1; k < run; k++) out[i + k] = '';
				joinInto = i;
			}
			joinTrail = trail;
			prev = origins[i + run - 1];
			i += run;
		}
		return out;
	}

	return { verbatimRun, verbatimParts };
}
