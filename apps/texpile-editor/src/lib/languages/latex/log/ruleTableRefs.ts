// referencing, bibliography, and font diagnostics; the engine-error rules live in ruleTable.ts

import type { EnrichmentRule } from './ruleTable';

export const REFERENCE_RULES: EnrichmentRule[] = [
	{
		id: 'undefined-reference',
		match: /^LaTeX Warning: Reference `([^']+)' on page \d+ undefined/,
		anchor: (m) => m[1],
		hint: (_e, m) =>
			`\\ref{${m[1]}} has no matching \\label{${m[1]}}. Add the label, fix the name, or recompile once more if you just added it.`
	},
	{
		id: 'undefined-citation',
		match: /^(?:LaTeX|Package natbib|Package biblatex) Warning: Citation [`']([^']+)'? .*undefined/,
		anchor: (m) => m[1],
		hint: (_e, m) =>
			`The key "${m[1]}" is not in the bibliography. Check the key, the .bib file, and that the bibliography tool (bibtex/biber) has run.`
	},
	{
		id: 'undefined-references-summary',
		match: /^LaTeX Warning: There were undefined references/,
		cascadesFrom: ['undefined-reference', 'undefined-citation']
	},
	{
		id: 'multiply-defined-label',
		match: /^LaTeX Warning: Label `([^']+)' multiply defined/,
		anchor: (m) => m[1],
		hint: (_e, m) => `Two \\label{${m[1]}} exist. Every label must be unique.`
	},
	{
		id: 'multiply-defined-summary',
		match: /^LaTeX Warning: There were multiply-defined labels/,
		cascadesFrom: ['multiply-defined-label']
	},
	{
		id: 'labels-changed-rerun',
		match: /^LaTeX Warning: Label\(s\) may have changed/,
		hint: 'Cross-references moved; compile once more and this goes away.'
	},
	{
		id: 'float-specifier-changed',
		match: /^LaTeX Warning: `!?h' float specifier changed to `!?ht'/,
		hint: "A [h] float placement could not be honored; LaTeX fell back to [ht]. Harmless, or use the float package's [H] to force exact placement."
	},
	{
		id: 'missing-character',
		match: /^Missing character: There is no (.+?) in font/,
		hint: 'The current font has no glyph for this character, so it was silently dropped from the output.'
	},
	{
		id: 'fontshape-undefined',
		match: /^LaTeX Font Warning: Font shape .* undefined/,
		hint: 'The requested font variant does not exist; LaTeX substituted a close one. Usually harmless.'
	},
	{
		id: 'bib-entry-not-found',
		match: /^I didn't find a database entry for ["'](.+?)["']/,
		hint: (_e, m) => `No entry with key "${m[1]}" exists in the bibliography files. Check the key against the .bib file.`
	},
	{
		id: 'bib-syntax-error',
		match: /^I was expecting a |syntax error: /,
		hint: 'The .bib file has a syntax error at this point, usually a missing comma, brace, or quote in the entry above.'
	},
	{
		id: 'bib-runaway-string',
		match: /possible runaway string started at line (\d+)/,
		hint: 'A quote or brace opened in the .bib file is never closed; the string runs on past where it should end.'
	},
	{
		id: 'bib-bad-crossref',
		match: /^A bad cross reference---entry/,
		hint: 'The crossref field names an entry that does not exist in the .bib file.'
	},
	{
		id: 'bib-empty-field',
		match: /^empty (\w+) in (\S+)/,
		hint: (_e, m) => `The entry "${m[2]}" has no ${m[1]} field, which the bibliography style expects.`
	},
	{
		id: 'bib-style-not-found',
		match: /^I couldn't open style file (.+)\.bst/,
		hint: (_e, m) => `\\bibliographystyle names "${m[1]}", but no ${m[1]}.bst exists. Check the style name.`
	},
	{
		id: 'bib-no-citations',
		match: /^I found no \\citation commands/,
		hint: 'The document cites nothing (or the .aux file is stale). Add a \\cite, or recompile so the .aux regenerates.'
	}
];
