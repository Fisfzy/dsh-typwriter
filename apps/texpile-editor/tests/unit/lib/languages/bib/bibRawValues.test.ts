// `journal = foo` (an @string abbreviation) made the whole file unparseable, and regeneration
// flattened `"P" # " and " # "Q"` into {P and Q} and quoted `month = mar` as {mar}
import { describe, it, expect } from 'vitest';
import { parseBibtexTokens } from '$lib/languages/bib/bibtexParser';
import { toBibtex } from '$lib/languages/bib/bibtexWriter';

const SRC = `@string{jml = {Journal of ML}}
@article{k,
  author = "P" # " and " # "Q",
  journal = jml,
  month = mar,
  year = 2020,
  title = {T}
}
`;

describe('bib values written with macros or concatenation', () => {
	it('parse, and read as the joined value', () => {
		const tokens = parseBibtexTokens(SRC);
		const entry = tokens.find((t) => t.kind === 'entry');
		expect(entry?.kind).toBe('entry');
		if (entry?.kind !== 'entry') return;
		expect(entry.entry.entryTags.author).toMatch(/^P\s*and Q$/);
		expect(entry.entry.entryTags.journal).toBe('jml');
		expect(entry.entry.entryTags.month).toBe('mar');
	});

	it('write back as they were written', () => {
		const tokens = parseBibtexTokens(SRC);
		const entry = tokens.find((t) => t.kind === 'entry');
		if (entry?.kind !== 'entry') throw new Error('no entry');
		const out = toBibtex([entry.entry]);
		expect(out).toContain('author = "P" # " and " # "Q"');
		expect(out).toContain('journal = jml');
		expect(out).toContain('month = mar');
		expect(out).toContain('title = {T}');
	});
});
