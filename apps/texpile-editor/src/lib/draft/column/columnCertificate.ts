// The engine's answer for an edited column. Two questions, each asked of the unedited column first:
//   break: where the page builder ends this galley, with what followed it in the document (the break's
//     discarded run and the next column's galley) after it, at the goal and \maxdepth the page was built with
//   pack: where the output routine sets every item, packing the whole column list to its height
// Unedited, both must give back the page as the compile shipped it, or the list is not the page's and the
// edited answer would speak for something else.
import { boxBaselines, skeletonItems } from './columnSkeleton';
import type { ColumnList, ListItem } from './columnList';
import type { ColumnLayout } from './columnLayout';
import type { EditedList } from './editedList';
import type { SkeletonItem, SkeletonMode, SkeletonResult } from '$lib/workspace/fileSystem';

// every position the pack returns sums item widths the records carry to four decimals
const ROUNDING = 1e-4;

export type SplitSkeleton = (items: SkeletonItem[], targetPt: number, mode: SkeletonMode) => Promise<SkeletonResult>;

export type CertificateAnswer =
	| { layout: ColumnLayout }
	| { refused: string; detail?: Record<string, unknown> }
	/** the engine breaks the edited galley elsewhere: kA of its boxes and nA of its nodes stay */
	| { moved: { kA: number; boxes: number; nA: number } };

function boxCount(items: ListItem[]): number {
	return items.reduce((n, it) => n + (it.t === 'b' ? 1 : 0), 0);
}

function packTolerance(items: ListItem[]): number {
	return Math.max(2e-3, ROUNDING * items.length);
}

const calibrated = new WeakMap<ColumnList, Promise<string | null>>();

/** null when the engine gives back this column as the page has it, else why not */
export function calibrate(split: SplitSkeleton, list: ColumnList, tail: SkeletonItem[]): Promise<string | null> {
	let p = calibrated.get(list);
	if (!p) {
		p = (async () => {
			const pk = await split(skeletonItems(list.items), list.h, { pack: true });
			if (!pk.ok) return 'cal-pack:' + pk.error;
			const want = boxBaselines(list.items);
			const tol = packTolerance(list.items);
			if (pk.ys.length !== want.length) return 'cal-pack-count';
			for (let k = 0; k < want.length; k++) if (Math.abs(list.top + pk.ys[k] - want[k]) > tol) return 'cal-pack';
			const galley = list.items.slice(list.galley[0], list.galley[1]);
			const br = await split([...skeletonItems(galley), ...tail], list.goal, { maxDepth: list.maxDepth });
			if (!br.ok) return 'cal-break:' + br.error;
			return br.kA === boxCount(galley) ? null : 'cal-break';
		})();
		calibrated.set(list, p);
	}
	return p;
}

/**
 * `tail`: what followed the galley in the document, the break's discarded run then the next galley as it was
 * contributed. It is empty only where the document ends.
 */
export async function certifyColumn(
	split: SplitSkeleton,
	list: ColumnList,
	edited: EditedList,
	tail: SkeletonItem[]
): Promise<CertificateAnswer> {
	const cal = await calibrate(split, list, tail);
	if (cal) return { refused: cal };
	const galley = edited.items.slice(edited.galley[0], edited.galley[1]);
	const boxes = boxCount(galley);
	const br = await split([...skeletonItems(galley), ...tail], list.goal, { maxDepth: list.maxDepth });
	if (!br.ok) return { refused: 'break:' + br.error };
	if (br.kA !== boxes) return { moved: { kA: br.kA, boxes, nA: br.nA } };
	const pk = await split(skeletonItems(edited.items), list.h, { pack: true });
	if (!pk.ok) return { refused: 'pack:' + pk.error };
	if (pk.iy.length !== edited.items.length) return { refused: 'pack-count', detail: { nodes: pk.iy.length, items: edited.items.length } };
	const top = pk.iy.map((y) => list.top + y);
	const w = edited.items.map((it, k) => (it.t === 'g' || it.t === 'k' ? (pk.iy[k + 1] ?? pk.end) - pk.iy[k] : 0));
	return { layout: { items: edited.items, top, w, bandFrom: edited.bandFrom, bandLen: edited.bandLen } };
}
