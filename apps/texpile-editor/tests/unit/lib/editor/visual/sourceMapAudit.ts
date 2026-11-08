// what every source map has to satisfy against the document and the text it maps between, in one
// place for both producers: text runs are their bytes, no two runs share a position or a byte
import type { Node as PMNode } from 'prosemirror-model';
import type { Segment } from '$lib/editor/visual/sourceSpans';

export type MapAudit = { problems: string[]; chars: number; covered: number; leaves: number; leavesCovered: number };

export function auditMap(doc: PMNode, text: string, spans: Segment[]): MapAudit {
	const problems: string[] = [];
	for (let i = 0; i < spans.length; i++) {
		const s = spans[i];
		if (!(s.pmFrom < s.pmTo && s.srcFrom < s.srcTo && s.srcFrom >= 0 && s.srcTo <= text.length && s.pmTo <= doc.content.size)) {
			problems.push(`bounds ${JSON.stringify(s)}`);
			continue;
		}
		if (i > 0 && spans[i - 1].pmTo > s.pmFrom) problems.push(`two runs share document position ${s.pmFrom}`);
		if (s.kind === 'text') {
			const shown = doc.textBetween(s.pmFrom, s.pmTo);
			const bytes = text.slice(s.srcFrom, s.srcTo);
			if (shown !== bytes)
				problems.push(`a text run is not its bytes: ${JSON.stringify(shown)} for ${JSON.stringify(bytes)} at ${s.srcFrom}`);
		}
	}
	const bySrc = [...spans].sort((a, b) => a.srcFrom - b.srcFrom || a.srcTo - b.srcTo);
	for (let i = 1; i < bySrc.length; i++) {
		if (bySrc[i - 1].srcTo > bySrc[i].srcFrom) {
			problems.push(
				`two runs claim bytes ${bySrc[i].srcFrom}..${bySrc[i - 1].srcTo}: ${JSON.stringify(text.slice(bySrc[i].srcFrom, bySrc[i - 1].srcTo))}`
			);
		}
	}
	// coverage: prose characters and leaf nodes any run accounts for
	let chars = 0;
	let covered = 0;
	let leaves = 0;
	let leavesCovered = 0;
	let k = 0;
	doc.descendants((node, pos) => {
		if (node.isText) {
			const len = node.text!.length;
			chars += len;
			while (k < spans.length && spans[k].pmTo <= pos) k++;
			for (let j = k; j < spans.length && spans[j].pmFrom < pos + len; j++) {
				covered += Math.min(spans[j].pmTo, pos + len) - Math.max(spans[j].pmFrom, pos);
			}
			return false;
		}
		if (node.isLeaf || (node.isInline && node.isAtom)) {
			leaves++;
			while (k < spans.length && spans[k].pmTo <= pos) k++;
			if (k < spans.length && spans[k].pmFrom <= pos && spans[k].pmTo >= pos + node.nodeSize) leavesCovered++;
			else if (node.childCount > 0) {
				// an atom whose text child carries the map counts as covered
				let inner = false;
				node.descendants((c, p) => {
					if (c.isText && spans.some((s) => s.pmFrom <= pos + 1 + p && s.pmTo >= pos + 1 + p + c.nodeSize)) inner = true;
					return !inner;
				});
				if (inner) leavesCovered++;
			}
			return false;
		}
		return true;
	});
	return { problems, chars, covered, leaves, leavesCovered };
}

/** the audits of many files rolled into one coverage report */
export function coverage(audits: MapAudit[]): { prose: number; nodes: number } {
	let chars = 0;
	let covered = 0;
	let leaves = 0;
	let leavesCovered = 0;
	for (const a of audits) {
		chars += a.chars;
		covered += a.covered;
		leaves += a.leaves;
		leavesCovered += a.leavesCovered;
	}
	return { prose: covered / Math.max(1, chars), nodes: leavesCovered / Math.max(1, leaves) };
}
