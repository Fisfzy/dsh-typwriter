// the parser a file's suggestions are read with, from its extension
import type { RegionParser } from '$lib/editor/visual/sourceSpans';
import { fileKind } from '$lib/workspace/documentBuffer.svelte';
import { parseLatexRegion } from '$lib/workspace/latexRoundtrip';
import { parseMarkdownRegion } from '$lib/languages/markdown/visual/roundtrip';
import { parseTypstRegion } from '$lib/languages/typst/visual/roundtrip';

/** null for a file the visual editor does not render */
export function regionParserForPath(path: string, scanPreamble = ''): RegionParser | null {
	const kind = fileKind(path);
	if (kind === 'tex') return (src) => parseLatexRegion(src, scanPreamble);
	if (kind === 'md') return parseMarkdownRegion;
	if (kind === 'typ') return parseTypstRegion;
	return null;
}
