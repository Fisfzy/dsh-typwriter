// drag a random selection in the visual editor and hit Comment: the anchor is the bytes of the
// characters selected, or nothing, never a guess
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Node as PMNode } from 'prosemirror-model';
import { parseLatexFile } from '$lib/workspace/latexRoundtrip';
import { parseMarkdownFile } from '$lib/languages/markdown/visual/roundtrip';
import { parseTypstFile } from '$lib/languages/typst/visual/roundtrip';
import { sourceAnchorFor } from '$lib/editor/visual/extensions/pmComments';
import { isSelfRendered } from '$lib/editor/visual/diff/selfRendered';
import type { SourceMap } from '$lib/editor/visual/sourceSpans';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/comments/${name}`, import.meta.url)), 'utf8');

/** deterministic PRNG (mulberry32) so a failure reproduces byte-for-byte */
function rng(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const SAMPLES = 400;

/** the letters and digits of `shown`, in order, all appear in `bytes` in that order */
function carries(bytes: string, shown: string): boolean {
	let at = 0;
	for (const ch of shown.replace(/[^A-Za-z0-9]/g, '')) {
		at = bytes.indexOf(ch, at);
		if (at < 0) return false;
		at++;
	}
	return true;
}

function shownText(doc: PMNode, from: number, to: number): string {
	let out = '';
	doc.nodesBetween(from, to, (node, pos) => {
		if (node.isText) {
			out += node.text!.slice(Math.max(0, from - pos), to - pos);
			return false;
		}
		if (node.isInline || isSelfRendered(node)) {
			out += '￼';
			return false;
		}
		if (out && !out.endsWith(' ')) out += ' ';
		return true;
	});
	return out;
}

function fuzz(src: string, doc: PMNode, map: SourceMap, seed: number): { wrong: string[]; misses: number; samples: number } {
	const size = doc.content.size;
	const rand = rng(seed);
	const wrong: string[] = [];
	let misses = 0;
	let samples = 0;
	for (let k = 0; k < SAMPLES; k++) {
		const from = 1 + Math.floor(rand() * (size - 2));
		const to = Math.min(size - 1, from + 3 + Math.floor(rand() * 180));
		if (to <= from) continue;
		// a selection that is mostly atoms or whitespace has nothing to pin; a formula's content is a
		// translation of its bytes, so it counts as one atom
		const shown = shownText(doc, from, to);
		if (shown.replace(/[^A-Za-z0-9]/g, '').length < 4) continue;
		samples++;
		const anchor = sourceAnchorFor(doc, map, src, from, to);
		if (!anchor) {
			misses++;
			continue;
		}
		if (src.slice(anchor.start, anchor.end) !== anchor.quote || !carries(anchor.quote, shown)) {
			wrong.push(`[${from},${to}] ${JSON.stringify(shown.slice(0, 60))} -> ${JSON.stringify(anchor.quote.slice(0, 90))}`);
		}
	}
	return { wrong, misses, samples };
}

describe('random visual selections anchor into source', () => {
	const cases: [string, (src: string) => { doc: PMNode; map: SourceMap }][] = [
		['feature-sweep.tex', parseLatexFile],
		['feature-sweep.md', parseMarkdownFile],
		['feature-sweep.typ', parseTypstFile]
	];
	for (const [name, parse] of cases) {
		it(name, () => {
			const src = fixture(name);
			const { doc, map } = parse(src);
			const { wrong, misses, samples } = fuzz(src, doc, map, 0xdecade);
			expect(wrong).toEqual([]);
			// an end on a character the map has no bytes for gives no anchor; that is rare and honest
			expect(misses / Math.max(1, samples)).toBeLessThan(0.05);
		});
	}
});
