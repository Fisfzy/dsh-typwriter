// Reading and writing a listing's language in the LaTeX source.
//
// The language attr drives editor highlighting. For markdown and typst it IS the source (the fence
// info string), so it round-trips for free; LaTeX keeps it in the environment's options, which the
// importer never read - a listing that plainly said [language=Python] opened as plain text, and
// choosing a language from the block's own picker was forgotten on the next reload.
//
// Writing back is the half that can damage a file, so the rule under test is: touch the language
// key and nothing else.
import { describe, it, expect } from 'vitest';
import { listingLanguage, canSetListingLanguage, argsWithLanguage } from '$lib/languages/latex/parser/listingLanguage';

describe('listingLanguage', () => {
	it('reads the listings option', () => {
		expect(listingLanguage('lstlisting', '[language=Python]')).toBe('Python');
		expect(listingLanguage('lstlisting', '[language={Python}]')).toBe('Python');
		expect(listingLanguage('lstlisting', '[caption=Fib, language=C++, frame=single]')).toBe('C++');
	});

	// listings names a dialect before the language: language=[LaTeX]TeX is still TeX
	it('sees past a dialect', () => {
		expect(listingLanguage('lstlisting', '[language=[LaTeX]TeX]')).toBe('TeX');
	});

	it("reads minted's mandatory argument, options or not", () => {
		expect(listingLanguage('minted', '{python}')).toBe('python');
		expect(listingLanguage('minted', '[linenos,frame=lines]{ruby}')).toBe('ruby');
	});

	it('finds nothing where there is nothing', () => {
		expect(listingLanguage('verbatim', '')).toBeNull();
		expect(listingLanguage('lstlisting', '[caption=Fib]')).toBeNull();
	});
});

describe('canSetListingLanguage', () => {
	it('is true where the source has somewhere to put it', () => {
		for (const env of ['fence', 'minted', 'lstlisting']) expect(canSetListingLanguage(env), env).toBe(true);
	});

	// no options, and rewriting it as lstlisting would silently need \usepackage{listings}
	it('is false for verbatim, which gets a label instead of a picker', () => {
		expect(canSetListingLanguage('verbatim')).toBe(false);
		expect(canSetListingLanguage('')).toBe(false);
	});
});

describe('argsWithLanguage', () => {
	it('writes a fence info string, keeping what follows the language', () => {
		expect(argsWithLanguage('fence', 'python', 'Rust')).toBe('rust');
		expect(argsWithLanguage('fence', '', 'Rust')).toBe('rust');
		expect(argsWithLanguage('fence', 'python title="x" {1,3}', 'Rust')).toBe('rust title="x" {1,3}');
	});

	it("replaces minted's argument, keeping its options", () => {
		expect(argsWithLanguage('minted', '{python}', 'Ruby')).toBe('{ruby}');
		expect(argsWithLanguage('minted', '[linenos]{python}', 'Ruby')).toBe('[linenos]{ruby}');
	});

	// the point of rewriting in place rather than regenerating: everything else in there was put
	// there on purpose and the editor cannot model it
	it('replaces the listings key and leaves every other option alone', () => {
		expect(argsWithLanguage('lstlisting', '[caption=Fib, language=Python, frame=single]', 'Ruby')).toBe(
			'[caption=Fib, language=Ruby, frame=single]'
		);
		expect(argsWithLanguage('lstlisting', '[language=[LaTeX]TeX]', 'Ruby')).toBe('[language=Ruby]');
	});

	it('adds the key when the listing had none', () => {
		expect(argsWithLanguage('lstlisting', '', 'Ruby')).toBe('[language=Ruby]');
		expect(argsWithLanguage('lstlisting', '[caption=Fib]', 'Ruby')).toBe('[language=Ruby, caption=Fib]');
	});

	it('round-trips with the reader, which is the whole contract', () => {
		for (const [env, args] of [
			['lstlisting', '[language=Python]'],
			['lstlisting', '[caption=Fib]'],
			['lstlisting', ''],
			['minted', '{python}'],
			['minted', '[linenos]{python}']
		] as const) {
			const written = argsWithLanguage(env, args, 'Ruby');
			expect(listingLanguage(env, written)?.toLowerCase(), `${env} ${args}`).toBe('ruby');
		}
	});
});
