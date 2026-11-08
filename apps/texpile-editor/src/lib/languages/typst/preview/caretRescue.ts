// tinymist's jump_from_cursor resolves the syntax leaf ENDING at the position, so column 0, which
// has no leaf before it, never resolves, and a position inside markup resolves to nothing either

/** Column of the end of the first word on the line starting at `lineStart`, or null for a line
 *  with no word on it (blank, or pure markup like `#pagebreak()`). */
export function firstWordEndOnLine(src: string, lineStart: number): number | null {
	const nl = src.indexOf('\n', lineStart);
	const line = src.slice(lineStart, nl === -1 ? src.length : nl);
	const m = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/u.exec(line);
	return m ? m.index + m[0].length : null;
}
