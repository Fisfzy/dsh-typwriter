// @vitest-environment jsdom
// guests suggesting at random, checked against what the host recorded after every step
import { it, expect, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { disk } from './sessionDisk';

vi.mock('$lib/workspace/fileSystem', async () => {
	const { disk } = await import('./sessionDisk');
	return {
		readTextFile: async (path: string) => {
			const hit = Object.entries(disk).find(([k]) => path.replace(/\\/g, '/').endsWith(k));
			if (!hit) throw new Error(`ENOENT ${path}`);
			return hit[1];
		},
		writeTextFile: async (path: string, text: string) => {
			disk[path.replace(/\\/g, '/').replace(/^\/w\//, '')] = text;
		},
		joinPath: (a: string, b: string) => `${a}/${b}`
	};
});
vi.mock('$lib/workspace/texpileDir', () => ({
	texpilePath: (root: string, name: string) => `${root}/.texpile/${name}`,
	ensureTexpileIgnore: async () => {}
}));
vi.mock('$lib/comments/author', () => ({
	resolveAuthor: async (root: string | null, preferred: string) => preferred || (root === 'session' ? 'guest' : 'louis'),
	forgetAuthor: () => {}
}));

const { startSession, agree, rejectAllOn, acceptAllOn, openSuggestions, placedOn, tick, FILE } = await import('./sessionHarness');
type Session = Awaited<ReturnType<typeof startSession>>;
type Guest = import('./sessionHarness').Guest;

const SEEDS = (process.env.SESSION_FUZZ_SEEDS ?? '1-20').split('-').map(Number);
const STEPS = Number(process.env.SESSION_FUZZ_STEPS ?? 15);
const BASES = [
	'We prove the estimator is sharp for smooth solutions.\n',
	'Away from a shock a coarse grid resolves the flow, and near one only a fine grid does.\n\nThe adaptive scheme wins.\n',
	'the cat sat on the mat, and the dog sat on the log;\nnothing else happened.\n'
];
const WORDS = [
	'sharp',
	'shape',
	'blunt',
	'tight',
	'the',
	'then',
	'a',
	'an',
	'estimate',
	'moot',
	'grid',
	'grids',
	'crude',
	'one',
	'cat',
	'$h$',
	','
];

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

/** the keys a person presses, at their own caret, so a change arriving from someone else moves it the way it would */
function hands(view: EditorView, name: string, trace: string[]) {
	const log = (what: string) => trace.push(`${name} ${what}`);
	return {
		select(anchor: number, head = anchor) {
			view.dispatch({ selection: { anchor, head } });
		},
		key(ch: string) {
			const { from, to } = view.state.selection.main;
			log(`${from}-${to} ${JSON.stringify(ch)}`);
			view.dispatch({ changes: { from, to, insert: ch }, selection: { anchor: from + ch.length }, userEvent: 'input.type' });
		},
		backspace() {
			const { from, to } = view.state.selection.main;
			const at = from === to ? Math.max(0, from - 1) : from;
			if (at === to) return;
			log(`${at}-${to} ""`);
			view.dispatch({ changes: { from: at, to }, selection: { anchor: at }, userEvent: 'delete.backward' });
		}
	};
}

/** one random edit to a word, a key at a time; the first step only picks the word and puts the caret there */
function* randomEdit(g: Guest, rnd: () => number, trace: string[]): Generator<void> {
	const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
	const text = g.text();
	const words = [...text.matchAll(/\S+/g)];
	// every word deleted: all that is left is to type one
	const w = words.length ? pick(words) : Object.assign([''], { index: 0 });
	const from = w.index!;
	const to = from + w[0].length;
	const kind = words.length ? pick(['insert', 'delete', 'cut', 'replace'] as const) : 'insert';
	const word = pick(WORDS);
	const h = hands(g.editor.view, g.name, trace);
	trace.push(
		`${g.name} ${kind} ${JSON.stringify(w[0])}@${from}${kind === 'insert' || kind === 'replace' ? ` ${JSON.stringify(word)}` : ''}`
	);
	if (kind === 'insert') {
		h.select(from);
		yield;
		for (const ch of word + ' ') {
			h.key(ch);
			yield;
		}
	} else if (kind === 'replace') {
		h.select(from, to);
		yield;
		for (const ch of word) {
			h.key(ch);
			yield;
		}
	} else {
		const end = /[ \t]/.test(text[to] ?? '') ? to + 1 : to;
		if (kind === 'cut') {
			h.select(from, end);
			yield;
			h.backspace();
		} else {
			h.select(end);
			yield;
			for (let i = from; i < end; i++) {
				h.backspace();
				yield;
			}
		}
	}
}

/** several people's edits at once: whose key comes next, and whether the wire gets a turn, is up to the seed */
async function together(edits: Generator<void>[], rnd: () => number, trace: string[]): Promise<void> {
	for (const e of edits) e.next();
	let live = [...edits];
	while (live.length) {
		const e = live[Math.floor(rnd() * live.length)];
		if (e.next().done) live = live.filter((x) => x !== e);
		if (rnd() < 0.3) {
			trace.push('~');
			await tick();
		}
	}
}

type Ending = 'reject on the host' | 'reject on a guest' | 'accept on the host' | 'accept on a guest';

function endingOf(seed: number): Ending {
	if (seed % 5 === 0) return seed % 2 ? 'accept on the host' : 'accept on a guest';
	return seed % 2 ? 'reject on the host' : 'reject on a guest';
}

async function end(s: Session, base: string, ending: Ending, rnd: () => number): Promise<void> {
	const decider = ending.endsWith('host') ? s.host.ctl : s.guests[Math.floor(rnd() * s.guests.length)].ctl;
	if (ending.startsWith('accept')) {
		const suggested = s.host.text();
		await acceptAllOn(decider, s);
		await agree(s, suggested);
		expect(s.host.text()).toBe(suggested);
		expect(openSuggestions(s.host.ctl.threads)).toEqual([]);
		for (const g of s.guests) expect(placedOn(g.ctl)?.placed ?? [], g.name).toEqual([]);
		return;
	}
	await rejectAllOn(decider, s);
	await agree(s, base);
	expect(s.host.text()).toBe(base);
	for (const g of s.guests) expect(g.text(), g.name).toBe(base);
	expect(disk[FILE]).toBe(base);
}

async function runSeeds(guests: string[], play: (s: Session, rnd: () => number, trace: string[]) => Promise<void>) {
	const failures: string[] = [];
	for (let seed = SEEDS[0]; seed <= (SEEDS[1] ?? SEEDS[0]); seed++) {
		const rnd = prng(seed * 7919 + guests.length);
		const base = BASES[seed % BASES.length];
		const trace: string[] = [];
		const s = await startSession({ text: base });
		try {
			const joined = [];
			for (const name of guests) joined.push(await s.join(name));
			for (const g of joined) await g.mode('suggesting');
			await play(s, rnd, trace);
			trace.push(`end: ${endingOf(seed)}`);
			await end(s, base, endingOf(seed), rnd);
		} catch (e) {
			const { message, actual, expected } = e as { message: string; actual?: unknown; expected?: unknown };
			const got = actual === undefined ? '' : `\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`;
			failures.push(`seed ${seed}: ${message.split('\n')[0]}${got}\n  ${trace.join('\n  ')}`);
		} finally {
			s.close();
		}
	}
	expect(failures, failures.join('\n\n')).toEqual([]);
}

it('one guest suggesting at random: the host records every step, and deciding it all leaves the file as it should', async () => {
	await runSeeds(['mei'], async (s, rnd, trace) => {
		const base = s.host.text();
		for (let step = 0; step < STEPS; step++) {
			await together([randomEdit(s.guests[0], rnd, trace)], rnd, trace);
			await agree(s, base);
		}
	});
}, 900_000);

it('two guests suggesting at random at once: the host records every step, and deciding it all leaves the file as it should', async () => {
	await runSeeds(['mei', 'ada'], async (s, rnd, trace) => {
		const base = s.host.text();
		for (let step = 0; step < STEPS; step++) {
			await together(
				s.guests.map((g) => randomEdit(g, rnd, trace)),
				rnd,
				trace
			);
			await agree(s, base);
		}
	});
}, 900_000);
