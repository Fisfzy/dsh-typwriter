// Log paths when the compile did not run in the workspace root.
//
// latexmk -cd compiles in the main file's own folder, so the engine prints its file:line errors
// relative to THAT. A real run of latex/main.tex with a bad command in latex/parts/body.tex prints
// "./parts/body.tex:3" - verbatim, from the .log this fixture is taken from. Resolved against the
// root that is /proj/parts/body.tex, a file which does not exist, so the Problems row jumps nowhere.
//
// Rebasing once at parse time keeps every consumer downstream (Problems panel, guest bridge, MCP)
// resolving against the root exactly as before.
import { describe, it, expect } from 'vitest';
import { rebaseLogFile, resolveLogPath } from '$lib/stores/compileLogStore';

const ROOT = '/proj';
const BASE = '/proj/latex'; // where latexmk -cd ran

describe('rebaseLogFile', () => {
	it('makes an engine-printed path root-relative', () => {
		expect(rebaseLogFile('./parts/body.tex', BASE, ROOT)).toBe('latex/parts/body.tex');
		expect(rebaseLogFile('preamble.tex', BASE, ROOT)).toBe('latex/preamble.tex');
	});

	it('resolves .. rather than giving up on it', () => {
		// a shared file one level up is inside the workspace, so it stays clickable
		expect(rebaseLogFile('../shared/macros.tex', BASE, ROOT)).toBe('shared/macros.tex');
	});

	it('is an identity for a compile that ran at the root', () => {
		expect(rebaseLogFile('./chapters/one.tex', ROOT, ROOT)).toBe('chapters/one.tex');
		expect(rebaseLogFile('main.tex', ROOT, ROOT)).toBe('main.tex');
	});

	it('relativizes an absolute path that lies inside the workspace', () => {
		expect(rebaseLogFile('/proj/latex/main.tex', BASE, ROOT)).toBe('latex/main.tex');
	});

	// TeX installation files are shown but not clickable; rewriting them would only lose the
	// information that they are foreign
	it('leaves paths outside the workspace untouched', () => {
		expect(rebaseLogFile('/usr/share/texmf/tex/latex/base/article.cls', BASE, ROOT)).toBe('/usr/share/texmf/tex/latex/base/article.cls');
		expect(rebaseLogFile('../../elsewhere/x.tex', BASE, ROOT)).toBe('../../elsewhere/x.tex');
	});

	it('handles Windows separators and drive letters', () => {
		expect(rebaseLogFile('.\\parts\\body.tex', 'C:\\proj\\latex', 'C:\\proj')).toBe('latex/parts/body.tex');
		expect(rebaseLogFile('C:/proj/latex/main.tex', 'C:/proj/latex', 'C:/proj')).toBe('latex/main.tex');
	});

	it('feeds resolveLogPath, which is what the Problems panel actually calls', () => {
		expect(resolveLogPath(ROOT, rebaseLogFile('./parts/body.tex', BASE, ROOT))).toBe('/proj/latex/parts/body.tex');
	});
});
