// the LaTeX serializer's source map: an untouched document lands its runs where they were, and a
// document written out afresh has every text run equal to its bytes and no byte claimed twice
import { describe, it, expect } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { parseLatexFile, serializeLatexFileDetailed } from '$lib/workspace/latexRoundtrip';
import { pmToSource, sourceToPm } from '$lib/editor/visual/sourceSpans';
import { withoutOrigins } from '$lib/editor/visual/parseOrigins';
import { auditMap, coverage } from '../../../editor/visual/sourceMapAudit';
import { readTex, texFiles } from '../texFixtures';

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
	if (found < 0) throw new Error(`no text ${JSON.stringify(needle)}`);
	return found;
}

describe('the LaTeX serializer source map', () => {
	it('carries an untouched document\u2019s runs to where they were', () => {
		const failures: string[] = [];
		for (const f of texFiles) {
			const text = readTex(f);
			const parsed = parseLatexFile(text);
			const out = serializeLatexFileDetailed(parsed, parsed.doc);
			if (out.text !== text) continue; // the byte round trip has its own oracle
			if (JSON.stringify(out.map.leaves) !== JSON.stringify(parsed.map.leaves)) failures.push(`${f}: leaves differ`);
			if (JSON.stringify(out.map.blocks) !== JSON.stringify(parsed.map.blocks)) failures.push(`${f}: blocks differ`);
		}
		expect(failures).toEqual([]);
	});

	it('is exact on a regenerated document: text runs are their bytes and no byte is claimed twice', () => {
		const failures: string[] = [];
		const audits = [];
		for (const f of texFiles) {
			const parsed = parseLatexFile(readTex(f));
			const doc = withoutOrigins(parsed.doc);
			const out = serializeLatexFileDetailed(parsed, doc);
			const a = auditMap(doc, out.text, out.map.leaves);
			audits.push(a);
			for (const p of a.problems.slice(0, 5)) failures.push(`${f}: ${p}`);
		}
		expect(failures).toEqual([]);
		const { prose, nodes } = coverage(audits);
		console.log(
			`serializer map coverage over ${texFiles.length} regenerated files: prose ${(prose * 100).toFixed(1)}%, leaf nodes ${(nodes * 100).toFixed(1)}%`
		);
		expect(prose).toBeGreaterThan(0.9);
		expect(nodes).toBeGreaterThan(0.9);
	});

	it('maps a regenerated paragraph both ways', () => {
		const parsed = parseLatexFile('Hello \\emph{world}, 100\\% of $x$.\n');
		const doc = withoutOrigins(parsed.doc);
		const { text, map } = serializeLatexFileDetailed(parsed, doc);
		expect(text.startsWith('Hello \\emph{world}, 100\\% of $x$.')).toBe(true);
		const world = posOf(doc, 'world');
		expect(pmToSource(map.leaves, world + 1)).toBe(text.indexOf('world') + 1);
		expect(sourceToPm(map.leaves, text.indexOf('world') + 3)).toBe(world + 3);
		const percent = posOf(doc, '%');
		expect(pmToSource(map.leaves, percent)).toBe(text.indexOf('\\%'));
		expect(pmToSource(map.leaves, percent + 1)).toBe(text.indexOf('\\%') + 2);
		expect(sourceToPm(map.leaves, text.indexOf('x$'))).toBe(posOf(doc, 'x'));
	});

	it('keeps a bare url as one call whose characters are the address', () => {
		const parsed = parseLatexFile('See \\url{http://x.y/a_b} now.\n');
		const doc = withoutOrigins(parsed.doc);
		const { text, map } = serializeLatexFileDetailed(parsed, doc);
		expect(text).toContain('\\url{http://x.y/a_b}');
		const at = posOf(doc, 'http');
		expect(pmToSource(map.leaves, at + 4)).toBe(text.indexOf('http') + 4);
	});
});
