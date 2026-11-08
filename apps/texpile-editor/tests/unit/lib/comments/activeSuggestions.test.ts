import { it, expect } from 'vitest';
import { editMode, mapSuggestionEdges } from '$lib/comments/activeSuggestions.svelte';
import { compareSuggestions, type EditMode, type PlacedSuggestion, type TypingSide } from '$lib/comments/suggestCompare';

const T = 'It is sharp and cheap for smooth data.';
const at = T.indexOf('sharp');
const end = at + 'sharp and cheap'.length;

const cases: [EditMode, string, string, TypingSide | undefined, number, number, number][] = [];
for (const mode of ['editing', 'suggesting'] as EditMode[])
	for (const by of ['me', 'mei'])
		for (const [where, from, to, typedAt] of [
			['before a Replace', at, end, at],
			['after a Replace', at, end, end],
			['at a Delete', at, at, at]
		] as [string, number, number, number][])
			for (const side of where === 'after a Replace' ? [undefined] : ([undefined, 'before', 'after'] as const))
				cases.push([mode, by, where, side, from, to, typedAt]);

it.each(cases)('%s, a suggestion by %s, typing %s, caret %s its old words', (mode, by, _where, side, from, to, typedAt) => {
	const s: PlacedSuggestion = { id: 's1', from, to, restore: 'reliable', author: by };
	const after = T.slice(0, typedAt) + 'xy' + T.slice(typedAt);
	let n = 0;
	const settled = compareSuggestions({
		before: T,
		after,
		pending: [s],
		mode,
		author: 'me',
		sides: side ? { s1: side } : undefined,
		newId: () => `n${++n}`
	}).placed.filter((p) => !(p.from === typedAt && p.to === typedAt + 2 && !p.restore && p.author === 'me'));

	editMode.current = mode;
	const insert = (pos: number, assoc: -1 | 1) => (pos < typedAt || (pos === typedAt && assoc < 0) ? pos : pos + 2);
	const drawn = mapSuggestionEdges({ ...s, mine: by === 'me' }, insert, side);
	expect(drawn.map((d) => [d.from, d.to, d.restore])).toEqual(settled.map((p) => [p.from, p.to, p.restore]));
});
