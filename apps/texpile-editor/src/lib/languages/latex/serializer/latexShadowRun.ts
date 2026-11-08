// A shadow run of a block stands a private-use character in for the characters of every leaf,
// keeping the ones the joins and trims look at, so each leaf can be found in the real output
// afterwards. The shadow is believed only where it equals the real output everywhere else; a block
// whose shadow differs maps no leaves at all
import type { Node } from 'prosemirror-model';
import { spansOfChars, type CharSource, type Segment } from '$lib/editor/visual/sourceSpans';
import { blockOriginOf } from '$lib/editor/visual/parseOrigins';
import { bareTextString, esc, setBareUrl } from './textEscapes';
import { locateUnmarked, lostLeaves, placeShifted, shifted, type FoundLeaf } from '$lib/serializer/shadowLeaves';

const PUA_FIRST = 0xe000;
const PUA_LAST = 0xf8ff;
type ShadowLeaf = { node: Node; emitted: string; placeholder: string; bare?: boolean };
let shadow: ShadowLeaf[] | null = null;
// the leaves a second run writes shifted rather than as their placeholder
let shifting: Set<Node> | null = null;
// what the joins, the trims and the comment checks read. A space is kept as a no-break space: still
// whitespace to every trim, but never a byte of markup, so an edge a handler trimmed can be told
// from the bytes beside it
const KEPT = /[\n\t\r%\\{}]/;
// nodes whose handler output is one run: their bytes come from attrs, not from text leaves
const HANDLER_LEAVES = new Set([
	'block_math',
	'code_block',
	'raw_latex',
	'citation',
	'ref',
	'label',
	'hard_break',
	'includedoc',
	'horizontal_rule'
]);

function isPua(ch: string): boolean {
	const c = ch.charCodeAt(0);
	return c >= PUA_FIRST && c <= PUA_LAST;
}

export function isHandlerLeaf(node: Node): boolean {
	return HANDLER_LEAVES.has(node.type.name) || (node.type.name === 'image' && node.childCount === 0);
}

function placeholderFor(emitted: string, k: number): string {
	const id = String.fromCharCode(PUA_FIRST + k);
	// a trailing control word stays: the join after it looks for one
	const tail = /\\[a-zA-Z@]+$/.exec(emitted);
	const keep = tail ? tail.index : emitted.length;
	let out = '';
	for (let i = 0; i < keep; i++) {
		const c = emitted[i];
		// the join after a control word looks for a letter first, and a comment chip is known by its %
		if (i === 0 && /[a-zA-Z%\\]/.test(c)) out += c;
		else if (c === ' ') out += ' ';
		else out += KEPT.test(c) ? c : id;
	}
	return out + emitted.slice(keep);
}

// a node written in place of one of the block's own (a label taken off its item, a text trimmed), and
// how far into that one it starts
const standIns = new WeakMap<Node, { node: Node; offset: number }>();

export function standIn<T extends Node>(copy: T, original: Node, offset = 0): T {
	standIns.set(copy, { node: original, offset });
	return copy;
}

/** in a shadow run, what stands for this leaf's emission; the emission itself otherwise */
export function shadowed(node: Node, emitted: string): string {
	if (!shadow || shadow.length > PUA_LAST - PUA_FIRST) return emitted;
	const placeholder = shifting?.has(node) ? shifted(emitted) : placeholderFor(emitted, shadow.length);
	shadow.push({ node, emitted, placeholder });
	return placeholder;
}

function shadowBareUrl(text: string, href: string): string | null {
	const k = shadow ? shadow.findIndex((l) => l.placeholder === text) : -1;
	if (k < 0) return null;
	const leaf = shadow![k];
	if (leaf.emitted !== esc(href, 'text')) return null;
	// the call carries the raw href, so that is what the leaf's characters are from now on
	leaf.emitted = href;
	leaf.placeholder = placeholderFor(href, k);
	leaf.bare = true;
	return `\\url{${leaf.placeholder}}`;
}

/** the characters of a text leaf against its emission, one by one; the whole run when they cannot be told */
function textLeafSpans(leaf: ShadowLeaf): CharSource[] {
	const text = leaf.node.text ?? '';
	const chars: CharSource[] = [];
	if (leaf.bare) {
		if (leaf.emitted !== text) return new Array<CharSource>(text.length).fill({ srcFrom: 0, srcTo: leaf.emitted.length, kind: 'sub' });
		for (let i = 0; i < text.length; i++) chars.push({ srcFrom: i, srcTo: i + 1, kind: 'text' });
		return chars;
	}
	const isCode = leaf.node.marks.some((m) => m.type.name === 'code');
	let off = 0;
	for (let i = 0; i < text.length; i++) {
		const e = bareTextString(text[i], isCode);
		if (!leaf.emitted.startsWith(e, off))
			return new Array<CharSource>(text.length).fill({ srcFrom: 0, srcTo: leaf.emitted.length, kind: 'sub' });
		chars.push({ srcFrom: off, srcTo: off + e.length, kind: e === text[i] ? 'text' : 'sub' });
		off += e.length;
	}
	if (off !== leaf.emitted.length) return new Array<CharSource>(text.length).fill({ srcFrom: 0, srcTo: leaf.emitted.length, kind: 'sub' });
	return chars;
}

/** where the leaves of `block` sit in `real`, the text `render` writes for it, told by a shadow run */
function runShadow(render: () => string, shift: Set<Node> | null = null): { out: string; leaves: ShadowLeaf[] } {
	const leaves: ShadowLeaf[] = [];
	shadow = leaves;
	shifting = shift;
	setBareUrl(shadowBareUrl);
	try {
		return { out: render(), leaves };
	} finally {
		shadow = null;
		shifting = null;
		setBareUrl(null);
	}
}

export function mapRunLeaves(block: Node, real: string, render: () => string): Segment[] | null {
	const { out, leaves } = runShadow(render);
	if (out.length !== real.length) return null;
	for (let i = 0; i < out.length; i++) {
		if (out[i] === real[i] || isPua(out[i]) || (out[i] === ' ' && real[i] === ' ')) continue;
		return null;
	}

	// the leaves' positions, relative to the block node; a block that is itself one run stands at 0.
	// A child written out as its bytes (a chunk) is one run too, its own leaves carried inside it
	const chunks = new Set<Node>();
	for (const leaf of leaves)
		if (!leaf.node.isText && !leaf.node.isLeaf && !isHandlerLeaf(leaf.node) && !leaf.node.type.spec.leafText) chunks.add(leaf.node);
	const at = new Map<Node, number>();
	let twice = false;
	if (isHandlerLeaf(block) || block.type.spec.leafText) at.set(block, 0);
	block.descendants((n, pos) => {
		const leaf = n.isText || n.isLeaf || isHandlerLeaf(n) || !!n.type.spec.leafText || chunks.has(n);
		if (!leaf) return true;
		if (at.has(n)) twice = true;
		at.set(n, pos + 1);
		return false;
	});
	if (twice) return null;

	// a leaf with a marker is found by it, allowing for whitespace a handler trimmed off its edges
	const marked: (FoundLeaf | null)[] = leaves.map((leaf, k) => {
		const id = String.fromCharCode(PUA_FIRST + k);
		const p = leaf.placeholder;
		const j = p.indexOf(id);
		if (j < 0) return null;
		const i0 = out.indexOf(id);
		if (i0 < 0) return null;
		const maxLead = Math.min(j, /^\s*/.exec(p)![0].length);
		const maxTail = /\s*$/.exec(p)![0].length;
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
	const located = lost.size ? placeShifted(out, runShadow(render, lost).out, leaves, lost, unmarked) : unmarked;

	const segs: Segment[] = [];
	for (let k = 0; k < leaves.length; k++) {
		const found = located[k];
		const leaf = leaves[k];
		const stood = standIns.get(leaf.node);
		const pm = at.get(leaf.node) ?? (stood && at.has(stood.node) ? at.get(stood.node)! + stood.offset : undefined);
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
		// a chunk's runs are where the parse had them, moved to where its bytes landed
		if (chunks.has(leaf.node)) {
			const origin = blockOriginOf(leaf.node);
			if (!origin || origin.srcFrom === undefined || lead > 0 || tail > 0) continue;
			for (const s of origin.leaves) {
				segs.push({
					pmFrom: pm + (s.pmFrom - origin.pmFrom),
					pmTo: pm + (s.pmTo - origin.pmFrom),
					srcFrom: start + (s.srcFrom - origin.srcFrom),
					srcTo: start + (s.srcTo - origin.srcFrom),
					kind: s.kind
				});
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

export function renderShadowed(render: () => string): string {
	shadow = [];
	setBareUrl(shadowBareUrl);
	try {
		return render();
	} finally {
		shadow = null;
		setBareUrl(null);
	}
}

export function withoutShadow<T>(run: () => T): T {
	const shadowing = shadow;
	shadow = null;
	try {
		return run();
	} finally {
		shadow = shadowing;
	}
}
