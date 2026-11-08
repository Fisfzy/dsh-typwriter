// the Typst source map, both ways: every text run of a parse is its bytes, and a document written
// out afresh maps its runs to the text it made
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Node as PMNode } from 'prosemirror-model';
import { parseTypstFile, serializeTypstFileDetailed } from '$lib/languages/typst/visual/roundtrip';
import { pmToSource, sourceToPm } from '$lib/editor/visual/sourceSpans';
import { withoutOrigins } from '$lib/editor/visual/parseOrigins';
import { auditMap, coverage } from '../../editor/visual/sourceMapAudit';

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir).sort()) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else if (name.endsWith('.typ')) out.push(p);
	}
	return out;
}

const files = walk(join(__dirname, '../../../../fixtures'));

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

describe('the Typst parser source map', () => {
	it('is exact on every fixture and covers its prose', () => {
		expect(files.length).toBeGreaterThan(0);
		const failures: string[] = [];
		const audits = files.map((f) => {
			const text = readFileSync(f, 'utf8');
			const { doc, map } = parseTypstFile(text);
			const a = auditMap(doc, text, map.leaves);
			for (const p of a.problems.slice(0, 5)) failures.push(`${f}: ${p}`);
			return a;
		});
		expect(failures).toEqual([]);
		const { prose, nodes } = coverage(audits);
		console.log(
			`typst parser map coverage over ${files.length} files: prose ${(prose * 100).toFixed(1)}%, leaf nodes ${(nodes * 100).toFixed(1)}%`
		);
		expect(prose).toBeGreaterThan(0.95);
		expect(nodes).toBeGreaterThan(0.9);
	});

	it('maps prose, a shorthand and a formula', () => {
		const src = 'Hello _world_ --- see $x^2$ and `code` here.\n';
		const { doc, map } = parseTypstFile(src);
		const spans = map.leaves;
		expect(sourceToPm(spans, src.indexOf('world'))).toBe(posOf(doc, 'world'));
		expect(pmToSource(spans, posOf(doc, 'here') + 2)).toBe(src.indexOf('here') + 2);
		// the dash stands for its three bytes
		const dash = posOf(doc, '—');
		expect(pmToSource(spans, dash, 1)).toBe(src.indexOf('---'));
		expect(pmToSource(spans, dash + 1, -1)).toBe(src.indexOf('---') + 3);
		expect(sourceToPm(spans, src.indexOf('code'))).toBe(posOf(doc, 'code'));
		expect(pmToSource(spans, posOf(doc, 'x^2') - 1, 1)).toBe(src.indexOf('$x^2$'));
	});
});

describe('the Typst serializer source map', () => {
	it('carries an untouched document’s runs to where they were', () => {
		const failures: string[] = [];
		for (const f of files) {
			const text = readFileSync(f, 'utf8');
			const parsed = parseTypstFile(text);
			const out = serializeTypstFileDetailed(parsed, parsed.doc);
			if (out.text !== text) continue; // the byte round trip has its own oracle
			if (JSON.stringify(out.map.leaves) !== JSON.stringify(parsed.map.leaves)) failures.push(`${f}: leaves differ`);
		}
		expect(failures).toEqual([]);
	});

	it('is exact on a regenerated document and covers its prose', () => {
		const failures: string[] = [];
		const audits = files.map((f) => {
			const parsed = parseTypstFile(readFileSync(f, 'utf8'));
			const doc = withoutOrigins(parsed.doc);
			const out = serializeTypstFileDetailed(parsed, doc);
			const a = auditMap(doc, out.text, out.map.leaves);
			for (const p of a.problems.slice(0, 5)) failures.push(`${f}: ${p}`);
			return a;
		});
		expect(failures).toEqual([]);
		const { prose, nodes } = coverage(audits);
		console.log(
			`typst serializer map coverage over ${files.length} regenerated files: prose ${(prose * 100).toFixed(1)}%, leaf nodes ${(nodes * 100).toFixed(1)}%`
		);
		expect(prose).toBeGreaterThan(0.9);
		expect(nodes).toBeGreaterThan(0.8);
	});

	it('maps a regenerated paragraph both ways, escapes included', () => {
		const parsed = parseTypstFile('Hello _world_, 100\\% of $x$ and a\\*b.\n');
		const doc = withoutOrigins(parsed.doc);
		const { text, map } = serializeTypstFileDetailed(parsed, doc);
		const world = posOf(doc, 'world');
		expect(pmToSource(map.leaves, world + 1)).toBe(text.indexOf('world') + 1);
		expect(sourceToPm(map.leaves, text.indexOf('world') + 3)).toBe(world + 3);
		const star = posOf(doc, '*');
		expect(pmToSource(map.leaves, star, 1)).toBe(text.indexOf('\\*'));
		expect(pmToSource(map.leaves, star + 1, -1)).toBe(text.indexOf('\\*') + 2);
	});
});
