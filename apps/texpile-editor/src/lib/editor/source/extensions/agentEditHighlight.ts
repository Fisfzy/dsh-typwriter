// 源码页的「交给 AGENT 修改」选区：CodeMirror mark decoration，琥珀色底，跟随滚动。
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

export const setAgentEditRange = StateEffect.define<{ from: number; to: number } | null>();

export const agentEditHighlightField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(value, tr) {
		let next = value.map(tr.changes);
		for (const effect of tr.effects) {
			if (!effect.is(setAgentEditRange)) continue;
			next = effect.value
				? Decoration.set([Decoration.mark({ class: 'agent-edit-pending' }).range(effect.value.from, effect.value.to)])
				: Decoration.none;
		}
		return next;
	},
	provide: (field) => EditorView.decorations.from(field)
});

export function setSourceAgentEditHighlight(view: EditorView | null | undefined, from: number, to: number): void {
	if (!view) return;
	view.dispatch({ effects: setAgentEditRange.of({ from, to }) });
}

export function clearSourceAgentEditHighlight(view: EditorView | null | undefined): void {
	if (!view) return;
	view.dispatch({ effects: setAgentEditRange.of(null) });
}
