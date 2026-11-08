// What changed since a saved version, drawn on the rendered document.
//
// The change set lives in plugin state rather than being recomputed, which is what lets a
// comparison be typed in: each transaction is an addSteps over the ranges it touched.
import { Plugin, PluginKey } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';
import type { ChangeSet } from 'prosemirror-changeset';
import type { Node as PMNode } from 'prosemirror-model';
import { initialChangeSet, decorationsForSet } from './docChanges';

export const visualDiffKey = new PluginKey<VisualDiffState>('texpileVisualDiff');

export type VisualDiffInput = {
	/** the saved version, parsed into a document of the same schema as the one on screen */
	oldDoc: PMNode;
};

export type VisualDiffState = {
	/** null when nothing is being compared */
	set: ChangeSet | null;
	decorations: DecorationSet;
	/** carried forward through an edit rather than recomputed: what was just typed is not marked yet */
	stale: boolean;
};

const EMPTY: VisualDiffState = { set: null, decorations: DecorationSet.empty, stale: false };

/** exported for the tests: the debounce is a timer, this meta is the behaviour */
export const VISUAL_DIFF_REFRESH = 'texpileVisualDiffRefresh';

// measured on a 350KB paper against a distant version: 2000 changes rebuild in ~230ms per
// keystroke, where carrying the marks forward is 0.4ms. Below this a rebuild is a millisecond.
const REBUILD_LIMIT = 150;

function startFrom(input: VisualDiffInput, doc: PMNode): VisualDiffState {
	const set = initialChangeSet(input.oldDoc, doc);
	return { set, decorations: decorationsForSet(set, doc), stale: false };
}

/** input arrives through a meta, so picking another version redraws without rebuilding the editor */
export function visualDiffPlugin(initial: VisualDiffInput | null = null): Plugin<VisualDiffState> {
	return new Plugin<VisualDiffState>({
		key: visualDiffKey,
		state: {
			init(_config, state) {
				return initial ? startFrom(initial, state.doc) : EMPTY;
			},
			apply(tr, value, _old, state) {
				const next = tr.getMeta(visualDiffKey) as VisualDiffInput | null | undefined;
				if (next !== undefined) return next ? startFrom(next, state.doc) : EMPTY;
				if (!value.set) return value;
				if (tr.getMeta(VISUAL_DIFF_REFRESH)) {
					return value.stale ? { set: value.set, decorations: decorationsForSet(value.set, tr.doc), stale: false } : value;
				}
				if (!tr.docChanged) return value;
				// an edit and a re-parse both arrive as steps; a re-parse that produced identical
				// content re-diffs to no change rather than to a false one
				const set = value.set.addSteps(tr.doc, tr.mapping.maps, null);
				if (set.changes.length <= REBUILD_LIMIT) return { set, decorations: decorationsForSet(set, tr.doc), stale: false };
				return { set, decorations: value.decorations.map(tr.mapping, tr.doc), stale: true };
			}
		},
		props: {
			decorations(state) {
				return visualDiffKey.getState(state)?.decorations ?? DecorationSet.empty;
			}
		},
		/** puts the carried-forward marks right once the typing stops */
		view() {
			let timer: ReturnType<typeof setTimeout> | undefined;
			return {
				update(view) {
					if (!visualDiffKey.getState(view.state)?.stale) return;
					clearTimeout(timer);
					timer = setTimeout(() => {
						// repainting under a live IME composition kills it; wait rather than drop
						if (view.isDestroyed) return;
						if (view.composing) {
							view.dom.addEventListener('compositionend', () => view.dispatch(view.state.tr.setMeta(VISUAL_DIFF_REFRESH, true)), {
								once: true
							});
							return;
						}
						view.dispatch(view.state.tr.setMeta(VISUAL_DIFF_REFRESH, true));
					}, 250);
				},
				destroy() {
					clearTimeout(timer);
				}
			};
		}
	});
}
