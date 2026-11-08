// where a suggestion sits in the rendered document: the file around it parsed with and without it,
// the two compared, and each change carried into the editor's document through the source map
import type { Node as PMNode } from 'prosemirror-model';
import type { SuggestionMark } from '$lib/comments/activeSuggestions.svelte';
import { bySource, type RegionParse, type RegionParser, type SourceMap } from '../sourceSpans';
import { blockAtSource } from '../sourceMap';
import { diffDocs } from './pmSuggestionDiff';
import { placeChange } from './pmSuggestionChange';
import { joinAcrossNodes, shareOut, splitAtNodes, stretchesOf, type MarkBytes } from './pmSuggestionShare';
import type { Piece, PmSuggestionRange, Shown, Span } from './pmSuggestionTypes';

export type { GoneContent, OldRun, PmSuggestionRange } from './pmSuggestionTypes';

export type SuggestionSource = {
	/** the file's text, which the marks are offsets of and the map describes */
	text: string;
	map: SourceMap;
	/** the stretch of the text the document is: the body, without preamble or postamble */
	body: { from: number; to: number };
	parse: RegionParser;
};

export type PlacedSuggestions = {
	ranges: PmSuggestionRange[];
	partial: Set<string>;
	hidden: Set<string>;
	/** marks of another text than the one given; their last placement stands until the next */
	stale: Set<string>;
};

// the top-level blocks the mark's bytes touch, and one more on each side, since a change at a
// block's edge can be the edge itself moving
function regionOf(map: SourceMap, s: Span, body: Span): Span {
	const blocks = bySource(map.blocks);
	if (blocks.length === 0) return body;
	let first = blocks.findIndex((b) => b.srcTo >= s.from);
	let last = -1;
	for (let i = 0; i < blocks.length && blocks[i].srcFrom <= s.to; i++) last = i;
	if (first < 0) first = blocks.length - 1;
	if (last < 0) last = 0;
	if (first > last) [first, last] = [last, first];
	first = Math.max(0, first - 1);
	last = Math.min(blocks.length - 1, last + 1);
	return {
		from: Math.max(body.from, Math.min(blocks[first].srcFrom, s.from)),
		to: Math.min(body.to, Math.max(blocks[last].srcTo, s.to))
	};
}

// a formula is one object: the editor holds what was typed in it, the file what typst converted that
// to, and the two read alike only as drawn
function plainText(doc: PMNode, from: number, to: number): string {
	let out = '';
	doc.nodesBetween(from, to, (node, pos) => {
		if (node.isText) out += node.text!.slice(Math.max(0, from - pos), to - pos);
		else if (node.isAtom) out += '￼';
		else if (node.isTextblock) out += '\n';
		return !node.isAtom;
	});
	return out.replace(/\s+/g, ' ').trim();
}

/** the top-level nodes some blocks cover, as ranges, and their indices */
type TopNodes = { indices: number[]; spans: Span[] };

// by node and not by block: a map written back and a stretch parsed afresh group them differently (an
// itemize is one block parsed, one an item once written), and the nodes are what the reader sees
function topNodes(doc: PMNode, lo: number, hi: number, written: (from: number, to: number) => boolean = () => true): TopNodes {
	const out: TopNodes = { indices: [], spans: [] };
	doc.forEach((node, offset, i) => {
		if (offset < lo || offset + node.nodeSize > hi || !written(offset, offset + node.nodeSize)) return;
		out.indices.push(i);
		out.spans.push({ from: offset, to: offset + node.nodeSize });
	});
	return out;
}

// a stretch parsed on its own reads as the file does only when its blocks come out the same; a brace
// whose partner is outside the stretch, say, makes a document that is not the one on screen
function readsAsShown(doc: PMNode, shown: TopNodes, after: RegionParse): boolean {
	const parsed = topNodes(after.doc, 0, after.doc.content.size).spans;
	if (shown.spans.length !== parsed.length) return false;
	return shown.spans.every((s, i) => plainText(doc, s.from, s.to) === plainText(after.doc, parsed[i].from, parsed[i].to));
}

// marks whose stretches touch are read together: one edit can arrive as several suggestions (a
// paragraph pulled into a heading is a deleted `}` and an added one), and only with all of them put
// back does the file read as it did
type Cluster = { region: Span; marks: SuggestionMark[] };

function clustersOf(marks: SuggestionMark[], map: SourceMap, body: Span): Cluster[] {
	const out: Cluster[] = [];
	for (const s of [...marks].sort((x, y) => x.from - y.from || x.to - y.to)) {
		const region = regionOf(map, s, body);
		const last = out[out.length - 1];
		if (last && region.from <= last.region.to) {
			last.region.to = Math.max(last.region.to, region.to);
			last.marks.push(s);
		} else out.push({ region, marks: [s] });
	}
	return out;
}

export function placePmSuggestions(doc: PMNode, marks: SuggestionMark[], source: SuggestionSource): PlacedSuggestions {
	const ranges: PmSuggestionRange[] = [];
	const partial = new Set<string>();
	const hidden = new Set<string>();
	const stale = new Set<string>();
	if (marks.length === 0) return { ranges, partial, hidden, stale };
	const { text, map, body, parse } = source;
	function asBlocks(s: SuggestionMark) {
		const a = blockAtSource(map, s.from);
		const b = blockAtSource(map, s.to) ?? a;
		if (!a && !b) {
			hidden.add(s.id);
			return;
		}
		ranges.push({
			id: s.id,
			from: Math.min((a ?? b)!.pmFrom, (b ?? a)!.pmFrom),
			to: Math.max((a ?? b)!.pmTo, (b ?? a)!.pmTo),
			restore: s.restore,
			mine: s.mine,
			old: [],
			partial: true
		});
		partial.add(s.id);
	}
	const live: SuggestionMark[] = [];
	for (const s of marks) {
		if (s.to < s.from || text.slice(s.from, s.to) !== s.anchor.quote) stale.add(s.id);
		else if (s.from < body.from || s.to > body.to) hidden.add(s.id);
		else live.push(s);
	}
	for (const { region, marks: group } of clustersOf(live, map, body)) {
		const after = parse(text.slice(region.from, region.to));
		const inRegion = bySource(map.blocks).filter((b) => b.srcFrom >= region.from && b.srcTo <= region.to);
		// a node no block covers wrote nothing (an empty paragraph), so the stretch parsed has no node for it
		const tops = topNodes(doc, Math.min(...inRegion.map((b) => b.pmFrom)), Math.max(...inRegion.map((b) => b.pmTo)), (from, to) =>
			inRegion.some((b) => b.pmFrom <= from && to <= b.pmTo)
		);
		// a parser that says where no run of the stretch came from leaves the blocks as all that can be said
		if (after.map.leaves.length === 0 || !readsAsShown(doc, tops, after)) {
			group.forEach(asBlocks);
			continue;
		}
		const shown: Shown = { doc, map, at: region.from, tops: tops.indices };
		let beforeSrc = text.slice(region.from, region.to);
		for (const s of [...group].reverse())
			beforeSrc = beforeSrc.slice(0, s.from - region.from) + s.restore + beforeSrc.slice(s.to - region.from);
		const before = parse(beforeSrc);
		const bytes: MarkBytes[] = [];
		let shift = 0;
		for (const mark of group) {
			const from = mark.from - region.from + shift;
			bytes.push({ mark, a: { from, to: from + mark.restore.length }, b: { from: mark.from - region.from, to: mark.to - region.from } });
			shift += mark.restore.length - (mark.to - mark.from);
		}
		const owned = new Map<SuggestionMark, Piece[]>(group.map((s) => [s, []]));
		// the node it was is set beside a node once, however many marks changed it
		const wasAt = new Set<string>();
		const changes = diffDocs(before.doc, after.doc, stretchesOf(bytes, before, after));
		for (const c of joinAcrossNodes(splitAtNodes(changes, before, after), before, after)) {
			for (const { mark, piece } of shareOut(c, before, after, bytes)) owned.get(mark)!.push(piece);
		}
		// a mark with nothing readable of its own - the closing brace of a wrapper whose opening
		// brace is another mark, whitespace beside a mark that changed words - rides with the marks
		// of its cluster that did change something the reader sees: placed where they are, drawing
		// nothing of its own. Only when no mark of the cluster changed anything readable do the
		// blocks say that something did.
		function visible(pieces: Piece[]) {
			return pieces.some((p) => p.A.to > p.A.from || p.B.to > p.B.from);
		}
		const riders: SuggestionMark[] = [];
		const anchors: PmSuggestionRange[] = [];
		for (const [s, pieces] of owned) {
			if (!visible(pieces)) {
				riders.push(s);
				continue;
			}
			const placed = pieces.map((piece) => placeChange(doc, s, piece, before, after, shown));
			if (placed.some((p) => !p)) {
				hidden.add(s.id);
				continue;
			}
			// a node changed in several places is one outline
			const outlined = new Map<string, PmSuggestionRange>();
			for (const p of placed) {
				if (p!.partial) partial.add(s.id);
				for (const r of p!.ranges) {
					if (!r.node) {
						ranges.push(r);
						continue;
					}
					const key = `${r.from}:${r.to}`;
					if (r.was) {
						if (wasAt.has(key)) delete r.was;
						else wasAt.add(key);
					}
					const seen = outlined.get(key);
					if (!seen) {
						outlined.set(key, r);
						ranges.push(r);
					} else if (!seen.was && r.was) seen.was = r.was;
				}
			}
			for (const p of placed) if (!p!.partial) for (const r of p!.ranges) if (!r.partial) anchors.push(r);
		}
		for (const s of riders) {
			if (anchors.length === 0) {
				asBlocks(s);
				continue;
			}
			// at the start of the first mate's range, nothing of its own to draw
			const at = anchors.reduce((best, r) => (r.from < best.from ? r : best));
			ranges.push({ id: s.id, from: at.from, to: at.from, restore: s.restore, mine: s.mine, old: [], partial: false, format: true });
		}
	}
	return { ranges, partial, hidden, stale };
}
