// Applying LSP TextEdits. The first case is tinymist 0.15.2's REAL answer to formatting a messy
// document, captured from a live LSP session - typstyle minimizes edits to the changed region, so
// the range arithmetic here is what stands between "formatted" and "spliced garbage".
import { describe, it, expect } from 'vitest';
import { applyTextEdits } from '$lib/languages/typst/intellisense/textEdits';

describe('applyTextEdits', () => {
	it('applies tinymist`s actual minimized formatting edit correctly', () => {
		const messy = '#let  x   =  1\n= Heading\nSome   text with    spaces.\n#if x  ==  1 [\n  ok\n]\n';
		// captured verbatim from tinymist 0.15.2 with formatterMode: 'typstyle'
		const edits = [
			{
				newText: 'x = 1\n= Heading\nSome   text with    spaces.\n#if x ==',
				range: { start: { line: 0, character: 5 }, end: { line: 3, character: 10 } }
			}
		];
		expect(applyTextEdits(messy, edits)).toBe('#let x = 1\n= Heading\nSome   text with    spaces.\n#if x == 1 [\n  ok\n]\n');
	});

	it('applies multiple edits back-to-front so earlier ranges stay valid', () => {
		const text = 'aaa\nbbb\nccc\n';
		const edits = [
			{ newText: 'X', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } },
			{ newText: 'Y', range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } } }
		];
		expect(applyTextEdits(text, edits)).toBe('X\nbbb\nY\n');
	});

	it('treats a position past the last line as end-of-document', () => {
		const text = 'one\ntwo';
		const edits = [{ newText: '!', range: { start: { line: 5, character: 0 }, end: { line: 9, character: 0 } } }];
		expect(applyTextEdits(text, edits)).toBe('one\ntwo!');
	});

	it('clamps a character past the line end instead of spilling onto the next line', () => {
		const text = 'ab\ncd\n';
		const edits = [{ newText: 'X', range: { start: { line: 0, character: 99 }, end: { line: 1, character: 0 } } }];
		expect(applyTextEdits(text, edits)).toBe('abXcd\n');
	});

	it('counts positions in UTF-16 code units, as LSP does', () => {
		// the emoji is two code units; an edit after it must land after the whole glyph
		const text = '💡x\n';
		const edits = [{ newText: 'Y', range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } } }];
		expect(applyTextEdits(text, edits)).toBe('💡Y\n');
	});

	it('inserts at a zero-width range', () => {
		const text = 'ab\n';
		const edits = [{ newText: '-', range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } } }];
		expect(applyTextEdits(text, edits)).toBe('a-b\n');
	});
});
