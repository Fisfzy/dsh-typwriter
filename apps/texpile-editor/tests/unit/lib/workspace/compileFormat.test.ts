// @vitest-environment jsdom
// The typesetter is decided by the main file's extension and by nothing else. There used to be a
// switch that could override it, and every one of these cases is a thing that switch could get
// wrong - so they are pinned here rather than left to the next person to rediscover.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/workspace/fileSystem', () => ({
	joinPath: (a: string, b: string) => `${a}/${b}`,
	relativeTo: (root: string, p: string) => p.slice(root.length + 1),
	samePath: (a: string, b: string) => a === b,
	basename: (p: string) => p.split(/[\\/]/).pop() ?? p,
	readTextFile: () => Promise.reject(new Error('no fs in this test')),
	writeTextFile: () => Promise.resolve(),
	statFile: () => Promise.resolve({ exists: false, mtimeMs: 0, size: 0 })
}));

const { effectiveCompileFormat, setMainFile, mainFile, workspaceRoot } = await import('$lib/workspace/workspaceStore');
const { compileConfig, projectConfigSync } = await import('$lib/workspace/projectConfigSync.svelte');
const { resolveFormatCommand, resolveCompileCommand } = await import('$lib/workspace/compilePipeline.svelte');

const ROOT = 'C:/proj';

beforeEach(() => {
	localStorage.clear();
	workspaceRoot.current = ROOT;
	mainFile.current = null;
	projectConfigSync.reset();
});

describe('which typesetter a folder builds with', () => {
	it('reads the main file extension, either case', () => {
		expect(effectiveCompileFormat('C:/proj/main.typ')).toBe('typst');
		expect(effectiveCompileFormat('C:/proj/MAIN.TYP')).toBe('typst');
		expect(effectiveCompileFormat('C:/proj/main.tex')).toBe('latex');
	});

	// .ltx, .Rnw, .dtx and friends are all LaTeX; only Typst has a single extension, so everything
	// that is not .typ belongs in the other lane
	it('sends every non-.typ extension to latex', () => {
		for (const p of ['a.ltx', 'a.Rnw', 'a.dtx', 'a.tex', 'notes.txt']) expect(effectiveCompileFormat(`C:/proj/${p}`)).toBe('latex');
	});

	it('falls to latex with no main file, which is only ever a display default', () => {
		expect(effectiveCompileFormat(null)).toBe('latex');
	});
});

describe('the two command lanes (adopted state)', () => {
	/**
	 * The whole reason both lanes exist. A thesis with a .tex and a colleague's .typ figure script
	 * keeps both commands, and changing the main file changes which one runs - where a single slot
	 * would have overwritten one with the other.
	 */
	it('keeps both commands and lets the main file pick between them', () => {
		projectConfigSync.setCommand(ROOT, 'latex', 'latexmk -pdf {main}');
		projectConfigSync.setCommand(ROOT, 'typst', 'typst compile {main} --root .');

		expect(resolveCompileCommand('C:/proj/main.tex')).toBe('latexmk -pdf {main}');
		expect(resolveCompileCommand('C:/proj/main.typ')).toBe('typst compile {main} --root .');
		// neither was consumed by reading the other
		expect(compileConfig.current.latex.command).toBe('latexmk -pdf {main}');
		expect(compileConfig.current.typst.command).toBe('typst compile {main} --root .');
	});

	it('generates the typst default rather than handing a .typ project a latexmk line', () => {
		const cmd = resolveCompileCommand('C:/proj/main.typ');
		expect(cmd).toMatch(/tinymist/);
		expect(cmd).not.toMatch(/latexmk/);
	});

	it('defaults the latex lane to the stock command, since the global slot is gone', () => {
		expect(resolveFormatCommand('latex')).toMatch(/^latexmk /);
	});

	it('a command the user typed is trusted, so reopening never asks them to approve their own', async () => {
		const { isCommandTrusted } = await import('$lib/workspace/workspaceStore');
		projectConfigSync.setCommand(ROOT, 'latex', 'latexmk -pdf {main}');
		expect(isCommandTrusted(ROOT, 'latex', 'latexmk -pdf {main}')).toBe(true);
	});

	it('clearing a lane falls back to that lane`s default without touching the other', () => {
		projectConfigSync.setCommand(ROOT, 'latex', 'xelatex {main}');
		projectConfigSync.setCommand(ROOT, 'typst', 'typst compile {main}');
		projectConfigSync.setCommand(ROOT, 'latex', null);
		expect(resolveFormatCommand('latex')).toMatch(/^latexmk /);
		expect(compileConfig.current.typst.command).toBe('typst compile {main}');
	});
});

describe('setMainFile switches the typesetter', () => {
	// the only gesture that changes lane, now that the switch is gone
	it('moves the effective lane when the main file changes extension', () => {
		setMainFile(ROOT, `${ROOT}/main.tex`);
		expect(effectiveCompileFormat(`${ROOT}/main.tex`)).toBe('latex');
		setMainFile(ROOT, `${ROOT}/main.typ`);
		expect(effectiveCompileFormat(`${ROOT}/main.typ`)).toBe('typst');
	});
});
