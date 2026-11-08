// The pieces of Typst rename that can be wrong without a server saying so: where in the document
// we tell tinymist to look, and how we read the WorkspaceEdit it answers with. The bug being
// fixed is a DROPPED file - lsp-client's own command skips any file it has no editor view for -
// so "every file in the reply comes back out" is the assertion that matters most here.
import { describe, it, expect } from 'vitest';
import { positionAt, editRange, applyTextEdits } from '$lib/languages/typst/intellisense/textEdits';
import { renameEditsFrom, pathFromUri } from '$lib/languages/typst/intellisense/lspClient';

describe('positionAt', () => {
	const doc = 'one\ntwo\n\nfour';

	it('finds the line and character of an offset', () => {
		expect(positionAt(doc, 0)).toEqual({ line: 0, character: 0 });
		expect(positionAt(doc, 4)).toEqual({ line: 1, character: 0 });
		expect(positionAt(doc, 6)).toEqual({ line: 1, character: 2 });
		expect(positionAt(doc, 8)).toEqual({ line: 2, character: 0 }); // the empty line
		expect(positionAt(doc, 9)).toEqual({ line: 3, character: 0 });
	});

	it('clamps an out-of-range offset instead of inventing a line', () => {
		expect(positionAt(doc, -5)).toEqual({ line: 0, character: 0 });
		expect(positionAt(doc, 999)).toEqual({ line: 3, character: 4 });
	});

	it('counts in UTF-16 code units, as LSP does', () => {
		// the emoji is two code units, so the character after it is at 2, not 1
		expect(positionAt('ab\n💡x', 6)).toEqual({ line: 1, character: 3 });
	});

	it('round-trips with the offsets applyTextEdits resolves', () => {
		for (const offset of [0, 3, 4, 8, 12]) {
			const pos = positionAt(doc, offset);
			const { from } = editRange(doc, { range: { start: pos, end: pos }, newText: '' });
			expect(from).toBe(offset);
		}
	});
});

describe('renameEditsFrom', () => {
	const edit = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'new' };

	it('returns every file in a `changes` reply, not just the first', () => {
		const out = renameEditsFrom({
			changes: {
				'file:///p/a.typ': [edit],
				'file:///p/sub/b.typ': [edit, edit],
				'file:///p/c.typ': [edit]
			}
		});
		expect(out.map((o) => o.path).sort()).toEqual(['/p/a.typ', '/p/c.typ', '/p/sub/b.typ']);
		expect(out.reduce((n, o) => n + o.edits.length, 0)).toBe(4);
	});

	it('reads the versioned `documentChanges` form too', () => {
		const out = renameEditsFrom({ documentChanges: [{ textDocument: { uri: 'file:///p/a.typ' }, edits: [edit] }] });
		expect(out).toEqual([{ path: '/p/a.typ', edits: [edit] }]);
	});

	it('writes a file named by both forms only once', () => {
		const out = renameEditsFrom({
			changes: { 'file:///p/a.typ': [edit] },
			documentChanges: [{ textDocument: { uri: 'file:///p/a.typ' }, edits: [edit, edit] }]
		});
		expect(out).toEqual([{ path: '/p/a.typ', edits: [edit] }]);
	});

	it('skips empty entries and a null reply', () => {
		expect(renameEditsFrom(null)).toEqual([]);
		expect(renameEditsFrom({ changes: { 'file:///p/a.typ': [] } })).toEqual([]);
		expect(renameEditsFrom({ documentChanges: [{ textDocument: {}, edits: [edit] }] })).toEqual([]);
	});

	it('decodes URIs back to paths, including Windows drives and escaped segments', () => {
		expect(pathFromUri('file:///C:/dev/my%20project/a.typ')).toBe('C:/dev/my project/a.typ');
		expect(pathFromUri('file:///home/u/a.typ')).toBe('/home/u/a.typ');
	});
});

describe('applying a rename to a file with no editor', () => {
	// Captured verbatim from tinymist 0.15.2 renaming `greeting` -> `overview`, with ONLY lib.typ
	// opened over LSP. main.typ had no editor and no didOpen, and the server still returns its two
	// edits: that is the whole reason this code exists rather than lsp-client's own command, which
	// looks main.typ up in its workspace, finds nothing, and drops both.
	const CAPTURED = {
		changes: {
			'file:///C:/proj/lib.typ': [{ newText: 'overview', range: { start: { line: 0, character: 5 }, end: { line: 0, character: 13 } } }],
			'file:///C:/proj/main.typ': [
				{ newText: 'overview', range: { start: { line: 0, character: 19 }, end: { line: 0, character: 27 } } },
				{ newText: 'overview', range: { start: { line: 2, character: 1 }, end: { line: 2, character: 9 } } }
			]
		}
	};

	it('keeps the unopened file`s edits', () => {
		const out = renameEditsFrom(CAPTURED);
		const main = out.find((o) => o.path === 'C:/proj/main.typ');
		expect(main?.edits.length).toBe(2);
	});

	it('splices them into the on-disk text, which is what applyElsewhere writes back', () => {
		const onDisk = '#import "lib.typ": greeting\n\n#greeting\n';
		const main = renameEditsFrom(CAPTURED).find((o) => o.path === 'C:/proj/main.typ')!;
		expect(applyTextEdits(onDisk, main.edits)).toBe('#import "lib.typ": overview\n\n#overview\n');
	});
});
