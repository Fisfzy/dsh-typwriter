import { describe, it, expect } from 'vitest';
import { schema } from '$lib/languages/latex/schema/latexPMSchema';
import {
	flattenDoc,
	placePmComments,
	pmComments,
	setPmComments,
	revealPmComment,
	sourceAnchorFor
} from '$lib/editor/visual/extensions/pmComments';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { parseLatexFile } from '$lib/workspace/latexRoundtrip';

const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const doc = (...children: Parameters<typeof schema.nodes.doc.create>[1][]) => schema.nodes.doc.create(null, children as never);

function posOf(d: PMNode, needle: string): number {
	let found = -1;
	d.descendants((n, pos) => {
		if (found >= 0) return false;
		if (n.isText) {
			const i = n.text!.indexOf(needle);
			if (i >= 0) found = pos + i;
		}
		return found < 0;
	});
	if (found < 0) throw new Error(`no text ${needle}`);
	return found;
}

/** a thread on `quote` in `src`, the way the controller hands one over, placed in the parsed document */
function placed(src: string, quote: string) {
	const parsed = parseLatexFile(src);
	const at = src.indexOf(quote);
	const range = { id: 't1', from: at, to: at + quote.length, resolved: false };
	return { doc: parsed.doc, map: parsed.map, ...placePmComments(parsed.doc, [range], parsed.map) };
}

describe('flattenDoc', () => {
	it('collects text with one ProseMirror position per character', () => {
		const d = doc(p('alpha'), p('beta'));
		const { text, index } = flattenDoc(d);
		expect(text).toBe('alpha\nbeta');
		expect(index).toHaveLength(text.length);
		// every indexed position resolves to the character it claims to be
		for (let i = 0; i < text.length; i++) {
			if (text[i] === '\n') continue; // block separator: maps to the block node, not a character
			expect(d.textBetween(index[i], index[i] + 1)).toBe(text[i]);
		}
	});

	it('keeps atoms one character wide instead of splicing their neighbours together', () => {
		const math = schema.nodes.inline_math.create({ latex: 'x^2' });
		const d = doc(schema.nodes.paragraph.create(null, [schema.text('see '), math, schema.text(' here')]));
		const { text, index } = flattenDoc(d);
		expect(text).toBe('see \uFFFC here');
		expect(index).toHaveLength(text.length);
	});
});

describe('placePmComments', () => {
	it('places a thread on the characters its bytes are', () => {
		const src = '\\section{Intro}\n\nThe first paragraph mentions gravity.\n\nThe second one does not.\n';
		const { doc: d, ranges, lost } = placed(src, 'paragraph mentions gravity');
		expect(lost).toEqual([]);
		expect(ranges).toHaveLength(1);
		expect(d.textBetween(ranges[0].from, ranges[0].to)).toBe('paragraph mentions gravity');
	});

	it('a quote across a source line wrap covers the joined words', () => {
		const { doc: d, ranges, lost } = placed('The theorem holds\nfor every bounded case.\n', 'holds\nfor every');
		expect(lost).toEqual([]);
		expect(d.textBetween(ranges[0].from, ranges[0].to)).toBe('holds for every');
	});

	it('a quote on a raw island tints the island whole', () => {
		const src = 'Before.\n\n\\begin{figure}[h]\n\\centering\n\\end{figure}\n\nAfter.\n';
		const { doc: d, ranges, lost } = placed(src, '\\begin{figure}[h]');
		expect(lost).toEqual([]);
		expect(ranges[0].node).toBe(true);
		expect(d.nodeAt(ranges[0].from)?.type.name).toBe('raw_latex');
	});

	it('a quote inside display math tints the equation', () => {
		const src = 'Before.\n\n\\begin{align}\nE=mc^2\n\\end{align}\n\nAfter.\n';
		const { doc: d, ranges, lost } = placed(src, 'E=mc^2');
		expect(lost).toEqual([]);
		expect(ranges[0].node).toBe(true);
		expect(d.nodeAt(ranges[0].from)?.type.name).toBe('block_math');
	});

	it('a quote crossing an inline formula spans it', () => {
		const src = 'Before.\n\nThe formula $E=mc^2$ changed physics.\n\nAfter.\n';
		const { doc: d, ranges, lost } = placed(src, 'formula $E=mc^2$ changed');
		expect(lost).toEqual([]);
		const shown = d.textBetween(ranges[0].from, ranges[0].to);
		expect(shown.startsWith('formula ')).toBe(true);
		expect(shown.endsWith(' changed')).toBe(true);
	});

	it('places a comment on a figure caption', () => {
		const src = 'Before.\n\n\\begin{figure}\n\\includegraphics{p.png}\n\\caption{The measured response curve}\n\\end{figure}\n\nAfter.\n';
		const { doc: d, ranges, lost } = placed(src, 'measured response curve');
		expect(lost).toEqual([]);
		expect(d.textBetween(ranges[0].from, ranges[0].to)).toBe('measured response curve');
	});

	it('reports a thread the map cannot place as lost, never a guess', () => {
		const parsed = parseLatexFile('Plain text here.\n');
		const { ranges, lost } = placePmComments(parsed.doc, [{ id: 't1', from: 6, to: 10, resolved: false }], { leaves: [], blocks: [] });
		expect(ranges).toEqual([]);
		expect(lost).toEqual(['t1']);
	});

	it('carries the resolved flag through so resolved threads can stay undecorated', () => {
		const parsed = parseLatexFile('Plain text here.\n');
		const { ranges } = placePmComments(parsed.doc, [{ id: 't1', from: 6, to: 10, resolved: true }], parsed.map);
		expect(ranges[0].resolved).toBe(true);
	});
});

describe('sourceAnchorFor', () => {
	it('is the bytes of the selected characters, markup included', () => {
		const src = 'Hello \\emph{big} world.\n';
		const { doc: d, map } = parseLatexFile(src);
		const big = posOf(d, 'big');
		expect(sourceAnchorFor(d, map, src, big, big + 3)?.quote).toBe('big');
		const wide = sourceAnchorFor(d, map, src, posOf(d, 'Hello'), posOf(d, 'world') + 5);
		expect(wide?.quote).toBe('Hello \\emph{big} world');
		expect(src.slice(wide!.start, wide!.end)).toBe(wide!.quote);
	});

	it('a point takes the character before it', () => {
		const src = 'Hello world.\n';
		const { doc: d, map } = parseLatexFile(src);
		const at = posOf(d, 'world');
		const point = sourceAnchorFor(d, map, src, at, at);
		expect(point?.start).toBe(src.indexOf('world'));
		expect(point?.quote).toBe('');
	});

	it('gives nothing when an end has no bytes', () => {
		expect(sourceAnchorFor(doc(p('x')), { leaves: [], blocks: [] }, 'x', 1, 3)).toBeNull();
	});
});

/**
 * A stand-in for EditorView: revealPmComment only reads `state` and calls `dispatch`, and a real
 * view needs a DOM this suite does not have.
 */
function stubView(initial: EditorState) {
	let current = initial;
	return {
		get state() {
			return current;
		},
		dispatch(tr: ReturnType<EditorState['tr']['setMeta']>) {
			current = current.apply(tr);
		},
		dom: { parentElement: null },
		coordsAtPos: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
	};
}

describe('revealPmComment', () => {
	const build = () => {
		const src = 'First paragraph.\n\nSecond paragraph mentions gravity.\n';
		const { doc: d, map } = parseLatexFile(src);
		const view = stubView(EditorState.create({ doc: d, plugins: pmComments() }));
		const v = view as never;
		const at = src.indexOf('mentions gravity');
		const { ranges } = placePmComments(d, [{ id: 't1', from: at, to: at + 16, resolved: false }], map);
		setPmComments(v, ranges);
		return { view, v, d, ranges };
	};

	it('parks the caret on a placed thread', () => {
		const { view, v, ranges } = build();
		expect(revealPmComment(v, 't1')).toBe(true);
		expect(view.state.selection.from).toBe(ranges[0].from);
	});

	it('leaves the caret collapsed, so the add-comment pill does not offer to comment on a comment', () => {
		const { view, v } = build();
		revealPmComment(v, 't1');
		expect(view.state.selection.empty).toBe(true);
		expect(view.state.selection instanceof TextSelection).toBe(true);
	});

	it('reports false for a thread this view has not placed, so the caller can fall back', () => {
		const { view, v } = build();
		const before = view.state.selection.from;
		expect(revealPmComment(v, 'somewhere-else')).toBe(false);
		expect(view.state.selection.from).toBe(before);
	});
});
