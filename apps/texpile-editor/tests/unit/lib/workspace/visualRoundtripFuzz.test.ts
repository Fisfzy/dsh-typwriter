import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import type { ParsedLatexFile } from '$lib/workspace/latexRoundtrip';
import { padTables } from '$lib/editor/visual/padTables';
import { printedLine, visibleLines, wordsOfLine } from '$lib/editor/visual/docShape';
import { FORMATS, pick, prng, randomEdit, typed, type Format } from './visualEditsFuzz';

const RUNS = Number(process.env.VISUAL_FUZZ_RUNS ?? 20);

function firstDiff(a: string[], b: string[], byWords: boolean): string {
	const aw = byWords ? a.map(wordsOfLine).join('') : '';
	const bw = byWords ? b.map(wordsOfLine).join('') : '';
	if (byWords) {
		let i = 0;
		while (i < aw.length && aw[i] === bw[i]) i++;
		return `  edited:   …${JSON.stringify(aw.slice(Math.max(0, i - 40), i + 40))}\n  reopened: …${JSON.stringify(bw.slice(Math.max(0, i - 40), i + 40))}`;
	}
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if (a[i] !== b[i]) {
			const x = a[i] ?? '';
			const y = b[i] ?? '';
			let k = 0;
			while (k < x.length && x[k] === y[k]) k++;
			const from = Math.max(0, k - 80);
			return `  edited:   ${JSON.stringify(x.slice(from, k + 80))}\n  reopened: ${JSON.stringify(y.slice(from, k + 80))}`;
		}
	}
	return '';
}

function textDiff(a: string, b: string): string {
	let s = 0;
	while (s < a.length && a[s] === b[s]) s++;
	let e = 0;
	while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
	// VISUAL_FUZZ_CONTEXT widens the window shown around the first difference
	const width = Number(process.env.VISUAL_FUZZ_CONTEXT ?? 300);
	const cut = (x: string) => JSON.stringify(x.slice(Math.max(0, s - 40), Math.min(x.length - e + 20, s + width)));
	return `  was:    ${cut(a)}\n  became: ${cut(b)}`;
}

type Failure = { kind: string; detail: string; shape?: string };

function shapeOf(a: string, b: string): string {
	let s = 0;
	while (s < a.length && a[s] === b[s]) s++;
	let e = 0;
	while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
	const fold = (x: string) =>
		x
			.slice(0, 60)
			.replace(/[A-Za-z]+/g, 'a')
			.replace(/[0-9]+/g, '0')
			.replace(/[^\p{ASCII}‹›«»⏎]+/gu, 'u');
	return `${fold(a.slice(s, a.length - e))} => ${fold(b.slice(s, b.length - e))}`;
}

function reopenFailure(f: Format, parsed: ParsedLatexFile, doc: PMNode): Failure | null {
	let saved: string;
	try {
		saved = f.serialize(parsed, doc);
	} catch (e) {
		return { kind: 'serializer throws', detail: String(e) };
	}
	const again = f.parse(saved);
	if (again.preamble !== parsed.preamble) return { kind: 'preamble changes', detail: textDiff(parsed.preamble, again.preamble) };
	const want = visibleLines(doc, f.name).map((l) => printedLine(l, f.name));
	const got = visibleLines(padTables(again.doc), f.name).map((l) => printedLine(l, f.name));
	const ww = want.map(wordsOfLine).join('');
	const gw = got.map(wordsOfLine).join('');
	if (ww !== gw) return { kind: 'words change on reopen', detail: firstDiff(want, got, true), shape: shapeOf(ww, gw) };
	if (want.join('\n') !== got.join('\n'))
		return {
			kind: 'structure or marks change on reopen',
			detail: firstDiff(want, got, false),
			shape: shapeOf(want.join('\n'), got.join('\n'))
		};
	return null;
}

function sourceEdit(text: string, rnd: () => number): string {
	const at = Math.floor(rnd() * (text.length + 1));
	const to = rnd() < 0.5 ? at : Math.min(text.length, at + Math.floor(rnd() * 12));
	const insert = rnd() < 0.3 ? pick(rnd, ['\n', '\n\n', ' ']) : typed(rnd);
	return text.slice(0, at) + insert + text.slice(to);
}

function chain(f: Format, source: string, seed: number, failures: Failure[]) {
	const rnd = prng(seed);
	let text = source;
	let typedInSource = false;
	for (let round = 0; round < 4; round++) {
		const parsed = f.parse(text);
		if (parsed.origins.defects.length > 0) {
			const shown = parsed.origins.defects.slice(0, 3).map((d) => `  ${d.kind} ${d.srcFrom}..${d.srcTo}: ${d.detail}`);
			failures.push({ kind: 'the map contradicts the bytes', detail: `${parsed.origins.defects.length} defects\n${shown.join('\n')}` });
			return;
		}
		const plain = f.serialize(parsed, parsed.doc);
		if (plain !== text) {
			failures.push({ kind: 'opening changes the file', detail: textDiff(text, plain) });
			return;
		}
		const opened = padTables(parsed.doc);
		const padded = f.serialize(parsed, opened);
		if (padded !== text) {
			failures.push({ kind: 'the first visual edit rewrites a table the editor padded', detail: textDiff(text, padded) });
			return;
		}
		const states = [EditorState.create({ doc: opened })];
		const labels: string[] = [];
		// VISUAL_FUZZ_STEPS raises the most edits a round makes, for a heavier session
		const steps = 1 + Math.floor(rnd() * Number(process.env.VISUAL_FUZZ_STEPS ?? 8));
		for (let i = 0; i < steps; i++) {
			const edit = randomEdit(states[states.length - 1], rnd);
			if (!edit) continue;
			states.push(states[states.length - 1].apply(edit.tr));
			labels.push(edit.label);
		}
		if (reopenFailure(f, parsed, states[states.length - 1].doc)) {
			for (let i = 1; i < states.length; i++) {
				const bad = reopenFailure(f, parsed, states[i].doc);
				if (!bad) continue;
				let saved: string;
				try {
					saved = textDiff(f.serialize(parsed, states[i - 1].doc), f.serialize(parsed, states[i].doc));
				} catch {
					saved = '';
				}
				const kind = typedInSource ? `${bad.kind} (after random source edits)` : bad.kind;
				failures.push({ kind, shape: bad.shape, detail: `  edit: ${labels[i - 1]}\n${bad.detail}\n  file:\n${saved}` });
				break;
			}
			return;
		}
		text = f.serialize(parsed, states[states.length - 1].doc);
		if (process.env.VISUAL_FUZZ_SOURCE !== '1') continue;
		const sourceEdits = Math.floor(rnd() * 3);
		for (let i = 0; i < sourceEdits; i++) text = sourceEdit(text, rnd);
		if (sourceEdits) typedInSource = true;
	}
}

describe('visual editor round trip', () => {
	for (const f of FORMATS) {
		it(`${f.name}: what is typed in the visual editor comes back when the file is opened again`, () => {
			const failures: Failure[] = [];
			const sources = f.files.map((p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
			if (!sources.length) return;
			const only = Number(process.env.VISUAL_FUZZ_ONLY ?? 0);
			for (let run = only || 1; run <= (only || RUNS); run++) {
				const source = sources[run % sources.length];
				const seen = failures.length;
				try {
					chain(f, source, run * 7919, failures);
				} catch (e) {
					failures.push({ kind: 'throws', detail: String((e as Error).stack ?? e).slice(0, 400) });
				}
				for (const x of failures.slice(seen)) x.detail = `  run ${run}: ${f.files[run % sources.length]}\n${x.detail}`;
			}
			const groups = new Map<string, Failure[]>();
			for (const x of failures) {
				const key = `${x.kind} | ${x.shape ?? ''}`;
				groups.set(key, [...(groups.get(key) ?? []), x]);
			}
			const report = [...groups]
				.sort((a, b) => a[0].localeCompare(b[0]))
				.map(([key, xs]) => `\n### ${f.name} ${xs.length}x ${key}\n${xs[0].detail}`);
			expect(report.join('\n')).toBe('');
		}, 600_000);
	}
});
