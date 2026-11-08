// @vitest-environment jsdom
// suggesting in the visual editor with edits a reader makes to whole regions: a drag across several blocks
// holding a table, a list or a formula, a table's rows and columns, a list's depth, a heading's level.
// Fails on damage only; LARGE_EDIT_STATS=1 prints the tally, drawings that read wrong and bytes that drifted
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AllSelection, EditorState, NodeSelection, TextSelection, type Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { setBlockType } from 'prosemirror-commands';
import {
	CellSelection,
	TableMap,
	addColumnAfter,
	addColumnBefore,
	addRowAfter,
	addRowBefore,
	deleteCellSelection,
	deleteColumn,
	deleteRow,
	mergeCells,
	splitCell,
	tableEditing
} from 'prosemirror-tables';
import { createDedentListCommand, createIndentListCommand } from 'prosemirror-flat-list';
import { buildAnchor } from '$lib/comments/anchor';
import { activeSuggestions, takeTypedSides } from '$lib/comments/activeSuggestions.svelte';
import { placePmSuggestions } from '$lib/editor/visual/extensions/pmSuggestionsPlace';
import { acrossTables } from '$lib/editor/visual/extensions/table/wholeTableEdits';
import { deleteApart } from '$lib/editor/visual/extensions/crossBlockEdits';
import { firstRowHeader } from '$lib/languages/markdown/visual/firstRowHeader';
import { padTables } from '$lib/editor/visual/padTables';
import { computeBlockPatch, syncParseAttrs } from '$lib/editor/visual/blockPatch';
import { parseCarryPlugin } from '$lib/editor/visual/parseCarry';
import { adoptParse } from '$lib/editor/visual/parseOrigins';
import { serializeLatexFileDetailed, type ParsedLatexFile } from '$lib/workspace/latexRoundtrip';
import { serializeMarkdownFileDetailed } from '$lib/languages/markdown/visual/roundtrip';
import { serializeTypstFileDetailed } from '$lib/languages/typst/visual/roundtrip';
import { verifiedSerialize } from '$lib/workspace/verifiedSerialize';
import { FORMATS, drawnReading, pick, prng, randomEdit, renderedText, suggestionSource, type Format } from './visualEditsFuzz';

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
vi.mock('$lib/comments/author', () => ({ resolveAuthor: async () => 'me', forgetAuthor: () => {} }));

const { CommentsController } = await import('$lib/workspace/commentsController.svelte');

const ROOT = '/w';
const RUNS = Number(process.env.LARGE_EDIT_RUNS ?? 12);
const ONLY = Number(process.env.LARGE_EDIT_ONLY ?? 0);
const EXTRA = (process.env.LARGE_EDIT_FILES ?? '').split(';').filter(Boolean);

const TYP_TABLES = `= Results

The table below lists the runs we made, and the figure after it shows the trend.

#figure(
  table(
    columns: 3,
    [Run], [Time], [Error],
    [A], [1.2], [0.03],
    [B], [2.4], [0.01],
  ),
  caption: [Timing for each run],
) <runs>

- first point about the runs
- second point, with $x^2$ inside
  - a nested point

$ sum_(i=1)^n i = n(n+1)/2 $

A closing paragraph that refers to @runs and ends the section.
`;

type Doc = { f: Format; name: string; text: string };

const DETAILED = { tex: serializeLatexFileDetailed, md: serializeMarkdownFileDetailed, typ: serializeTypstFileDetailed };

function docs(): Doc[] {
	const [tex, md, typ] = FORMATS;
	const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
	const out: Doc[] = [
		{ f: tex, name: 'feature-sweep.tex', text: read(tex.files[0]) },
		{ f: tex, name: 'basics.tex', text: read(`${__dirname}/../../../fixtures/comments/basics.tex`) },
		{ f: md, name: 'feature-sweep.md', text: read(md.files[0]) },
		{ f: typ, name: 'feature-sweep.typ', text: read(typ.files[0]) },
		{ f: typ, name: 'tables.typ', text: TYP_TABLES }
	];
	for (const p of EXTRA) {
		const f = FORMATS.find((x) => p.endsWith(`.${x.name}`));
		if (f) out.push({ f, name: p.split(/[\\/]/).slice(-2).join('/'), text: read(p) });
	}
	return out;
}

// the things a reader sees as one object
const WHOLE = new Set([
	'table_wrapper',
	'table',
	'list',
	'block_math',
	'environment',
	'code_block',
	'raw_latex',
	'blockquote',
	'image',
	'figure',
	'horizontal_rule',
	'abstract',
	'term_item',
	'includedoc'
]);

type At = { node: PMNode; pos: number };

function textblocks(doc: PMNode): At[] {
	const out: At[] = [];
	doc.descendants((node, pos) => {
		if (node.type.spec.code) return false;
		if (node.isTextblock) {
			out.push({ node, pos });
			return false;
		}
		return true;
	});
	return out;
}

function wholes(doc: PMNode): At[] {
	const out: At[] = [];
	doc.descendants((node, pos) => {
		if (WHOLE.has(node.type.name)) out.push({ node, pos });
		return !node.isTextblock;
	});
	return out;
}

function tables(doc: PMNode): At[] {
	const out: At[] = [];
	doc.descendants((node, pos) => {
		if (node.type.spec.tableRole === 'table') out.push({ node, pos });
		return !node.isTextblock;
	});
	return out;
}

// where a reader can put the caret: never inside a formula's source, which mathlive edits
function spot(doc: PMNode, b: At, rnd: () => number): number {
	for (let tries = 0; tries < 8; tries++) {
		const p = b.pos + 1 + Math.floor(rnd() * (b.node.content.size + 1));
		if (doc.resolve(p).parent === b.node) return p;
	}
	return b.pos + 1;
}

function run(state: EditorState, command: Command): EditorState | null {
	let next: EditorState | null = null;
	try {
		command(state, (tr) => (next = state.apply(tr)));
	} catch {
		return null;
	}
	return next;
}

function orElse<T>(first: () => T, second: () => T): T {
	try {
		return first();
	} catch {
		return second();
	}
}

type Across = { from: number; to: number; what: string; whole: { from: number; to: number } | null };

/** a range from a block before some whole object to a block after it, either end sometimes inside it */
function acrossWhole(doc: PMNode, rnd: () => number): Across | null {
	const all = wholes(doc);
	if (!all.length) return null;
	const w = pick(rnd, all);
	const end = w.pos + w.node.nodeSize;
	const blocks = textblocks(doc);
	const before = blocks.filter((b) => b.pos + b.node.nodeSize <= w.pos).slice(-3);
	const after = blocks.filter((b) => b.pos >= end).slice(0, 3);
	const inside = blocks.filter((b) => b.pos > w.pos && b.pos < end);
	const from = inside.length && rnd() < 0.2 ? spot(doc, pick(rnd, inside), rnd) : before.length ? spot(doc, pick(rnd, before), rnd) : w.pos;
	let to = inside.length && rnd() < 0.2 ? spot(doc, pick(rnd, inside), rnd) : after.length ? spot(doc, pick(rnd, after), rnd) : end;
	if (to <= from) to = after.length ? spot(doc, after[0], rnd) : end;
	if (to <= from) return null;
	// the ends a caret can take, then what Backspace does with one of them in a table (wholeTableEdits)
	const sel = TextSelection.between(doc.resolve(from), doc.resolve(to));
	return { from: sel.from, to: sel.to, what: w.node.type.name, whole: acrossTables(doc, sel.from, sel.to) };
}

type Step = { label: string; state: EditorState } | null;

function largeEdit(state: EditorState, f: Format, rnd: () => number): Step {
	const doc = state.doc;
	const schema = doc.type.schema;
	const roll = rnd();
	let what = '';
	try {
		if (roll < 0.4) {
			const r = acrossWhole(doc, rnd);
			if (!r) return null;
			const typing = roll >= 0.3;
			what = `${typing ? 'type over' : 'delete'} [${r.from},${r.to}) across a ${r.what}${r.whole ? ' (whole table)' : ''}`;
			const typed = (tr: EditorState['tr'], at: number) => (typing ? tr.insertText('Typed over it', at) : tr);
			// and where ProseMirror cannot join the ends, what crossBlockEdits does
			const tr = r.whole
				? typed(state.tr.delete(r.whole.from, r.whole.to), r.whole.from)
				: orElse(
						() => {
							const t = state.tr.setSelection(TextSelection.create(doc, r.from, r.to));
							return typing ? t.insertText('Typed over it') : t.deleteSelection();
						},
						() => typed(deleteApart(state.tr, r.from, r.to), r.from)
					);
			return { label: `${what} ${JSON.stringify(doc.textBetween(r.from, r.to, '|', '#').slice(0, 60))}`, state: state.apply(tr) };
		}
		if (roll < 0.5) {
			// the app selects a table with its caption, never the grid alone
			const all = wholes(doc).filter((w) => w.node.type.name !== 'table' && NodeSelection.isSelectable(w.node));
			if (!all.length) return null;
			const w = pick(rnd, all);
			what = `delete the ${w.node.type.name} at ${w.pos}`;
			return { label: what, state: state.apply(state.tr.setSelection(NodeSelection.create(doc, w.pos)).deleteSelection()) };
		}
		if (roll < 0.54) {
			what = 'select all and delete';
			return { label: what, state: state.apply(state.tr.setSelection(new AllSelection(doc)).deleteSelection()) };
		}
		if (roll < 0.8) {
			const all = tables(doc);
			if (!all.length) return null;
			const t = pick(rnd, all);
			const start = t.pos + 1;
			const cells = [...new Set(TableMap.get(t.node).map)];
			const a = start + pick(rnd, cells);
			const b = rnd() < 0.4 ? a : start + pick(rnd, cells);
			const selected = state.apply(state.tr.setSelection(CellSelection.create(doc, a, b)));
			const ops: [string, Command][] = [
				['clear the cells', deleteCellSelection],
				['add a row after', addRowAfter],
				['add a row before', addRowBefore],
				['add a column after', addColumnAfter],
				['add a column before', addColumnBefore],
				['delete the rows', deleteRow],
				['delete the columns', deleteColumn],
				// a pipe table has no merged cells, and the markdown editor does not offer them
				...(f.name === 'md'
					? []
					: ([
							['merge the cells', mergeCells],
							['split the cell', splitCell]
						] as [string, Command][]))
			];
			const [name, op] = pick(rnd, ops);
			const next = run(selected, op);
			return next ? { label: `${name} [${a - start},${b - start}] of the table at ${t.pos}`, state: next } : null;
		}
		if (roll < 0.88) {
			const items = textblocks(doc).filter((b) => doc.resolve(b.pos).parent.type.name === 'list');
			if (!items.length) return null;
			const b = pick(rnd, items);
			const placed = state.apply(state.tr.setSelection(TextSelection.create(doc, spot(doc, b, rnd))));
			const indent = rnd() < 0.5;
			const next = run(placed, indent ? createIndentListCommand() : createDedentListCommand());
			return next
				? { label: `${indent ? 'indent' : 'dedent'} the item ${JSON.stringify(b.node.textContent.slice(0, 30))}`, state: next }
				: null;
		}
		if (roll < 0.94) {
			const heading = schema.nodes.heading;
			const tops: At[] = [];
			doc.forEach((node, pos) => {
				if (node.type === heading || node.type === schema.nodes.paragraph) tops.push({ node, pos });
			});
			if (!heading || !tops.length) return null;
			const b = pick(rnd, tops);
			const placed = state.apply(state.tr.setSelection(TextSelection.create(doc, b.pos + 1)));
			const toHeading = b.node.type !== heading || rnd() < 0.5;
			const level = 1 + Math.floor(rnd() * 3);
			const next = run(placed, toHeading ? setBlockType(heading, { ...b.node.attrs, level }) : setBlockType(schema.nodes.paragraph));
			return next
				? {
						label: `make ${JSON.stringify(b.node.textContent.slice(0, 30))} a ${toHeading ? `level ${level} heading` : 'paragraph'}`,
						state: next
					}
				: null;
		}
		const small = randomEdit(state, rnd, true);
		return small ? { label: small.label, state: state.apply(small.tr) } : null;
	} catch (e) {
		return { label: `THREW ${what}: ${(e as Error).message}`, state };
	}
}

/** where two texts first part, with a little either side */
function firstDifference(a: string, b: string): string {
	let s = 0;
	while (s < a.length && a[s] === b[s]) s++;
	let e = 0;
	while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
	return `at ${s}: ${JSON.stringify(a.slice(Math.max(0, s - 30), a.length - e + 30))} became ${JSON.stringify(b.slice(Math.max(0, s - 30), b.length - e + 30))}`;
}

const paragraphs = (s: string) =>
	s
		.split(/\n[ \t\r]*\n\s*/)
		.map((p) => p.replace(/\s+/g, ''))
		.filter(Boolean)
		.join('\n\n');

// latex and typst set quotes and dashes typed as ' ` '' -- as their curly and long forms, and a matrix row
// may end its line or not
const readsAlike = (s: string) =>
	s
		.replace(/[“”]|''|``/g, '"')
		.replace(/[‘’`]/g, "'")
		.replace(/—/g, '---')
		.replace(/–/g, '--')
		.replace(/\\\\\s+/g, '\\\\ ');

type Ending = 'reject' | 'accept';

async function session(d: Doc, seed: number, ending: Ending) {
	disk = {};
	activeSuggestions.current = [];
	takeTypedSides();
	const { f } = d;
	const rnd = prng(seed * 104729);
	const rel = `doc.${f.name}`;
	const FILE = `${ROOT}/${rel}`;
	const log: string[] = [];
	let text = d.text;
	let meta!: ParsedLatexFile;
	let state!: EditorState;
	const mount = () => {
		meta = f.parse(text);
		// the editors' own table plugins: one mends a table an edit left ragged, as it does for a reader
		const plugins = [parseCarryPlugin, tableEditing(), ...(f.name === 'md' ? [firstRowHeader] : [])];
		state = EditorState.create({ doc: padTables(meta.doc), plugins });
	};
	mount();
	const make = () =>
		new CommentsController({
			root: () => ROOT,
			preferredAuthor: () => 'me',
			openFileAt: () => {},
			activeText: () => text,
			mode: () => 'suggesting',
			rewraps: () => true,
			applyEdit: async (e) => {
				const next = text.slice(0, e.from) + e.insert + text.slice(e.to);
				const parsed = f.parse(next);
				if (parsed.preamble !== meta.preamble || parsed.postamble !== meta.postamble) {
					text = next;
					mount();
					return true;
				}
				const patch = computeBlockPatch(state.doc, parsed.doc);
				const tr = state.tr;
				if (patch) tr.replaceWith(patch.from, patch.to, patch.nodes);
				syncParseAttrs(tr, parsed.doc);
				if (tr.steps.length) state = state.apply(tr);
				adoptParse(state.doc, parsed.origins);
				text = f.serialize(meta, state.doc);
				return true;
			},
			saveNow: () => {}
		});
	const ctl = make();
	await ctl.load(ROOT);
	ctl.reanchor(FILE, text);

	// a reader's comments on a few words, which the edits may or may not reach
	const noted: { id: string; quote: string }[] = [];
	const { body } = suggestionSource(f, meta, text);
	for (let k = 0; k < 3; k++) {
		const at = body.from + Math.floor(rnd() * (body.to - body.from));
		const words = /\p{L}+(?: \p{L}+){0,2}/u.exec(text.slice(at, at + 80));
		if (!words) continue;
		const from = at + words.index;
		const to = from + words[0].length;
		const id = await ctl.openOn(rel, buildAnchor(text, from, to), 'a note');
		if (id) noted.push({ id, quote: text.slice(from, to) });
	}

	const damage: string[] = [];
	const soft: string[] = [];
	const steps = 1 + Math.floor(rnd() * 4);
	for (let i = 0; i < steps; i++) {
		const step = largeEdit(state, f, rnd);
		if (!step) continue;
		log.push(step.label);
		if (step.label.startsWith('THREW')) damage.push(step.label);
		state = step.state;
		const next = f.serialize(meta, state.doc);
		if (next === text) continue;
		text = next;
		ctl.suggestions.textChanged(FILE, text);
		if (rnd() < 0.5) await new Promise((r) => setTimeout(r, 0));
		if (rnd() < 0.3) await ctl.suggestions.settle();
	}
	await ctl.suggestions.settle();
	// the save check the app runs before the file goes to disk: a write that does not read back as the
	// editor shows is written again, and until then the source view, the suggestions and a session had it wrong
	const saved = await verifiedSerialize({
		format: f.name,
		doc: state.doc,
		first: DETAILED[f.name](meta, state.doc),
		serialize: (doc, afresh) => DETAILED[f.name](meta, doc, afresh),
		reparse: async (t) => f.parse(t).doc
	});
	if (saved.rung > 0)
		soft.push(`the first write needed the save check (rung ${saved.rung}${saved.difference ? `: ${saved.difference}` : ''})`);
	if (saved.text !== text) {
		text = saved.text;
		ctl.suggestions.textChanged(FILE, text);
		await ctl.suggestions.settle();
	}
	const edited = text;

	const reread = f.parse(edited);
	const shown = readsAlike(renderedText(state.doc));
	const back = readsAlike(renderedText(reread.doc));
	if (shown !== back) damage.push(`the file reads back differently from what the editor showed: ${firstDifference(shown, back)}`);
	if (f.name === 'tex') {
		const names = (re: RegExp) =>
			[...edited.matchAll(re)]
				.map((m) => m[1])
				.sort()
				.join(',');
		if (names(/\\begin\{([^}]*)\}/g) !== names(/\\end\{([^}]*)\}/g)) damage.push('\\begin and \\end no longer pair up');
	}

	// what the editor draws reads as rejecting reads
	const marks = activeSuggestions.current;
	const placed = placePmSuggestions(reread.doc, marks, suggestionSource(f, reread, edited));
	const whole = marks.filter((m) => !placed.partial.has(m.id) && placed.ranges.some((r) => r.id === m.id));
	if (whole.length < marks.length) soft.push(`${marks.length - whole.length} of ${marks.length} suggestions not drawn in full`);
	if (whole.length) {
		let rejected = edited;
		for (const m of [...whole].sort((a, b) => b.from - a.from)) rejected = rejected.slice(0, m.from) + m.restore + rejected.slice(m.to);
		const want = renderedText(f.parse(rejected).doc);
		const got = renderedText(
			reread.doc,
			placed.ranges.filter((r) => whole.some((m) => m.id === r.id)).flatMap((r) => drawnReading(r) ?? [])
		);
		// taken out blocks are drawn as a block of their own, the words at their edges with them: what
		// must hold is the words' order, not where the lines break
		const wordsOf = (s: string) => s.replace(/\s+/g, '');
		const differs = wordsOf(want) !== wordsOf(got);
		if (differs) soft.push(`drawn differently from rejecting: ${firstDifference(wordsOf(want), wordsOf(got))}`);
		// LARGE_EDIT_DRAWN=1 prints the marks and the ranges placed for them
		if (differs && process.env.LARGE_EDIT_DRAWN) {
			const shown = placed.ranges.map((r) => {
				const at = reread.doc.textBetween(Math.max(0, r.from - 12), Math.min(reread.doc.content.size, r.to + 12), '|', '#');
				const words = r.gone
					? `gone head=${JSON.stringify(r.gone.head.map((x) => x.text).join(''))} blocks=${JSON.stringify(r.gone.blocks.map((b) => b.textContent))} tail=${JSON.stringify(r.gone.tail.map((x) => x.text).join(''))}`
					: `old=${JSON.stringify(r.old.map((x) => x.text).join(''))}`;
				return `  [${r.from},${r.to}]${r.brk ? ` brk ${r.brk}` : ''}${r.node ? ' node' : ''}${r.partial ? ' partial' : ''} ${words} near ${JSON.stringify(at)}`;
			});
			const marksShown = marks.map(
				(m) => `  mark ${m.from}..${m.to} now ${JSON.stringify(edited.slice(m.from, m.to))} was ${JSON.stringify(m.restore)}`
			);
			soft.push(`drawn ranges:\n${marksShown.join('\n')}\n${shown.join('\n')}`);
		}
	}

	// saved and opened again, every suggestion is found, and a comment only loses its place with its words
	const open = () => ctl.threads.filter((t) => t.restore !== undefined && !t.resolved);
	await ctl.suggestions.beforeSave(rel, edited);
	const again = make();
	await again.load(ROOT);
	again.reanchor(FILE, edited);
	await again.suggestions.settle();
	const lostComments = noted.filter((c) => again.orphaned.has(c.id));
	// words the file holds once, before and after: a common word standing elsewhere is not the one commented on
	const once = (hay: string, needle: string) => hay.indexOf(needle) >= 0 && hay.indexOf(needle) === hay.lastIndexOf(needle);
	const wronglyLost = lostComments.filter((c) => once(d.text, c.quote) && once(edited, c.quote));
	// one letter or two has nothing to find it by once the words around it are written anew
	const wronglyLostLong = wronglyLost.filter((c) => c.quote.length > 2).length;
	if (wronglyLostLong) damage.push(`${wronglyLostLong} comments not found after reopening though their words are still there`);
	const lostSuggestions = [...again.orphaned].filter((id) => !noted.some((c) => c.id === id)).length;
	if (lostSuggestions) damage.push(`${lostSuggestions} of ${open().length} suggestions not found after reopening`);

	let refused = 0;
	for (const t of open().sort(() => rnd() - 0.5)) {
		if (ending === 'accept') await ctl.suggestions.accept(t);
		else if (!(await ctl.suggestions.reject(t))) refused++;
	}
	if (ending === 'reject') {
		if (refused) damage.push(`${refused} suggestions refused to reject`);
		if (paragraphs(text) !== paragraphs(d.text))
			damage.push(`rejecting all lost content: ${firstDifference(paragraphs(d.text), paragraphs(text))}`);
		else if (text !== d.text) soft.push(`rejecting all gave the words back but not the exact bytes: ${firstDifference(d.text, text)}`);
	} else {
		if (text !== edited) damage.push('accepting all changed the file');
		if (open().length) damage.push(`${open().length} suggestions still open after accepting all`);
	}
	return { damage, soft, log, comments: noted.length, commentsLost: lostComments.length };
}

/** what a run's edits reached, for the tally */
function kindsOf(log: string[]): string[] {
	const kind = (l: string) =>
		/of the table/.test(l)
			? 'table rows, columns, cells'
			: (/across an? (\w+)/.exec(l)?.[1] ??
				/^delete the (\w+)/.exec(l)?.[1] ??
				(/^(indent|dedent)/.test(l)
					? 'list indent'
					: /^make /.test(l)
						? 'heading level'
						: /^select all/.test(l)
							? 'select all'
							: 'small edit'));
	return [...new Set(log.map(kind))];
}

describe('large edits while suggesting in the visual editor', () => {
	for (const ending of ['reject', 'accept'] as const) {
		it(`${ending}s every suggestion a large edit made and nothing is lost`, async () => {
			const failures: string[] = [];
			const softs: string[] = [];
			let comments = 0;
			let commentsLost = 0;
			const tally = new Map<string, { runs: number; damage: number; soft: number }>();
			for (const d of docs()) {
				for (let seed = ONLY || 1; seed <= (ONLY || RUNS); seed++) {
					const r = await session(d, seed, ending);
					comments += r.comments;
					commentsLost += r.commentsLost;
					for (const k of kindsOf(r.log)) {
						const t = tally.get(k) ?? { runs: 0, damage: 0, soft: 0 };
						t.runs++;
						if (r.damage.length) t.damage++;
						if (r.soft.length) t.soft++;
						tally.set(k, t);
					}
					const where = `${d.name} seed ${seed}`;
					if (r.damage.length) failures.push(`${where}: ${r.damage.join('; ')}\n  steps: ${r.log.join(' | ')}`);
					if (r.soft.length) softs.push(`${where}: ${r.soft.join('; ')}\n  steps: ${r.log.join(' | ')}`);
				}
			}
			if (process.env.LARGE_EDIT_STATS) {
				console.log(`STATS ${ending}: ${comments} comments, ${commentsLost} lost with their words`);
				for (const [k, t] of [...tally].sort((a, b) => b[1].runs - a[1].runs))
					console.log(`TALLY ${k}: ${t.runs} runs, ${t.damage} damaged, ${t.soft} soft`);
				for (const s of softs) console.log(`SOFT ${s}`);
			}
			expect(failures).toEqual([]);
		}, 1_800_000);
	}
});
