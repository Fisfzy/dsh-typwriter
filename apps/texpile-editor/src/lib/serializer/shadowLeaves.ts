// Where the leaves of a regenerated block sit in its text. A shadow run of the block stands a
// private-use character in for the characters of every leaf, keeping the ones the dialect's joins,
// trims and escapes look at, so each leaf can be found in the real output afterwards. The shadow is
// believed only where it equals the real output everywhere else; a block whose shadow differs maps
// no leaves at all
import type { Node } from 'prosemirror-model';
import type { Ctx } from './types';
import { spansOfChars, type CharSource, type Segment } from '$lib/editor/visual/sourceSpans';

const PUA_FIRST = 0xe000;
const PUA_LAST = 0xf8ff;

export type ShadowLeaf = { node: Node; emitted: string; placeholder: string };

export type ShadowDialect = {
	/** the placeholder standing for an emission: the characters the dialect reads stay, the rest is `id` */
	placeholder: (emitted: string, id: string, node: Node) => string;
	/** what one character of a text leaf may become in its emission, most specific first */
	charEmissions: (char: string, node: Node) => string[];
	/** a node whose handler output is one run: its bytes come from attrs, not from text leaves */
	isHandlerLeaf: (node: Node) => boolean;
};

export type Shadow = {
	/** in a shadow run, what stands for this leaf's emission; the emission itself otherwise */
	shadowed: (node: Node, emitted: string) => string;
	/** where the leaves of a regenerated block sit in its text, or null when the shadow could not be believed */
	mapBlockLeaves: (serializeNode: (node: Node, ctx: Ctx) => string, block: Node, ctx: Ctx, real: string) => Segment[] | null;
	/** the real and shadow runs of one block side by side, for the oracles to say why a block maps no leaves */
	shadowRunOf: (serializeNode: (node: Node, ctx: Ctx) => string, block: Node, ctx: Ctx) => { real: string; shadow: string };
};

function isPua(ch: string): boolean {
	const c = ch.charCodeAt(0);
	return c >= PUA_FIRST && c <= PUA_LAST;
}

/** where a leaf's emission starts in the real text, and how much of its edges a handler wrote elsewhere */
export type FoundLeaf = { start: number; lead: number; tail: number };

// what a renderer can write outside the markup around a run: whitespace, and punctuation markdown
// emphasis cannot open or close against (`, **so**` for a bold `, so`)
const EDGE_HEAD = /^(?:\s|\\?[\p{P}\p{S}])*/u;
const EDGE_TAIL = /(?:\s|\\?[\p{P}\p{S}])*$/u;

// the emission whole, else without the whitespace at its edges, else without the punctuation there too
function trimmings(e: string): Omit<FoundLeaf, 'start'>[] {
	const out = [{ lead: 0, tail: 0 }];
	for (const [head, end] of [
		[/^\s*/, /\s*$/],
		[EDGE_HEAD, EDGE_TAIL]
	]) {
		const lead = head.exec(e)![0].length;
		const tail = lead === e.length ? 0 : end.exec(e)![0].length;
		for (const t of [
			{ lead: 0, tail },
			{ lead, tail: 0 },
			{ lead, tail }
		])
			if (t.lead + t.tail < e.length && !out.some((o) => o.lead === t.lead && o.tail === t.tail)) out.push(t);
	}
	return out;
}

/**
 * A leaf without a marker, by being the only thing in the gap between the found leaves either side
 * of it; else by being the only place its bytes stand that no found leaf covers, since a handler can
 * write its leaves out of order (a term's title after its definition)
 */
export function locateUnmarked(marked: (FoundLeaf | null)[], emitted: string[], real: string): (FoundLeaf | null)[] {
	const located = [...marked];
	function end(p: number) {
		const f = located[p]!;
		return f.start + emitted[p].length - f.lead - f.tail;
	}
	for (let k = 0; k < emitted.length; k++) {
		if (located[k] !== null || !emitted[k]) continue;
		let from = 0;
		for (let p = k - 1; p >= 0; p--) {
			if (located[p]) {
				from = end(p);
				break;
			}
		}
		let to = real.length;
		for (let q = k + 1; q < emitted.length; q++) {
			const f = located[q];
			if (f) {
				to = f.start;
				break;
			}
		}
		if (from > to) continue;
		const gap = real.slice(from, to);
		for (const t of trimmings(emitted[k])) {
			const core = emitted[k].slice(t.lead, emitted[k].length - t.tail);
			const first = gap.indexOf(core);
			if (first < 0 || gap.indexOf(core, first + 1) >= 0) continue;
			located[k] = { start: from + first, ...t };
			break;
		}
	}
	for (let k = 0; k < emitted.length; k++) {
		if (located[k] !== null || !emitted[k]) continue;
		for (const t of trimmings(emitted[k])) {
			const core = emitted[k].slice(t.lead, emitted[k].length - t.tail);
			function taken(at: number) {
				return located.some((f, p) => f && at < end(p) && f.start < at + core.length);
			}
			let hit = -1;
			for (let i = real.indexOf(core); i >= 0 && hit !== -2; i = real.indexOf(core, i + 1)) if (!taken(i)) hit = hit < 0 ? i : -2;
			if (hit === -2) break;
			if (hit < 0) continue;
			located[k] = { start: hit, ...t };
			break;
		}
	}
	return located;
}

/**
 * The placeholder for markup dialects (markdown, typst), whose renderers read a run's edges, its
 * whitespace and its punctuation: the first and last characters stay, so does every non-letter,
 * and a space becomes a no-break space, still whitespace to every trim but never a byte of markup
 */
export function markupPlaceholder(emitted: string, id: string): string {
	let out = '';
	for (let i = 0; i < emitted.length; i++) {
		const c = emitted[i];
		if (i === 0 || i === emitted.length - 1) out += c;
		else if (c === ' ') out += ' ';
		else out += /[\p{L}\p{M}]/u.test(c) ? id : c;
	}
	return out;
}

// each ascii letter and digit one on, the case and the kind kept, so a renderer reading a run's edges reads the same
export function shifted(s: string): string {
	return s.replace(/[a-zA-Z0-9]/g, (c) => (c === 'z' ? 'a' : c === 'Z' ? 'A' : c === '9' ? '0' : String.fromCharCode(c.charCodeAt(0) + 1)));
}

/** text leaves nothing placed, written as just their text: a short run whose letters the markup has too (`#strong[st]s`) */
export function lostLeaves(leaves: ShadowLeaf[], located: (FoundLeaf | null)[]): Set<Node> {
	return new Set(
		leaves
			.filter((l, k) => !located[k] && l.node.isText && l.placeholder === l.emitted && shifted(l.emitted) !== l.emitted)
			.map((l) => l.node)
	);
}

/**
 * The lost leaves placed by a second run, `again`, that wrote them with their letters shifted: a
 * leaf stands where the text changed in just its letters. Believed only when every change is some leaf's
 */
export function placeShifted(
	out: string,
	again: string,
	leaves: ShadowLeaf[],
	lost: Set<Node>,
	located: (FoundLeaf | null)[]
): (FoundLeaf | null)[] {
	if (again.length !== out.length) return located;
	const changed = new Set<number>();
	for (let i = 0; i < out.length; i++) if (again[i] !== out[i]) changed.add(i);
	const found = [...located];
	const claimed = new Set<number>();
	for (let progress = true; progress;) {
		progress = false;
		for (let k = 0; k < leaves.length; k++) {
			const e = leaves[k].emitted;
			if (found[k] || !lost.has(leaves[k].node)) continue;
			const moved = shifted(e);
			let hit = -1;
			for (let i = out.indexOf(e); i >= 0 && hit !== -2; i = out.indexOf(e, i + 1)) {
				let fits = true;
				for (let j = 0; j < e.length && fits; j++) fits = (moved[j] !== e[j]) === changed.has(i + j) && !claimed.has(i + j);
				if (fits) hit = hit < 0 ? i : -2;
			}
			if (hit < 0) continue;
			found[k] = { start: hit, lead: 0, tail: 0 };
			for (let j = 0; j < e.length; j++) claimed.add(hit + j);
			progress = true;
		}
	}
	for (const i of changed) if (!claimed.has(i)) return located;
	return found;
}

export function createShadow(dialect: ShadowDialect): Shadow {
	let shadow: ShadowLeaf[] | null = null;
	// the leaves a second run writes shifted rather than as their placeholder
	let shifting: Set<Node> | null = null;

	function shadowed(node: Node, emitted: string): string {
		if (!shadow || shadow.length > PUA_LAST - PUA_FIRST) return emitted;
		const placeholder = shifting?.has(node)
			? shifted(emitted)
			: dialect.placeholder(emitted, String.fromCharCode(PUA_FIRST + shadow.length), node);
		shadow.push({ node, emitted, placeholder });
		return placeholder;
	}

	function run(
		serializeNode: (node: Node, ctx: Ctx) => string,
		block: Node,
		ctx: Ctx,
		shift: Set<Node> | null = null
	): { out: string; leaves: ShadowLeaf[] } {
		const leaves: ShadowLeaf[] = [];
		shadow = leaves;
		shifting = shift;
		try {
			return { out: serializeNode(block, ctx), leaves };
		} finally {
			shadow = null;
			shifting = null;
		}
	}

	/** the characters of a text leaf against its emission, one by one; the whole run when they cannot be told */
	function textLeafSpans(leaf: ShadowLeaf): CharSource[] {
		const text = leaf.node.text ?? '';
		function whole() {
			return new Array<CharSource>(text.length).fill({ srcFrom: 0, srcTo: leaf.emitted.length, kind: 'sub' });
		}
		const chars: CharSource[] = [];
		// written as it is (inline code): a backslash in it is itself, not the escape of what follows
		if (leaf.emitted === text) return Array.from({ length: text.length }, (_, i) => ({ srcFrom: i, srcTo: i + 1, kind: 'text' as const }));
		let off = 0;
		for (let i = 0; i < text.length; i++) {
			const e = dialect.charEmissions(text[i], leaf.node).find((c) => leaf.emitted.startsWith(c, off));
			// whitespace at the leaf's edges the renderer left out (a paragraph's first space) stands for nothing
			if (e === undefined && /\s/.test(text[i]) && (off === 0 || off === leaf.emitted.length)) {
				chars.push(null);
				continue;
			}
			if (e === undefined) return whole();
			chars.push({ srcFrom: off, srcTo: off + e.length, kind: e === text[i] ? 'text' : 'sub' });
			off += e.length;
		}
		return off === leaf.emitted.length ? chars : whole();
	}

	function mapBlockLeaves(serializeNode: (node: Node, ctx: Ctx) => string, block: Node, ctx: Ctx, real: string): Segment[] | null {
		const { out, leaves } = run(serializeNode, block, ctx);
		if (out.length !== real.length) return null;
		for (let i = 0; i < out.length; i++) {
			if (out[i] === real[i] || isPua(out[i]) || (out[i] === ' ' && real[i] === ' ')) continue;
			return null;
		}

		// the leaves' positions, relative to the block node; a block that is itself one run stands at 0
		const at = new Map<Node, number>();
		let twice = false;
		if (dialect.isHandlerLeaf(block) || block.type.spec.leafText) at.set(block, 0);
		block.descendants((n, pos) => {
			const leaf = n.isText || n.isLeaf || dialect.isHandlerLeaf(n) || !!n.type.spec.leafText;
			if (!leaf) return true;
			if (at.has(n)) twice = true;
			at.set(n, pos + 1);
			return false;
		});
		if (twice) return null;

		// a leaf with a marker is found by it, allowing for edges a handler wrote outside its markup
		const marked: (FoundLeaf | null)[] = leaves.map((leaf, k) => {
			const id = String.fromCharCode(PUA_FIRST + k);
			const p = leaf.placeholder;
			const j = p.indexOf(id);
			if (j < 0) return null;
			const i0 = out.indexOf(id);
			if (i0 < 0) return null;
			const maxLead = Math.min(j, EDGE_HEAD.exec(p)![0].length);
			const maxTail = EDGE_TAIL.exec(p)![0].length;
			for (let lead = 0; lead <= maxLead; lead++) {
				const start = i0 - (j - lead);
				if (start < 0) continue;
				for (let tail = 0; tail <= maxTail && lead + tail < p.length; tail++) {
					if (out.startsWith(p.slice(lead, p.length - tail), start)) return { start, lead, tail };
				}
			}
			return null;
		});
		const unmarked = locateUnmarked(
			marked,
			leaves.map((l) => l.emitted),
			real
		);
		const lost = lostLeaves(leaves, unmarked);
		const located = lost.size ? placeShifted(out, run(serializeNode, block, ctx, lost).out, leaves, lost, unmarked) : unmarked;

		const segs: Segment[] = [];
		for (let k = 0; k < leaves.length; k++) {
			const found = located[k];
			const leaf = leaves[k];
			const pm = at.get(leaf.node);
			if (!found || pm === undefined) continue;
			const { start, lead, tail } = found;
			const coreLen = leaf.emitted.length - lead - tail;
			if (leaf.node.isText) {
				// characters a handler trimmed off stand for nothing
				const chars = textLeafSpans(leaf).map((c) => {
					if (!c) return null;
					const srcFrom = Math.max(0, c.srcFrom - lead);
					const srcTo = Math.min(coreLen, c.srcTo - lead);
					return srcTo > srcFrom ? { srcFrom, srcTo, kind: c.kind } : null;
				});
				for (const s of spansOfChars(chars)) {
					segs.push({ pmFrom: pm + s.from, pmTo: pm + s.to, srcFrom: start + s.srcFrom, srcTo: start + s.srcTo, kind: s.kind });
				}
				continue;
			}
			// an atom whose text child appears once inside its emission maps that child character for character
			const core = leaf.emitted.slice(lead, lead + coreLen);
			const inner = leaf.node.childCount === 1 && leaf.node.firstChild!.isText ? (leaf.node.firstChild!.text ?? '') : '';
			const at1 = inner ? core.indexOf(inner) : -1;
			if (inner && at1 >= 0 && core.indexOf(inner, at1 + 1) < 0) {
				segs.push({ pmFrom: pm + 1, pmTo: pm + 1 + inner.length, srcFrom: start + at1, srcTo: start + at1 + inner.length, kind: 'text' });
			} else if (coreLen > 0) {
				segs.push({ pmFrom: pm, pmTo: pm + leaf.node.nodeSize, srcFrom: start, srcTo: start + coreLen, kind: 'sub' });
			}
		}
		return segs.sort((a, b) => a.pmFrom - b.pmFrom);
	}

	function shadowRunOf(serializeNode: (node: Node, ctx: Ctx) => string, block: Node, ctx: Ctx): { real: string; shadow: string } {
		const real = serializeNode(block, ctx);
		return { real, shadow: run(serializeNode, block, ctx).out };
	}

	return { shadowed, mapBlockLeaves, shadowRunOf };
}
