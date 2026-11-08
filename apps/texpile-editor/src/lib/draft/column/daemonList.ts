/* eslint-disable @typescript-eslint/no-explicit-any -- daemon records are schemaless engine JSON */
// The daemon's typeset of one block as a vertical list, from its first line box to its last: what the block
// itself puts on the page. Spacing the daemon adds before the first line or after the last (a list's \topsep,
// the \par) is its own context, not the block's. `end` is where the last line's records stop.
import type { ListItem } from './columnList';

export function daemonList(recs: any[]): { items: ListItem[]; end: number } | null {
	const items: ListItem[] = [];
	let depth = 0;
	for (let j = 0; j < recs.length; j++) {
		const r = recs[j];
		if (r.t === 'vboxend') {
			depth--;
			continue;
		}
		if (depth > 0) {
			if (r.t === 'vbox') depth++;
			continue;
		}
		switch (r.t) {
			case 'line':
				items.push({ t: 'b', h: r.h, d: r.d, y: r.y, i: j, line: true });
				break;
			case 'vbox':
				depth++;
				if (!r.inl) items.push({ t: 'b', h: r.h, d: r.d, y: r.y, i: j, line: false });
				break;
			case 'rule':
				if (r.v) items.push({ t: 'b', h: r.h, d: r.d, y: r.y, i: j, line: false });
				break;
			case 'vg':
				items.push({ t: 'g', w: r.w, nw: r.nw, st: r.st, sto: r.sto, sh: r.sh, sho: r.sho, gk: r.gk, y: r.y, i: j });
				break;
			case 'vk':
				items.push({ t: 'k', w: r.w, y: r.y, i: j });
				break;
			case 'pen':
				items.push({ t: 'p', p: r.p, y: r.y, i: j });
				break;
			case 'vx':
				items.push({ t: 'x', y: r.y, i: j });
				break;
			case 'note':
				// an insert: its material leaves the list for \box\footins, which a column list does not follow
				return null;
		}
	}
	function isLine(it: ListItem) {
		return it.t === 'b' && it.line;
	}
	const first = items.findIndex(isLine);
	const last = items.findLastIndex(isLine);
	if (first < 0) return null;
	return { items: items.slice(first, last + 1), end: items[last + 1]?.i ?? recs.length };
}
