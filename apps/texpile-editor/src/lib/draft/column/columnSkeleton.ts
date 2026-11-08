import { TOPSKIP, type ColumnList, type ListItem } from './columnList';
import type { SkeletonItem } from '$lib/workspace/fileSystem';

/** list items as the engine rebuilds them: natural glue, and the \topskip glue left for the engine to set */
export function skeletonItems(items: ListItem[]): SkeletonItem[] {
	return items.map((it): SkeletonItem => {
		switch (it.t) {
			case 'b':
				return { t: 'b', h: it.h, d: it.d };
			case 'g':
				return it.gk === TOPSKIP ? { t: 't' } : { t: 'g', w: it.nw, st: it.st, sto: it.sto, sh: it.sh, sho: it.sho };
			case 'k':
				return { t: 'k', w: it.w };
			case 'p':
				return { t: 'p', p: it.p };
			case 'x':
				return { t: 'x' };
		}
	});
}

/** the galley as the page builder was handed it: without the \topskip glue it adds when a page starts */
export function contributedGalley(list: ColumnList): ListItem[] {
	return list.items.slice(list.galley[0], list.galley[1]).filter((it) => !(it.t === 'g' && it.gk === TOPSKIP));
}

/** baselines of the boxes among `items`, in order */
export function boxBaselines(items: ListItem[]): number[] {
	return items.filter((it) => it.t === 'b').map((it) => it.y);
}
