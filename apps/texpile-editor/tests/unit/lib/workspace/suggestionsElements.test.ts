// @vitest-environment jsdom
// every element the visual editor can put in a suggestion: typing goes on being tracked, and what
// the editor draws for it is at least a region, and words wherever it can show them
import { describe, it, expect, vi } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode, Schema } from 'prosemirror-model';
import { activeSuggestions } from '$lib/comments/activeSuggestions.svelte';
import { placePmSuggestions } from '$lib/editor/visual/extensions/pmSuggestionsPlace';
import { createTableNode } from '$lib/editor/visual/tableUtils';
import { FORMATS, drawnReading, oldWordsOf, renderedText, suggestionSource } from './visualEditsFuzz';

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

const tex = FORMATS[0];
const SOURCE =
	'\\documentclass{article}\n\\begin{document}\nAn inline \\textit{quotation} sits in running text.\n\nA second one follows here.\n\nA third paragraph ends it.\n\\end{document}\n';

type Tier = 'words' | 'region' | 'hidden';
type Outcome = { tier: Tier; tracked: boolean; faithful: boolean; format: boolean; marks: number };

/** the end of the second paragraph's text */
function at(s: EditorState): number {
	return s.doc.child(0).nodeSize + s.doc.child(1).nodeSize - 1;
}

async function suggest(edits: ((s: EditorState) => Transaction)[]): Promise<Outcome> {
	disk = {};
	activeSuggestions.current = [];
	let text = SOURCE;
	const meta = tex.parse(text);
	let state = EditorState.create({ doc: meta.doc });
	const ctl = new CommentsController({
		root: () => '/w',
		preferredAuthor: () => 'me',
		openFileAt: () => {},
		activeText: () => text,
		mode: () => 'suggesting',
		rewraps: () => true,
		applyEdit: async () => false,
		saveNow: () => {}
	});
	await ctl.load('/w');
	ctl.reanchor('/w/doc.tex', text);
	// the app reports the text on open as well, which is what lets the first edit carry its gesture
	ctl.suggestions.textChanged('/w/doc.tex', text);
	for (const edit of edits) {
		state = state.apply(edit(state));
		text = tex.serialize(meta, state.doc);
		ctl.suggestions.textChanged('/w/doc.tex', text);
		await ctl.suggestions.settle();
	}
	const marks = activeSuggestions.current;
	const parsed = tex.parse(text);
	const shown = parsed.doc;
	const placed = placePmSuggestions(shown, marks, suggestionSource(tex, parsed, text));
	const shownMarks = marks.filter((m) => !placed.partial.has(m.id) && placed.ranges.some((r) => r.id === m.id));
	const drawn = placed.ranges.filter((r) => shownMarks.some((m) => m.id === r.id));
	let rejected = text;
	for (const m of [...shownMarks].sort((a, b) => b.from - a.from)) rejected = rejected.slice(0, m.from) + m.restore + rejected.slice(m.to);
	const want = renderedText(tex.parse(rejected).doc);
	const got = renderedText(
		shown,
		drawn.flatMap((r) => drawnReading(r) ?? [])
	);
	const faithful = want === got;
	if (process.env.SUGGEST_DEBUG && !faithful) console.log(`WANT ${JSON.stringify(want)}\nGOT  ${JSON.stringify(got)}`);
	const tier: Tier = placed.hidden.size ? 'hidden' : placed.partial.size ? 'region' : 'words';
	if (process.env.SUGGEST_DEBUG)
		console.log(
			'PLACED ' +
				JSON.stringify({
					marks: marks.map((m) => ({ from: m.from, to: m.to, quote: m.anchor.quote, restore: m.restore })),
					ranges: placed.ranges.map((r) => ({
						...r,
						old: oldWordsOf(r),
						gone: undefined,
						was: r.was?.type.name,
						text: shown.textBetween(r.from, r.to, '|')
					}))
				})
		);
	return {
		tier,
		tracked: marks.some((m) => m.anchor.quote.includes('after words')),
		faithful,
		format: drawn.some((r) => r.format),
		marks: marks.length
	};
}

const type = (words: string) => (s: EditorState) => s.tr.insertText(words, at(s));
const typeAfter = (s: EditorState) => s.tr.insertText(' after words', at(s));

function marked(name: string, attrs?: Record<string, unknown>) {
	return (s: EditorState) => {
		const from = at(s);
		return s.tr.insertText(' marked words', from).addMark(from + 1, from + ' marked words'.length, s.schema.marks[name].create(attrs));
	};
}

/** a mark put on words that were already there, nothing typed or removed */
function formatted(name: string, attrs?: Record<string, unknown>) {
	return (s: EditorState) => {
		const from = s.doc.child(0).nodeSize + 1 + 'A '.length;
		return s.tr.addMark(from, from + 'second one'.length, s.schema.marks[name].create(attrs));
	};
}

function inline(make: (schema: Schema) => PMNode) {
	return (s: EditorState) => s.tr.insert(at(s), make(s.schema));
}

/** the block handle: a new block after the paragraph, then words typed into it and after it */
function block(make: (schema: Schema) => PMNode, inner = 'block words') {
	return [
		(s: EditorState) => {
			const node = make(s.schema);
			const tr = s.tr.insert(s.doc.resolve(at(s)).after(), node);
			if (inner && node.isTextblock) tr.insertText(inner, s.doc.resolve(at(s)).after() + 1);
			else if (inner && node.firstChild?.isTextblock) tr.insertText(inner, s.doc.resolve(at(s)).after() + 2);
			return tr;
		},
		(s: EditorState) => {
			const $end = s.doc.resolve(at(s));
			const pos = $end.after() + s.doc.nodeAt($end.after())!.nodeSize;
			return s.tr.insert(pos, s.schema.nodes.paragraph.create(null, s.schema.text('after words')));
		}
	];
}

const CASES: Record<string, { edits: ((s: EditorState) => Transaction)[]; want: Tier; format?: true }> = {
	'plain words': { edits: [type(' typed'), typeAfter], want: 'words' },
	bold: { edits: [marked('strong'), typeAfter], want: 'words' },
	italic: { edits: [marked('em'), typeAfter], want: 'words' },
	underline: { edits: [marked('u'), typeAfter], want: 'words' },
	superscript: { edits: [marked('sup'), typeAfter], want: 'words' },
	subscript: { edits: [marked('sub'), typeAfter], want: 'words' },
	'inline code': { edits: [marked('code'), typeAfter], want: 'words' },
	link: { edits: [marked('link', { href: 'https://x.y' }), typeAfter], want: 'words' },
	'text color': { edits: [marked('textcolor', { color: 'red' }), typeAfter], want: 'words' },
	'bold on existing words': { edits: [formatted('strong'), typeAfter], want: 'words', format: true },
	'italic on existing words': { edits: [formatted('em'), typeAfter], want: 'words', format: true },
	'link on existing words': { edits: [formatted('link', { href: 'https://x.y' }), typeAfter], want: 'words', format: true },
	'text color on existing words': { edits: [formatted('textcolor', { color: 'red' }), typeAfter], want: 'words', format: true },
	'highlight on existing words': { edits: [formatted('highlight', { color: 'yellow' }), typeAfter], want: 'words', format: true },
	highlight: { edits: [marked('highlight', { color: 'yellow' }), typeAfter], want: 'words' },
	'inline math': { edits: [type(' before '), inline((s) => s.nodes.inline_math.create(null, s.text('a'))), typeAfter], want: 'words' },
	citation: {
		edits: [type(' see '), inline((s) => s.nodes.citation.create({ variant: 'cite' }, s.text('knuth84'))), typeAfter],
		want: 'words'
	},
	reference: { edits: [type(' see '), inline((s) => s.nodes.ref.create({}, s.text('sec:intro'))), typeAfter], want: 'words' },
	label: { edits: [type(' here'), inline((s) => s.nodes.label.create({ name: 'sec:here' })), typeAfter], want: 'words' },
	'line break': { edits: [type(' first'), inline((s) => s.nodes.hard_break.create()), typeAfter], want: 'words' },
	'raw chip': { edits: [type(' see '), inline((s) => s.nodes.inline_latex.create(null, s.text('\\foo{x}'))), typeAfter], want: 'words' },
	heading: { edits: block((s) => s.nodes.heading.create({ level: 1 })), want: 'words' },
	'bullet list': {
		edits: block((s) => s.nodes.list.create({ kind: 'bullet', order: null, checked: null, collapsed: false }, s.nodes.paragraph.create())),
		want: 'words'
	},
	'numbered list': {
		edits: block((s) => s.nodes.list.create({ kind: 'ordered', order: 1, checked: null, collapsed: false }, s.nodes.paragraph.create())),
		want: 'words'
	},
	quote: { edits: block((s) => s.nodes.blockquote.create(null, s.nodes.paragraph.create())), want: 'words' },
	abstract: { edits: block((s) => s.nodes.abstract.create({ sourceForm: 'env' }, s.nodes.paragraph.create())), want: 'words' },
	environment: { edits: block((s) => s.nodes.environment.create({ name: 'center' }, s.nodes.paragraph.create())), want: 'words' },
	table: { edits: block((s) => createTableNode(s, 2, 2, true)!, ''), want: 'words' },
	'block math': { edits: block((s) => s.nodes.block_math.create({}, s.text('x^2')), ''), want: 'words' },
	'code block': { edits: block((s) => s.nodes.code_block.create(null, s.text('let x = 1;')), ''), want: 'words' },
	'raw block': { edits: block((s) => s.nodes.raw_latex.create(null, s.text('\\vspace{1em}')), ''), want: 'words' },
	rule: { edits: block((s) => s.nodes.horizontal_rule.create(), ''), want: 'words' },
	figure: { edits: block((s) => s.nodes.image.create({ src: 'fig.png' }), ''), want: 'words' }
};

describe('suggestions holding each element of the visual editor', () => {
	for (const [name, c] of Object.entries(CASES)) {
		it(`${name}: keeps tracking and draws it as ${c.want}${c.format ? ', a format change' : ''}`, async () => {
			const got = await suggest(c.edits);
			expect({ name, ...got }).toEqual({ name, tier: c.want, tracked: true, faithful: true, format: !!c.format, marks: got.marks });
		});
	}
});
