import { describe, expect, it } from 'vitest';
import { patchedRecords, recordsAfterPatch } from '$lib/draft/patch/patchedRecords';
import type { Patch } from '$lib/draft/patch/patch.types';

const band = { top: 0, bottom: 0, colL: 0, colR: 0 };

describe('patchedRecords', () => {
	// by list order: a record belongs to the item it follows, whatever its y, so a subscript hanging into
	// the old block's rows is neither wiped with them nor left behind when its own line moves
	it('drops, moves and inserts by record index', () => {
		const recs = [
			{ t: 'pl', y: 10 },
			{ t: 'g', c: 1, y: 13 },
			{ t: 'pl', y: 20 },
			{ t: 'vg', y: 22, w: 3, nw: 3 },
			{ t: 'pl', y: 30 }
		];
		const patch: Patch = {
			splices: [{ from: 2, to: 3, recs: [{ t: 'pl', y: 21 } as never] }],
			moves: [
				{ from: 3, to: 4, dy: 1, w: 4, nw: 4 },
				{ from: 4, to: 5, dy: 2 }
			],
			band
		};
		expect(patchedRecords(recs, [patch])).toEqual([
			{ t: 'pl', y: 10 },
			{ t: 'g', c: 1, y: 13 },
			{ t: 'pl', y: 21 },
			{ t: 'vg', y: 23, w: 4, nw: 4 },
			{ t: 'pl', y: 32 }
		]);
	});

	// the daemon numbers its fonts itself: a glyph adopted into the page must name the page's font record
	it('renumbers the edited block onto the page fonts when adopted', () => {
		const recs = [
			{ t: 'g', c: 1, f: 1, y: 5 },
			{ t: 'font', id: 1, name: 'lmr', file: 'a.otf', size: 10 }
		];
		const patch: Patch = {
			splices: [
				{
					from: 0,
					to: 1,
					recs: [
						{ t: 'g', c: 2, f: 1, y: 5 },
						{ t: 'font', id: 1, name: 'lmb', file: 'b.otf', size: 10 }
					] as never[]
				}
			],
			moves: [],
			band
		};
		expect(recordsAfterPatch(recs, patch)).toEqual([
			{ t: 'g', c: 2, f: 2, y: 5 },
			{ t: 'font', id: 1, name: 'lmr', file: 'a.otf', size: 10 },
			{ t: 'font', id: 2, name: 'lmb', file: 'b.otf', size: 10 }
		]);
	});
});
