// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { activeSuggestions } from '$lib/comments/activeSuggestions.svelte';

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
const FILE = `${ROOT}/notes.txt`;
const RUNS = Number(process.env.SUGGEST_FUZZ_RUNS ?? 20);
const PIECES = [
	...'abex',
	'the',
	'foo',
	'Bar',
	'42',
	'3.14',
	' ',
	' ',
	' ',
	'  ',
	'\t',
	'\n',
	'\n\n',
	...'{}();=#*_$\\"\',.-',
	'->',
	'中文',
	'方法',
	'😀',
	'é',
	'ß'
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

function randomText(rnd: () => number, n: number) {
	let s = '';
	while (s.length < n) s += PIECES[Math.floor(rnd() * PIECES.length)];
	return s;
}

const paragraphs = (s: string) =>
	s
		.split(/\n[ \t\r]*\n\s*/)
		.map((p) => p.replace(/\s+/g, ''))
		.filter(Boolean)
		.join('\n\n');

async function session(run: number, rewraps: boolean): Promise<{ original: string; text: string; refused: number; log: string[] }> {
	disk = {};
	activeSuggestions.current = [];
	const rnd = prng(run * 7717);
	const original = randomText(rnd, 60 + Math.floor(rnd() * 300));
	let text = original;
	const make = () =>
		new CommentsController({
			root: () => ROOT,
			preferredAuthor: () => who,
			openFileAt: () => {},
			activeText: () => text,
			mode: () => 'suggesting',
			rewraps: () => rewraps,
			applyEdit: async (e) => {
				text = text.slice(0, e.from) + e.insert + text.slice(e.to);
				return true;
			},
			saveNow: () => {}
		});
	let ctl = make();
	await ctl.load(ROOT);
	ctl.reanchor(FILE, text);
	const log: string[] = [];
	const edits = 3 + Math.floor(rnd() * 25);
	for (let i = 0; i < edits; i++) {
		who = rnd() < 0.8 ? 'me' : 'mei';
		const from = Math.floor(rnd() * (text.length + 1));
		const to = rnd() < 0.3 ? from : Math.min(text.length, from + Math.floor(rnd() * 15));
		const insert = rnd() < 0.25 ? '' : randomText(rnd, 1 + Math.floor(rnd() * 10));
		if (/[\uDC00-\uDFFF]/.test(text[from] ?? '') || /[\uDC00-\uDFFF]/.test(text[to] ?? '')) continue;
		log.push(`[${from},${to}) ${JSON.stringify(text.slice(from, to))} -> ${JSON.stringify(insert)}`);
		if (rnd() < 0.5) {
			if (to > from) {
				text = text.slice(0, from) + text.slice(to);
				ctl.suggestions.textChanged(FILE, text);
			}
			let at = from;
			for (const c of insert) {
				text = text.slice(0, at) + c + text.slice(at);
				at += c.length;
				ctl.suggestions.textChanged(FILE, text);
				if (rnd() < 0.7) await new Promise((r) => setTimeout(r, 0));
			}
		} else {
			text = text.slice(0, from) + insert + text.slice(to);
			ctl.suggestions.textChanged(FILE, text);
		}
		if (rnd() < 0.4) await ctl.suggestions.settle();
		if (rnd() < 0.15) {
			await ctl.suggestions.beforeSave('notes.txt', text);
			ctl = make();
			await ctl.load(ROOT);
			ctl.reanchor(FILE, text);
			log.push('save and reopen');
		}
	}
	await ctl.suggestions.settle();
	let refused = 0;
	for (const t of ctl.threads.filter((x) => x.restore !== undefined && !x.resolved).sort(() => rnd() - 0.5)) {
		if (!(await ctl.suggestions.reject(t))) refused++;
	}
	return { original, text, refused, log };
}

describe('suggestions through the log', () => {
	beforeEach(() => {
		disk = {};
		activeSuggestions.current = [];
	});

	it('gives back a file exactly after every suggestion typed in the source editor is rejected', async () => {
		const failures: string[] = [];
		for (let run = 1; run <= RUNS && failures.length < 2; run++) {
			const r = await session(run, false);
			if (r.refused || r.text !== r.original)
				failures.push(
					`run ${run}: ${r.refused} refused\n original: ${JSON.stringify(r.original)}\n rejected: ${JSON.stringify(r.text)}\n edits: ${r.log.join(' | ')}`
				);
		}
		expect(failures).toEqual([]);
	}, 600_000);

	it('keeps every word and paragraph when the editor rewraps lines', async () => {
		const failures: string[] = [];
		for (let run = 1; run <= Math.ceil(RUNS / 2) && failures.length < 2; run++) {
			const r = await session(run + 100_000, true);
			if (r.refused || paragraphs(r.text) !== paragraphs(r.original))
				failures.push(
					`run ${run}: ${r.refused} refused\n original: ${JSON.stringify(r.original)}\n rejected: ${JSON.stringify(r.text)}\n edits: ${r.log.join(' | ')}`
				);
		}
		expect(failures).toEqual([]);
	}, 600_000);
});
