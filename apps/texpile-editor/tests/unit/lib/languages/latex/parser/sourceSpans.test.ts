// the LaTeX parser's source map: every text run is exactly its bytes, no byte is claimed twice, and
// the prose of real papers is covered
import { describe, it, expect } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { parseLatexFile } from '$lib/workspace/latexRoundtrip';
import { nearestPm, pmToSource, sourceToPm, type Segment } from '$lib/editor/visual/sourceSpans';
import { auditMap, coverage } from '../../../editor/visual/sourceMapAudit';
import { readTex, texFiles } from '../texFixtures';

describe('the LaTeX parser source map', () => {
	it('is exact on every fixture: text runs are their bytes and no byte is claimed twice', () => {
		const failures: string[] = [];
		for (const f of texFiles) {
			const text = readTex(f);
			const { doc, map } = parseLatexFile(text);
			for (const p of auditMap(doc, text, map.leaves).problems.slice(0, 5)) failures.push(`${f}: ${p}`);
		}
		expect(failures).toEqual([]);
	});

	it('covers the prose of real papers', () => {
		const audits = texFiles.map((f) => {
			const text = readTex(f);
			const { doc, map } = parseLatexFile(text);
			return auditMap(doc, text, map.leaves);
		});
		const { prose, nodes } = coverage(audits);
		console.log(
			`parser map coverage over ${texFiles.length} files: prose ${(prose * 100).toFixed(1)}%, leaf nodes ${(nodes * 100).toFixed(1)}%`
		);
		expect(prose).toBeGreaterThan(0.95);
		expect(nodes).toBeGreaterThan(0.95);
	});

	it('gives every stamped block its range, in document order', () => {
		for (const f of texFiles) {
			const text = readTex(f);
			const { doc, map } = parseLatexFile(text);
			let last = -1;
			for (const b of map.blocks) {
				expect(b.pmFrom).toBeGreaterThanOrEqual(last);
				expect(text.slice(b.srcFrom, b.srcTo).length).toBe(b.srcTo - b.srcFrom);
				last = b.pmTo;
			}
			expect(map.blocks.length).toBeLessThanOrEqual(doc.childCount);
		}
	});
});

function posOf(doc: PMNode, needle: string): number {
	let found = -1;
	doc.descendants((n, pos) => {
		if (found >= 0) return false;
		if (n.isText) {
			const i = n.text!.indexOf(needle);
			if (i >= 0) found = pos + i;
		}
		return found < 0;
	});
	if (found < 0) throw new Error(`no text ${JSON.stringify(needle)} in ${JSON.stringify(doc.textContent)}`);
	return found;
}

function mapped(src: string): { doc: PMNode; spans: Segment[]; src: string } {
	const { doc, map } = parseLatexFile(src);
	return { doc, spans: map.leaves, src };
}

describe('the runs of small documents', () => {
	it('prose is its bytes and markup is nobody\u2019s', () => {
		const { doc, spans, src } = mapped('Hello \\emph{world}.\n');
		expect(sourceToPm(spans, src.indexOf('world'))).toBe(posOf(doc, 'world'));
		expect(pmToSource(spans, posOf(doc, 'world') + 2)).toBe(src.indexOf('world') + 2);
		expect(sourceToPm(spans, src.indexOf('{'))).toBeNull();
		expect(nearestPm(spans, src.indexOf('{'), 1)).toBe(posOf(doc, 'world'));
		// the position between "world" and "." ends one run and starts another; each side is an honest answer
		expect(pmToSource(spans, posOf(doc, '.'), -1)).toBe(src.indexOf('world') + 5);
		expect(pmToSource(spans, posOf(doc, '.'), 1)).toBe(src.indexOf('.'));
	});

	it('an item\u2019s label lies inside its paragraph\u2019s span, so the map is believed', () => {
		const src = '\\begin{description}\n\\item[Term] its definition.\n\\item[Other] a second one.\n\\end{description}\n';
		const { map, origins } = parseLatexFile(src);
		expect(origins.defects).toEqual([]);
		const items = (map.inner ?? []).map((s) => src.slice(s.srcFrom, s.srcTo));
		expect(items).toEqual(['Term] its definition.', 'Other] a second one.']);
	});

	it('counts the preamble in a real document', () => {
		const src = '\\documentclass{article}\n\\begin{document}\nHi there.\n\\end{document}\n';
		const { doc, spans } = mapped(src);
		expect(sourceToPm(spans, src.indexOf('there'))).toBe(posOf(doc, 'there'));
	});

	it('a ligature stands for its bytes', () => {
		const { doc, spans, src } = mapped('a---b\n');
		const dash = posOf(doc, '—');
		expect(pmToSource(spans, dash)).toBe(src.indexOf('---'));
		expect(pmToSource(spans, dash + 1)).toBe(src.indexOf('---') + 3);
		expect(pmToSource(spans, dash + 2)).toBe(src.indexOf('b') + 1);
	});

	it('a tie is the space it draws as', () => {
		const { doc, spans, src } = mapped('Figure~\\ref{fig:a} shows.\n');
		expect(sourceToPm(spans, src.indexOf('~'))).toBe(posOf(doc, 'Figure') + 6);
		expect(pmToSource(spans, posOf(doc, 'shows'))).toBe(src.indexOf('shows'));
	});

	it('an accent chip is its bytes', () => {
		const { doc, spans, src } = mapped("caf\\'e au lait\n");
		expect(sourceToPm(spans, src.indexOf("\\'e") + 1)).toBe(posOf(doc, "\\'e") + 1);
		expect(pmToSource(spans, posOf(doc, 'au'))).toBe(src.indexOf('au'));
	});

	it('inline math maps its body, a special character stands for its command', () => {
		const { doc, spans, src } = mapped('Let $x^2$ be 100\\%.\n');
		expect(sourceToPm(spans, src.indexOf('x^2') + 1)).toBe(posOf(doc, 'x^2') + 1);
		const percent = posOf(doc, '%');
		expect(pmToSource(spans, percent)).toBe(src.indexOf('\\%'));
		expect(pmToSource(spans, percent + 1)).toBe(src.indexOf('\\%') + 2);
	});

	it('a heading, a comment block and a display equation map their bytes', () => {
		const src = '\\section{Intro}\n\n% a note\n\nBody text.\n\n\\[ a = b \\]\n';
		const { doc, spans } = mapped(src);
		expect(sourceToPm(spans, src.indexOf('Intro'))).toBe(posOf(doc, 'Intro'));
		expect(sourceToPm(spans, src.indexOf('note'))).toBe(posOf(doc, 'note'));
		expect(sourceToPm(spans, src.indexOf('a = b'))).toBe(posOf(doc, 'a = b'));
	});

	it('a url stands for the whole call', () => {
		const { doc, spans, src } = mapped('See \\url{http://x.y/a%b} now.\n');
		const at = posOf(doc, 'http');
		expect(pmToSource(spans, at)).toBe(src.indexOf('\\url'));
		expect(pmToSource(spans, at + 'http://x.y/a%b'.length)).toBe(src.indexOf('}') + 1);
	});
});
