import { describe, it, expect } from 'vitest';
import { buildAnchor, resolveAnchor } from '$lib/comments/anchor';

const doc = 'The first paragraph mentions gravity.\nThe second paragraph mentions gravity too.\n';

describe('buildAnchor', () => {
	it('keeps the quote with context either side', () => {
		const at = doc.indexOf('first paragraph');
		const a = buildAnchor(doc, at, at + 'first paragraph'.length);
		expect(a.quote).toBe('first paragraph');
		expect(a.prefix).toBe('The ');
		expect(a.suffix.startsWith(' mentions gravity')).toBe(true);
	});

	it('does not run off either end of the document', () => {
		const a = buildAnchor(doc, 0, 3);
		expect(a.prefix).toBe('');
		const end = buildAnchor(doc, doc.length - 1, doc.length);
		expect(end.suffix).toBe('');
	});
});

describe('resolveAnchor', () => {
	it('reports an untouched document as exact', () => {
		const at = doc.indexOf('gravity');
		const a = buildAnchor(doc, at, at + 7);
		expect(resolveAnchor(doc, a)).toEqual({ from: at, to: at + 7, exact: true, weak: false });
	});

	it('follows the quote when text is inserted above it', () => {
		const at = doc.indexOf('second paragraph');
		const a = buildAnchor(doc, at, at + 'second paragraph'.length);
		const edited = 'A new opening line.\n' + doc;
		const hit = resolveAnchor(edited, a);
		expect(hit).not.toBeNull();
		expect(hit!.exact).toBe(false);
		expect(edited.slice(hit!.from, hit!.to)).toBe('second paragraph');
		expect(hit!.from).toBe(edited.indexOf('second paragraph'));
	});

	it('picks the right copy of a repeated quote using its context', () => {
		// "gravity" appears twice; the anchor is on the SECOND one
		const second = doc.lastIndexOf('gravity');
		const a = buildAnchor(doc, second, second + 7);
		// push everything down so the remembered offset is wrong for both copies
		const edited = 'Padding.\n'.repeat(4) + doc;
		const hit = resolveAnchor(edited, a);
		expect(hit).not.toBeNull();
		expect(hit!.from).toBe(edited.lastIndexOf('gravity'));
	});

	it('orphans a comment whose text is gone rather than guessing', () => {
		const at = doc.indexOf('gravity');
		const a = buildAnchor(doc, at, at + 7);
		expect(resolveAnchor('An entirely different document.', a)).toBeNull();
	});

	it('places a stub of a quote by its surroundings, not by the stub', () => {
		const a = buildAnchor(doc, 0, 2);
		expect(resolveAnchor(doc, a)).toMatchObject({ from: 0, to: 2, exact: true });
		expect(resolveAnchor('An entirely different document.', a)).toBeNull();
	});

	describe('a point', () => {
		const at = doc.indexOf(' mentions gravity.');
		const point = buildAnchor(doc, at, at);
		it('is exact while its neighbours stand', () => {
			expect(point.quote).toBe('');
			expect(resolveAnchor(doc, point)).toMatchObject({ from: at, to: at, exact: true, weak: false });
		});
		it('follows its neighbours when text before it changes', () => {
			const edited = 'A new opening line.\n' + doc;
			expect(resolveAnchor(edited, point)).toMatchObject({ from: at + 20, to: at + 20, exact: false, weak: false });
		});
		it('detaches once both neighbours are gone', () => {
			expect(resolveAnchor('Something else entirely, twice over.\n', point)).toBeNull();
		});
	});

	it('orphans a quote that repeats past the scan cap instead of ranking the first 500', () => {
		// a comment on \begin, in a document with far more of them than the scan collects. The
		// commented one is near the END, so scoring the truncated hit list would answer with a copy
		// from the top of the file - confidently, and wrongly.
		const body = '\\begin{itemize}\n\\item x\n\\end{itemize}\n'.repeat(600);
		const target = '\\begin{figure}[h]\n\\centering\n';
		const src = body + target + body;
		const at = src.indexOf(target);
		const a = buildAnchor(src, at, at + 6); // just "\begin"
		// the offsets still hold, so the fast path answers without searching
		expect(resolveAnchor(src, a)).toEqual({ from: at, to: at + 6, exact: true, weak: false });
		// push everything down and it has to search - and must decline
		expect(resolveAnchor('padding\n' + src, a)).toBeNull();
	});
});
