// What followed a column's galley in the document, as the page builder saw it: the run it discarded at the
// break, then the next column's galley as it was contributed. The break is only the page builder's with this
// after it: a later break that costs less wins, and only the material past the break says whether one exists.
import { pageColumns } from '../geometry/pageColumns';
import { columnListOf } from './columnListOf';
import { contributedGalley, skeletonItems } from './columnSkeleton';
import type { ListItem } from './columnList';
import type { PageRecord } from '../geometry/geometry.types';
import type { SeamEntry } from '../patch/seam.types';
import type { SkeletonItem } from '$lib/workspace/fileSystem';

export type TailDeps = { pageRecords: (n: number) => PageRecord[]; pageCount: () => number; seams: () => SeamEntry[] };

/** the next column in reading order: this page's next, else the next page's first */
export function nextColumn(deps: TailDeps, page: number, fire: number): { page: number; fire: number } | null {
	const cols = pageColumns(deps.pageRecords(page));
	const at = cols.findIndex((c) => c.i === fire);
	if (at < 0) return null;
	if (at + 1 < cols.length) return cols[at + 1].i === undefined ? null : { page, fire: cols[at + 1].i! };
	if (page + 1 > deps.pageCount()) return null;
	const first = pageColumns(deps.pageRecords(page + 1))[0];
	return first?.i === undefined ? null : { page: page + 1, fire: first.i };
}

/**
 * the run the page builder discarded at this column's break, as list items with no records of their own; null
 * when the compile did not capture it, or captured something it could not write down
 */
export function seamList(deps: TailDeps, page: number, fire: number): ListItem[] | null {
	const seam = deps.seams().find((s) => s.page === page && s.fire === fire);
	if (!seam) return null;
	const items: ListItem[] = [];
	for (let i = 0; i < seam.run.length; i++) {
		const r = seam.run[i];
		if (r.x) return null;
		// the engine saves the break's own penalty neutralized to 10000; the break's true value is \outputpenalty
		if (r.p !== undefined) items.push({ t: 'p', p: i === 0 && r.p === 10000 && seam.pen !== 10000 ? seam.pen : r.p, y: 0, i: -1 });
		else if (r.k !== undefined) items.push({ t: 'k', w: r.k, y: 0, i: -1 });
		else {
			const w = r.w ?? 0;
			items.push({ t: 'g', w, nw: w, st: r.st ?? 0, sto: r.sto ?? 0, sh: r.sh ?? 0, sho: r.sho ?? 0, gk: 0, y: 0, i: -1 });
		}
	}
	return items;
}

export function columnTail(deps: TailDeps, page: number, fire: number): SkeletonItem[] | { refused: string } {
	const next = nextColumn(deps, page, fire);
	const seam = seamList(deps, page, fire);
	if (!seam) return next ? { refused: 'no-seam' } : [];
	if (!next) return skeletonItems(seam);
	const list = columnListOf(deps.pageRecords(next.page), next.fire);
	if ('refused' in list) return { refused: 'next-' + list.refused };
	return skeletonItems([...seam, ...contributedGalley(list)]);
}
