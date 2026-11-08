// @vitest-environment jsdom
// A folder opened for the first time landed on the alphabetically first .tex, which on some
// projects is a generated multi-megabyte file rather than the main document.
import { describe, it, expect, beforeEach } from 'vitest';
import { landingFile } from '$lib/workspace/landingFile';
import { setMainFile, mainFile } from '$lib/workspace/workspaceStore';
import type { TexFile } from '$lib/workspace/fileSystem';

const ROOT = 'C:/proj';
const file = (rel: string): TexFile => ({ path: `${ROOT}/${rel}`, name: rel.split('/').pop()!, relPath: rel });
const texts: Record<string, string> = {
	[`${ROOT}/appendix-tables.tex`]: '\\section{A}\n'.repeat(3),
	[`${ROOT}/main.tex`]: '\\documentclass{article}\\begin{document}\\input{appendix-tables}\\end{document}'
};
const read = async (p: string) => texts[p] ?? '';

beforeEach(() => {
	localStorage.clear();
	mainFile.current = null;
});

describe('landingFile', () => {
	it('lands on the detected main file, not the first of the scan', async () => {
		expect(await landingFile(ROOT, [file('appendix-tables.tex'), file('main.tex')], read)).toBe(`${ROOT}/main.tex`);
	});

	it('a chosen main file wins over detection', async () => {
		setMainFile(ROOT, `${ROOT}/appendix-tables.tex`);
		expect(await landingFile(ROOT, [file('appendix-tables.tex'), file('main.tex')], read)).toBe(`${ROOT}/appendix-tables.tex`);
	});

	it('does not star anything: the landing is not a main-file choice', async () => {
		await landingFile(ROOT, [file('appendix-tables.tex'), file('main.tex')], read);
		expect(mainFile.current).toBeNull();
	});

	it('falls back to the first file when there is nothing to detect', async () => {
		expect(await landingFile(ROOT, [], read)).toBeNull();
		expect(await landingFile(ROOT, [file('notes.tex')], read)).toBe(`${ROOT}/notes.tex`);
	});
});
