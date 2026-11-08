// Review-comment highlights inside CodeMirror-backed node views (code_block, raw_latex).
//
// ProseMirror resolves comment ranges over these blocks' text like any other prose, but it cannot
// PAINT an inline decoration inside a node view that renders its own DOM - so a commented range
// of code or raw source silently drew nothing. Each view mirrors the ranges overlapping its node
// into CodeMirror's own decoration system, with the same classes the prose highlights use, and
// re-syncs from update() - which decoration-only changes (place, focus, dismiss) also trigger.
import { Decoration, EditorView as CodeMirrorView, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import type { EditorView as ProseMirrorView } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import { pmCommentsKey, threadTint } from '$lib/editor/visual/extensions/pmComments';

const setCommentRanges = StateEffect.define<{ from: number; to: number; cls: string; tint: string }[]>();

/** the CodeMirror extension carrying the mirrored highlights; include it in the block's config */
export const cmCommentHighlights = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(prev, tr) {
		let value = prev.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(setCommentRanges)) {
				value = Decoration.set(
					e.value.map((r) => Decoration.mark({ class: r.cls, attributes: { style: `--range-tint: ${r.tint}` } }).range(r.from, r.to)),
					true
				);
			}
		}
		return value;
	},
	provide: (f) => CodeMirrorView.decorations.from(f)
});

/**
 * Mirror the comment ranges overlapping this node into `cm`. Returns the new dedupe key; pass it
 * back on the next call so an unchanged set dispatches nothing.
 */
export function syncCmCommentHighlights(
	cm: CodeMirrorView,
	pmView: ProseMirrorView,
	getPos: () => number | undefined,
	node: Node,
	lastKey: string
): string {
	const state = pmCommentsKey.getState(pmView.state);
	const pos = getPos();
	if (!state || pos === undefined) return lastKey;
	// content starts one past the node boundary; clamp ranges to the block's text
	const start = pos + 1;
	const len = node.content.size;
	const ranges = state.ranges
		.filter((r) => !r.resolved && r.to > start && r.from < start + len)
		.map((r) => ({
			from: Math.max(0, r.from - start),
			to: Math.min(len, r.to - start),
			cls: `pm-range pm-comment${r.id === state.focused ? ' pm-comment-focused' : ''}`,
			tint: threadTint(r.id === state.focused)
		}))
		.filter((r) => r.to > r.from);
	const key = JSON.stringify(ranges);
	if (key !== lastKey) cm.dispatch({ effects: setCommentRanges.of(ranges) });
	return key;
}

/**
 * Clicking a mirrored highlight selects its thread, exactly as clicking commented prose does.
 *
 * CodeMirror owns clicks inside the block (stopEvent), so ProseMirror's handleClick never fires
 * there. Instead of re-plumbing the panel's onSelect callback, the click is translated to a
 * document position and handed to the comment plugin's OWN handleClick prop - one code path for
 * "commented text was clicked", whichever editor drew it. Never handled: CodeMirror still places
 * its caret, matching the prose behaviour.
 */
export function cmCommentClicks(pmView: ProseMirrorView, getPos: () => number | undefined): Extension {
	return CodeMirrorView.domEventHandlers({
		click: (event, cm) => {
			const cmPos = cm.posAtCoords({ x: event.clientX, y: event.clientY });
			const pos = getPos();
			if (cmPos == null || pos === undefined) return false;
			const plugin = pmCommentsKey.get(pmView.state);
			const handleClick = (plugin?.spec.props as { handleClick?: (v: ProseMirrorView, p: number, e: MouseEvent) => boolean } | undefined)
				?.handleClick;
			handleClick?.(pmView, pos + 1 + cmPos, event);
			return false;
		}
	});
}
