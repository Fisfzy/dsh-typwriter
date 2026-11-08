import { describe, it, expect } from 'vitest';
import { compareSuggestions, type EditMode, type PlacedSuggestion, type TypingSide } from '$lib/comments/suggestCompare';
import { carryGestures, type TextSpan } from '$lib/comments/editGestures';

function prng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const BASES = [
	'We prove the estimator is both reliable and efficient for smooth solutions.\nAway from a shock a coarse grid resolves it.',
	'On each patch we form the residual $R_j^n$ by inserting the reconstructed solution into the \\emph{weak} form.',
	'the cat sat on the mat, and the dog sat on the log; nothing else happened',
	'我们证明了这个方法是可靠的。 It is sharp and cheap.'
];
const WORDS = [
	'the',
	'a',
	'coarse',
	'grid',
	'mesh',
	'sharp',
	'reliable',
	'and',
	'one',
	'cell',
	'very',
	'big',
	'.',
	',',
	'$x$',
	'\\emph{y}',
	'方法',
	'cat'
];

type Edit = { from: number; to: number; insert: string };

function randomEdit(text: string, rnd: () => number): Edit {
	let from = Math.floor(rnd() * (text.length + 1));
	let to = Math.min(text.length, from + Math.floor(rnd() * (rnd() < 0.3 ? 30 : 10)));
	if (rnd() < 0.6) {
		while (from > 0 && /\S/.test(text[from - 1])) from--;
		while (to < text.length && /\S/.test(text[to])) to++;
	}
	if (rnd() < 0.25) to = from;
	const n = Math.floor(rnd() * 4);
	const words = Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]);
	const insert = rnd() < 0.2 ? '' : words.join(rnd() < 0.8 ? ' ' : '\n') + (n && rnd() < 0.5 ? ' ' : '');
	return { from, to, insert };
}

const apply = (text: string, e: Edit) => text.slice(0, e.from) + e.insert + text.slice(e.to);

function randomSides(pending: PlacedSuggestion[], rnd: () => number): Record<string, TypingSide> {
	return Object.fromEntries(pending.filter((s) => s.restore && rnd() < 0.5).map((s) => [s.id, rnd() < 0.5 ? 'before' : 'after']));
}

function rejectAll(text: string, placed: PlacedSuggestion[]): string {
	let out = text;
	let shift = 0;
	for (const s of placed) {
		out = out.slice(0, s.from + shift) + s.restore + out.slice(s.to + shift);
		shift += s.restore.length - (s.to - s.from);
	}
	return out;
}

const words = (s: string) =>
	s
		.split(/\n[ \t\r]*\n\s*/)
		.map((p) => p.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n\n');

function checkShape(text: string, placed: PlacedSuggestion[]): string | null {
	let prev = -1;
	const ids = new Set<string>();
	for (const s of placed) {
		if (s.from < 0 || s.to > text.length || s.to < s.from) return `out of bounds ${JSON.stringify(s)} in ${text.length}`;
		if (s.from < prev) return `overlap at ${s.id}`;
		if (s.from === s.to && !s.restore) return `empty suggestion ${s.id}`;
		if (ids.has(s.id)) return `duplicate id ${s.id}`;
		ids.add(s.id);
		prev = s.to;
	}
	return null;
}

describe('suggestions under random edits', () => {
	it('rejecting everything suggested gives back the original text', () => {
		const failures: string[] = [];
		for (let seed = 1; seed <= 600 && failures.length < 3; seed++) {
			const rnd = prng(seed);
			const base = BASES[seed % BASES.length];
			let text = base;
			let pending: PlacedSuggestion[] = [];
			let n = 0;
			for (let step = 0; step < 14; step++) {
				const burst = rnd() < 0.3 ? 2 + Math.floor(rnd() * 2) : 1;
				let after = text;
				let gestures: TextSpan[] = [];
				for (let b = 0; b < burst; b++) {
					const next = apply(after, randomEdit(after, rnd));
					gestures = carryGestures(gestures, after, next);
					after = next;
				}
				const author = rnd() < 0.7 ? 'me' : 'mei';
				const sides = randomSides(pending, rnd);
				const r = compareSuggestions({ before: text, after, pending, mode: 'suggesting', author, newId: () => `s${++n}`, gestures, sides });
				const shape = checkShape(after, r.placed);
				const back = rejectAll(after, r.placed);
				if (shape || words(back) !== words(base)) {
					failures.push(
						`seed ${seed} step ${step}: ${shape ?? 'restore mismatch'} by ${author}\n before: ${JSON.stringify(text)}\n after:  ${JSON.stringify(after)}\n gestures: ${JSON.stringify(gestures)}\n sides: ${JSON.stringify(sides)}\n pending: ${JSON.stringify(pending)}\n placed: ${JSON.stringify(r.placed)}\n rejected: ${JSON.stringify(back)}`
					);
					break;
				}
				text = after;
				pending = r.placed;
			}
		}
		expect(failures).toEqual([]);
	});

	it('keeps suggestions well formed when Editing and Suggesting take turns', () => {
		const failures: string[] = [];
		for (let seed = 1; seed <= 400 && failures.length < 3; seed++) {
			const rnd = prng(seed * 7919);
			let text = BASES[seed % BASES.length];
			let pending: PlacedSuggestion[] = [];
			let n = 0;
			for (let step = 0; step < 14; step++) {
				const after = apply(text, randomEdit(text, rnd));
				const mode: EditMode = rnd() < 0.5 ? 'editing' : 'suggesting';
				const sides = randomSides(pending, rnd);
				const r = compareSuggestions({
					before: text,
					after,
					pending,
					mode,
					author: rnd() < 0.7 ? 'me' : 'mei',
					newId: () => `s${++n}`,
					sides
				});
				const shape = checkShape(after, r.placed);
				const unknown = r.changes.find((c) => (c.t === 'open' || c.t === 'revise') && !r.placed.some((s) => s.id === c.id));
				if (shape || unknown) {
					failures.push(
						`seed ${seed} step ${step} ${mode}: ${shape ?? `change for unplaced ${unknown!.id}`}\n before: ${JSON.stringify(text)}\n after: ${JSON.stringify(after)}\n pending: ${JSON.stringify(pending)}`
					);
					break;
				}
				text = after;
				pending = r.placed;
			}
		}
		expect(failures).toEqual([]);
	});
});
