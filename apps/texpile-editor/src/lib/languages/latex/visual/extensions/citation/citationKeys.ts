// A citation node's text content is its cite key list, exactly as LaTeX writes it:
// \cite{a, b, c} - one command, one shared pre/post-note, several keys.

/** the individual cite keys in a citation node's text content */
export function splitCitationKeys(text: string): string[] {
	return text
		.split(',')
		.map((k) => k.trim())
		.filter(Boolean);
}
