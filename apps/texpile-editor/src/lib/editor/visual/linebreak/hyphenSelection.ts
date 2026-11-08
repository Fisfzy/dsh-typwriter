// the hyphen a line ends on is generated content, which the browser paints no selection over, so a selected word's
// hyphen takes the selection colour by hand: its mark gets a second class while the selection covers it (app.css)
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { lineBreakKey } from './lineBreakPlugin';

export const hyphenSelectionKey = new PluginKey<DecorationSet>('texpile-hyphen-selection');

// no two specs equal, for the same reason as the marks themselves (lineBreakPlugin)
let made = 0;
// band names stay apart when two editors are open side by side (cursor-plugin does the same)
let plugins = 0;

function selectedHyphens(state: EditorState, bands: string): DecorationSet {
	const { from, to } = state.selection;
	const marks = lineBreakKey.getState(state)?.decorations;
	if (from === to || !marks) return DecorationSet.empty;
	const hyphens = marks
		.find(from, to, (spec) => spec.kind === 'hyphen')
		.filter((mark) => mark.from >= from && mark.to <= to)
		// data-band names it for selectionBands.ts, which stretches the shade to the line box
		.map((mark) =>
			Decoration.inline(mark.from, mark.to, { class: 'pm-line-hyphen-selected', 'data-band': `${bands}-${mark.from}` }, { made: ++made })
		);
	return hyphens.length ? DecorationSet.create(state.doc, hyphens) : DecorationSet.empty;
}

export function hyphenSelectionPlugin(): Plugin<DecorationSet> {
	const bands = `hyphen${++plugins}`;
	return new Plugin<DecorationSet>({
		key: hyphenSelectionKey,
		state: {
			init: (_, state) => selectedHyphens(state, bands),
			// the marks arrive by a transaction of their own, with neither a doc nor a selection change
			apply: (tr: Transaction, shown, _old, state) =>
				tr.selectionSet || tr.docChanged || tr.getMeta(lineBreakKey) ? selectedHyphens(state, bands) : shown
		},
		props: {
			decorations: (state) => hyphenSelectionKey.getState(state)
		}
	});
}
