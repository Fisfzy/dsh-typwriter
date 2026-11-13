// 「交给 AGENT 修改」中的选区：给文本加一个琥珀色底（和普通蓝色选区区分），
// decoration 跟随文本/滚动/换行，不会像屏幕 overlay 那样错位。
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

export const agentEditHighlightKey = new PluginKey<{ from: number; to: number } | null>('agentEditHighlight');

export const agentEditHighlightPlugin = new Plugin<{ from: number; to: number } | null>({
	key: agentEditHighlightKey,
	state: {
		init: () => null,
		apply(tr, value) {
			const meta = tr.getMeta(agentEditHighlightKey);
			if (meta !== undefined) return meta as { from: number; to: number } | null;
			if (!value) return null;
			if (!tr.docChanged) return value;
			return { from: tr.mapping.map(value.from), to: tr.mapping.map(value.to) };
		}
	},
	props: {
		decorations(state) {
			const value = agentEditHighlightKey.getState(state);
			return value ? DecorationSet.create(state.doc, [Decoration.inline(value.from, value.to, { class: 'agent-edit-pending' })]) : null;
		}
	}
});

export function setAgentEditHighlight(view: EditorView | null | undefined, from: number, to: number): void {
	if (!view) return;
	view.dispatch(view.state.tr.setMeta(agentEditHighlightKey, { from, to }));
}

export function clearAgentEditHighlight(view: EditorView | null | undefined): void {
	if (!view) return;
	view.dispatch(view.state.tr.setMeta(agentEditHighlightKey, null));
}
