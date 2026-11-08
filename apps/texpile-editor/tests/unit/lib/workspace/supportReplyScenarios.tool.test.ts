// The two fixes we are about to send a user, run against the real path-detection code.
//
// Their setup: parent/{libs,FOO}, main file FOO/book.typ, imports from /libs. The CLI halves are
// proven against tinymist directly (a root above the cwd never works, so the workspace must sit at
// the root); these pin the app halves: what the box does with {main}, where the preview and log
// watcher will actually look, and that the Advanced overrides land where we told them.
import { describe, it, expect } from 'vitest';
import * as cc from '$lib/workspace/compileCommand';
import { isTypstCommand } from '$lib/workspace/typstCommand';

const PARENT = 'C:/proj/parent';
const FOO_MAIN = 'C:/proj/parent/FOO/book.typ';

describe('fix 1: parent folder as the workspace', () => {
	const cmd = 'tinymist compile --root . {main} FOO/output/book.pdf 2>FOO/output/book.log';

	it('is recognised as a typst command, so detection engages at all', () => {
		expect(isTypstCommand(cmd)).toBe(true);
	});

	it('the preview watches the PDF the command really writes', () => {
		expect(cc.expectedPdfPath(cmd, PARENT, FOO_MAIN)).toBe('C:/proj/parent/FOO/output/book.pdf');
	});

	it('the Problems panel reads the log the redirect really writes', () => {
		expect(cc.expectedLogPath(cmd, PARENT, FOO_MAIN)).toBe('C:/proj/parent/FOO/output/book.log');
	});
});

describe('fix 2: keep the cd command, override the outputs', () => {
	// lane detection reads the head of the line, so this is (knowingly) not seen as typst -
	// exactly why the overrides are needed
	const cmd = 'cd .. ; tinymist compile --root . ./FOO/book.typ ./FOO/output/book.pdf 2>./FOO/output/book.log';
	const FOO = 'C:/proj/parent/FOO';

	it('the pdf override wins over the (wrong) detected path', () => {
		expect(cc.expectedPdfPath(cmd, FOO, FOO + '/book.typ', 'output/book.pdf')).toBe('C:/proj/parent/FOO/output/book.pdf');
	});

	it('the log override wins the same way', () => {
		expect(cc.expectedLogPath(cmd, FOO, FOO + '/book.typ', { log: 'output/book.log' })).toBe('C:/proj/parent/FOO/output/book.log');
	});
});
