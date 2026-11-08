import { columnList, type ColumnList } from './columnList';
import type { PageRecord } from '../geometry/geometry.types';

// one read per page's records: the store replaces the array whenever the page changes, so the array itself
// keys the cache, and the engine's calibration of a column rides on the list object this returns
const cache = new WeakMap<PageRecord[], Map<number, ColumnList | { refused: string }>>();

export function columnListOf(recs: PageRecord[], fire: number): ColumnList | { refused: string } {
	let byFire = cache.get(recs);
	if (!byFire) {
		byFire = new Map();
		cache.set(recs, byFire);
	}
	let list = byFire.get(fire);
	if (!list) {
		list = columnList(recs, fire);
		byFire.set(fire, list);
	}
	return list;
}
