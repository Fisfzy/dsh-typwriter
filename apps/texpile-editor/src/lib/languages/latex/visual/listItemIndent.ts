// a paragraph that becomes a list item gives up its \indent or \noindent: LaTeX ignores both inside a list
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { InputRule } from 'prosemirror-inputrules';
import { createWrapInListCommand, type ListAttributes } from 'prosemirror-flat-list';

/** an item that already carried the command keeps it, since its source says so */
export function withoutIndentOnNewListItems(before: EditorState, tr: Transaction): Transaction {
	if (!tr.docChanged) return tr;
	const back = tr.mapping.invert();
	const cleared: number[] = [];
	tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos, parent) => {
		if (node.type.name !== 'paragraph') return true;
		if (node.attrs.indent === 'auto' || parent?.type.name !== 'list') return false;
		const $old = before.doc.resolve(back.map(pos + 1, 1));
		const wasItem = $old.depth > 0 && $old.node($old.depth - 1).type.name === 'list';
		if (!wasItem) cleared.push(pos);
		return false;
	});
	for (const pos of cleared) tr.setNodeAttribute(pos, 'indent', 'auto');
	return tr;
}

export function wrapInListItems(attrs: ListAttributes): Command {
	const wrap = createWrapInListCommand(attrs);
	return (state, dispatch, view) => wrap(state, dispatch && ((tr) => dispatch(withoutIndentOnNewListItems(state, tr))), view);
}

// InputRule keeps both as plain fields, which its types leave out
type InputRuleParts = {
	match: RegExp;
	handler: (state: EditorState, match: RegExpMatchArray, start: number, end: number) => Transaction | null;
};

export function listRuleWithoutIndent(rule: InputRule): InputRule {
	const { match, handler } = rule as unknown as InputRuleParts;
	return new InputRule(match, (state, found, start, end) => {
		const tr = handler(state, found, start, end);
		return tr && withoutIndentOnNewListItems(state, tr);
	});
}
