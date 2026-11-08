// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { activeSuggestions, noteTypedSide } from '$lib/comments/activeSuggestions.svelte';
import type { CommentThread } from '$lib/comments/log';

let disk: Record<string, string> = {};
vi.mock('$lib/workspace/fileSystem', () => ({
	readTextFile: async (path: string) => {
		const hit = Object.entries(disk).find(([k]) => path.replace(/\\/g, '/').endsWith(k));
		if (!hit) throw new Error(`ENOENT ${path}`);
		return hit[1];
	},
	writeTextFile: async (_path: string, text: string) => {
		disk['.texpile/comments.jsonl'] = text;
	},
	joinPath: (a: string, b: string) => `${a}/${b}`
}));
vi.mock('$lib/workspace/texpileDir', () => ({
	texpilePath: (root: string, name: string) => `${root}/.texpile/${name}`,
	ensureTexpileIgnore: async () => {}
}));
let who = 'me';
vi.mock('$lib/comments/author', () => ({ resolveAuthor: async () => who, forgetAuthor: () => {} }));

const { CommentsController } = await import('$lib/workspace/commentsController.svelte');

const ROOT = '/w';
const FILE = `${ROOT}/main.tex`;
const SESSIONS = Number(process.env.SUGGEST_SESSIONS ?? 12);
const BASES = [
	'We prove the estimator is both reliable and efficient for smooth solutions.\n\nAway from a shock a coarse grid resolves it,\nand near one only a fine grid does.\n\nThe adaptive scheme wins.',
	'On each patch we form the residual $R_j^n$ by inserting the \\emph{reconstructed} solution.\n\nThe estimator is the cell size times the norm of that residual.',
	'the cat sat on the mat, and the dog sat on the log;\nnothing else happened.\n\nthe end'
];
const WORDS = ['sharp', 'grid', 'mesh', 'very', 'the', 'and', 'cell', 'fine', 'one', 'a', 'cat', '.', ',', '$x$', '\\emph{y}'];

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
const tick = () => new Promise((r) => setTimeout(r, 0));

type Mark = { id: string; from: number; to: number; restore: string };

function rejectAll(text: string, marks: Mark[]): string {
	let out = text;
	let shift = 0;
	for (const s of marks) {
		out = out.slice(0, s.from + shift) + s.restore + out.slice(s.to + shift);
		shift += s.restore.length - (s.to - s.from);
	}
	return out;
}

it('random sessions never lose text through suggestions', async () => {
	const failures: string[] = [];
	for (let seed = 1; seed <= SESSIONS && failures.length < 2; seed++) {
		disk = {};
		activeSuggestions.current = [];
		const rnd = prng(seed);
		const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
		let text = BASES[seed % BASES.length];
		let base = text;
		let mode: 'editing' | 'suggesting' = 'suggesting';
		let rejecting = false;
		const trace: string[] = [];
		const make = () =>
			new CommentsController({
				root: () => ROOT,
				preferredAuthor: () => who,
				openFileAt: () => {},
				activeText: () => text,
				mode: () => mode,
				applyEdit: async (e) => {
					if (!rejecting) throw new Error(`edited the text on its own: ${JSON.stringify(e)}`);
					text = text.slice(0, e.from) + e.insert + text.slice(e.to);
					return true;
				},
				saveNow: () => {}
			});
		let ctl = make();
		await ctl.load(ROOT);
		ctl.reanchor(FILE, text);
		const marks = (): Mark[] => activeSuggestions.current.map(({ id, from, to, restore }) => ({ id, from, to, restore }));
		const open = (): CommentThread[] => ctl.threads.filter((t) => t.restore !== undefined && !t.resolved);
		const change = (next: string) => {
			text = next;
			ctl.suggestions.textChanged(FILE, text);
		};
		let failed = false;
		const fail = (why: string) => {
			failed = true;
			failures.push(
				`seed ${seed}: ${why}\n trace:\n  ${trace.slice(-12).join('\n  ')}\n text: ${JSON.stringify(text)}\n base: ${JSON.stringify(base)}\n marks: ${JSON.stringify(marks())}`
			);
		};

		let undo: string | null = null;
		for (let step = 0; step < 18 && !failed; step++) {
			who = rnd() < 0.85 ? 'me' : 'mei';
			const roll = rnd();
			const edges = [0, ...[...text.matchAll(/\s+/g)].flatMap((m) => [m.index!, m.index! + m[0].length]), text.length];
			const at = rnd() < 0.7 ? pick(edges) : Math.floor(rnd() * (text.length + 1));
			try {
				if (roll < 0.42) {
					const over = rnd() < 0.35 ? Math.min(text.length - at, Math.floor(rnd() * 20)) : 0;
					const phrase =
						(rnd() < 0.3 ? ' ' : '') +
						Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(WORDS)).join(' ') +
						(rnd() < 0.3 ? ' ' : '');
					const typed = rnd() < 0.1 ? '\n\n' + phrase : phrase;
					undo = text;
					const spot = marks().filter((m) => m.restore && m.from === at);
					if (spot.length && !over && rnd() < 0.6) {
						const side = rnd() < 0.5 ? 'before' : 'after';
						for (const m of spot) noteTypedSide(m.id, side);
						trace.push(`caret ${side} the old words at ${at}`);
					}
					trace.push(`${who} types ${JSON.stringify(typed)} at ${at}${over ? ` over ${JSON.stringify(text.slice(at, at + over))}` : ''}`);
					const pace = rnd();
					for (let i = 0; i < typed.length; i++) {
						change(text.slice(0, at + i) + typed[i] + text.slice(at + i + (i === 0 ? over : 0)));
						if (pace < 0.6) await tick();
						if (pace < 0.15 && /\s/.test(typed[i])) await ctl.suggestions.settle();
					}
				} else if (roll < 0.52) {
					const paste = rnd() < 0.5;
					const len = Math.min(at, 1 + Math.floor(rnd() * (paste ? 25 : 12)));
					const insert = paste ? `${pick(WORDS)} ${pick(WORDS)}` : '';
					undo = text;
					trace.push(
						`${who} ${paste ? 'pastes over' : 'backspaces'} ${JSON.stringify(text.slice(at - len, at))}${paste ? ` with ${JSON.stringify(insert)}` : ''}`
					);
					if (paste) change(text.slice(0, at - len) + insert + text.slice(at));
					else
						for (let i = 0; i < len; i++) {
							change(text.slice(0, at - i - 1) + text.slice(at - i));
							if (rnd() < 0.5) await tick();
						}
				} else if (roll < 0.58 && undo !== null) {
					trace.push('undo');
					change(undo);
					undo = null;
				} else if (roll < 0.66) {
					await ctl.suggestions.settle();
					const ms = marks();
					const q = Math.min(text.length, at + Math.floor(rnd() * 6));
					if (!ms.every((m) => q < m.from - 2 || at > m.to + 2)) continue;
					const insert = rnd() < 0.5 ? pick(WORDS) : '';
					const shift = ms.filter((m) => m.to <= at).reduce((n, m) => n + (m.to - m.from) - m.restore.length, 0);
					base = base.slice(0, at - shift) + insert + base.slice(q - shift);
					trace.push(`editing ${JSON.stringify(text.slice(at, q))} -> ${JSON.stringify(insert)}`);
					mode = 'editing';
					change(text.slice(0, at) + insert + text.slice(q));
					await ctl.suggestions.settle();
					mode = 'suggesting';
					undo = null;
				} else if (roll < 0.74) {
					await ctl.suggestions.settle();
					await ctl.suggestions.beforeSave('main.tex', text);
					const before = JSON.stringify(marks());
					ctl = make();
					await ctl.load(ROOT);
					ctl.reanchor(FILE, text);
					trace.push('save and reopen');
					if (ctl.orphaned.size) fail(`lost on reopen: ${[...ctl.orphaned].join(', ')}`);
					else if (JSON.stringify(marks()) !== before) fail(`placed differently after reopen, was ${before}`);
					undo = null;
				} else {
					await ctl.suggestions.settle();
					const t = open().length ? pick(open()) : null;
					if (!t) continue;
					const was = text;
					if (rnd() < 0.6) {
						const m = marks().find((x) => x.id === t.id);
						if (!m) {
							fail(`open suggestion ${t.id} is not placed`);
							break;
						}
						trace.push(`reject ${JSON.stringify(was.slice(m.from, m.to))} -> ${JSON.stringify(m.restore)}`);
						rejecting = true;
						const ok = await ctl.suggestions.reject(t);
						rejecting = false;
						if (!ok) fail('Reject refused a placed suggestion');
						else if (text !== was.slice(0, m.from) + m.restore + was.slice(m.to)) fail('Reject changed more than its own words');
					} else {
						base = rejectAll(
							text,
							marks().filter((x) => x.id !== t.id)
						);
						trace.push(`accept ${JSON.stringify(t.anchor.quote)}`);
						await ctl.suggestions.accept(t);
						if (text !== was) fail('Accept changed the text');
					}
					undo = null;
				}
			} catch (e) {
				fail(`threw: ${String((e as Error).stack ?? e).slice(0, 300)}`);
				break;
			}
			if (failed) break;
			await ctl.suggestions.settle();
			const ms = marks();
			if (ms.some((m, i) => m.from < 0 || m.to > text.length || m.to < m.from || (i > 0 && m.from < ms[i - 1].to))) fail('badly placed');
			else if (rejectAll(text, ms) !== base) fail(`rejecting everything would give ${JSON.stringify(rejectAll(text, ms))}`);
		}
		if (failed) continue;
		await ctl.suggestions.settle();
		for (const t of open().sort(() => rnd() - 0.5)) {
			rejecting = true;
			if (!(await ctl.suggestions.reject(t))) fail('the last Reject refused');
			rejecting = false;
		}
		if (!failed && text !== base) fail(`rejecting everything gave ${JSON.stringify(text)}`);
	}
	expect(failures).toEqual([]);
}, 300_000);
