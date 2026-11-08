import type { ParsedBibtexEntry } from './bibtexParser';

/** serializes entries back to BibTeX; compact skips the pretty-print indentation. */
export function toBibtex(entries: ParsedBibtexEntry[], compact = false): string {
	let output = '';
	const entrySep = compact ? ',' : ',\n';
	const indent = compact ? '' : '    ';

	for (const entry of entries) {
		output += `@${entry.entryType}`;
		output += '{';

		if (entry.citationKey) {
			output += entry.citationKey + entrySep;
		}

		if (entry.entryTags) {
			let tags = indent;
			for (const [key, value] of Object.entries(entry.entryTags)) {
				if (tags.trim().length !== 0) {
					tags += entrySep + indent;
				}
				// a value the source wrote with a macro name or # concatenation goes back as written
				const raw = entry.rawValues?.[key];
				tags += raw != null ? key + (compact ? '=' : ' = ') + raw : key + (compact ? '={' : ' = {') + value + '}';
			}
			output += tags;
		}

		output += compact ? '}\n' : '\n}\n\n';
	}

	return output;
}
