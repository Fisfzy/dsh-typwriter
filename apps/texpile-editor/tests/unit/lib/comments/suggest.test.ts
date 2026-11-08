import { describe, it, expect } from 'vitest';
import { formatChange } from '$lib/comments/suggest';
import { parseLatexRegion } from '$lib/workspace/latexRoundtrip';
import { parseMarkdownRegion } from '$lib/languages/markdown/visual/roundtrip';
import { parseTypstRegion } from '$lib/languages/typst/visual/roundtrip';

const tex = (src: string) => parseLatexRegion(src);

describe('a format change', () => {
	it('is the same words with other formatting, named when the words say', () => {
		expect(formatChange('\\textbf{second one}', 'second one', tex)).toEqual({ words: 'second one', added: ['bold'], removed: [] });
		expect(formatChange('\\textbf{second one}', '\\textit{second one}', tex)).toEqual({
			words: 'second one',
			added: ['bold'],
			removed: ['italic']
		});
		expect(formatChange('second one', '\\textbf{second one}', tex)).toEqual({ words: 'second one', added: [], removed: ['bold'] });
		expect(formatChange('\\textit{x}', '\\emph{x}', tex)).toEqual({ words: 'x', added: [], removed: [] });
		expect(formatChange('{\\sethlcolor{yellow}\\hl{x}}', 'x', tex)?.added).toEqual(['highlight']);
		expect(formatChange('\\textcolor{red}{x}', 'x', tex)?.added).toEqual(['color']);
		expect(formatChange('\\href{https://x.y}{x}', 'x', tex)?.added).toEqual(['link']);
		expect(formatChange('$a$ \\textbf{b}', '$a$ b', tex)?.words).toBe('\u{FFFC} b');
		expect(formatChange('**x**', 'x', parseMarkdownRegion)?.added).toEqual(['bold']);
		expect(formatChange('~~x~~', 'x', parseMarkdownRegion)?.added).toEqual(['strikethrough']);
		expect(formatChange('*x*', 'x', parseTypstRegion)?.added).toEqual(['bold']);
		expect(formatChange('#underline[x]', 'x', parseTypstRegion)?.added).toEqual(['underline']);
	});

	it('is not other words, half of a gesture, an addition or a deletion', () => {
		expect(formatChange('\\textbf{other}', 'second', tex)).toBeNull();
		expect(formatChange('\\textbf{second', 'second', tex)).toBeNull();
		expect(formatChange('}', '', tex)).toBeNull();
		expect(formatChange('\\textbf{second}', '', tex)).toBeNull();
		expect(formatChange('', 'second', tex)).toBeNull();
		expect(formatChange('**x', 'x', parseMarkdownRegion)).toBeNull();
	});
});
