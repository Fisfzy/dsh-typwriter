// in live mode the Problems panel named _draft/texd-body.tex, so click-to-jump could not land in
// the file being edited
import { describe, it, expect } from 'vitest';
import { remapDraftBodyFile } from '$lib/compileLog/draftBodyRemap';

describe('remapDraftBodyFile', () => {
	it('points the padded body at the main file, keeping the line', () => {
		const entries = [
			{ file: './_draft/texd-body.tex', line: 12 },
			{ file: '_draft\\texd-body.tex', line: 40 },
			{ file: './sections/intro.tex', line: 3 },
			{ file: undefined as string | undefined, line: 1 }
		];
		remapDraftBodyFile(entries, 'main.tex');
		expect(entries.map((e) => [e.file, e.line])).toEqual([
			['main.tex', 12],
			['main.tex', 40],
			['./sections/intro.tex', 3],
			[undefined, 1]
		]);
	});
});
