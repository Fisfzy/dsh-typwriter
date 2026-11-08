// Two itemize environments separated by a blank line parse to adjacent list nodes. The serializer
// coalesced same-kind neighbours into one environment, while the verbatim layer emitted the
// pristine one with its own \begin and \end: editing either list left a lonely \item or a
// missing \end{itemize}.
import { describe, it, expect } from 'vitest';
import { Fragment, type Node } from 'prosemirror-model';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { createDedentListCommand, createIndentListCommand, createSplitListCommand } from 'prosemirror-flat-list';
import { schema } from '$lib/languages/latex/schema/latexPMSchema';
import { parseLatexFile, serializeLatexFile } from '$lib/workspace/latexRoundtrip';
import { serializeToLatex } from '$lib/languages/latex/serializer/latexSerializer';

const BODY = `\\begin{itemize}
\\item one
\\item two
\\end{itemize}

\\begin{itemize}
\\item three
\\item four
\\end{itemize}`;
const FILE = `\\documentclass{article}\n\\begin{document}\n${BODY}\n\\end{document}\n`;

function editItem(doc: Node, text: string): Node {
	const kids: Node[] = [];
	for (let i = 0; i < doc.childCount; i++) {
		const child = doc.child(i);
		if (child.textContent.includes(text)) {
			kids.push(child.type.create(child.attrs, [schema.node('paragraph', null, [schema.text(text + ' edited')])], child.marks));
		} else kids.push(child);
	}
	return doc.copy(Fragment.fromArray(kids));
}

function count(s: string, needle: string): number {
	return s.split(needle).length - 1;
}

describe('adjacent same-kind lists from separate environments', () => {
	it.each(['one', 'four'])('editing item "%s" keeps both environments balanced', (item) => {
		const parsed = parseLatexFile(FILE);
		const out = serializeLatexFile(parsed, editItem(parsed.doc, item));
		expect(count(out, '\\begin{itemize}')).toBe(2);
		expect(count(out, '\\end{itemize}')).toBe(2);
		expect(out).toContain(item + ' edited');
	});

	it('an untouched save is byte-identical', () => {
		const parsed = parseLatexFile(FILE);
		expect(serializeLatexFile(parsed, parsed.doc)).toBe(FILE);
	});

	it('editor-made list nodes still coalesce into one environment', () => {
		const item = (t: string) =>
			schema.node('list', { kind: 'bullet', order: null, checked: null, collapsed: false }, [
				schema.node('paragraph', null, [schema.text(t)])
			]);
		const doc = schema.node('doc', null, [item('a'), item('b')]);
		const out = serializeToLatex(doc);
		expect(count(out, '\\begin{itemize}')).toBe(1);
		expect(count(out, '\\end{itemize}')).toBe(1);
	});
});

// the first write after the edit, before the save check: what the source view and a collaborator see
describe('an item added to a list or moved a level', () => {
	const LISTS = `\\documentclass{article}
\\begin{document}
\\begin{enumerate}
	\\item First.
	\\item Second.
	\\begin{enumerate}
		\\item Nested.
	\\end{enumerate}
\\end{enumerate}

\\begin{itemize}
	\\item A.
	\\begin{itemize}
		\\item B.
		\\item C.
	\\end{itemize}
	\\item D.
\\end{itemize}
\\end{document}
`;

	function edit(words: string, command: Command, typed = ''): string {
		const parsed = parseLatexFile(LISTS);
		let at = -1;
		parsed.doc.descendants((node, pos) => {
			if (at < 0 && node.isText && node.text!.includes(words)) at = pos + node.text!.indexOf(words) + words.length;
			return at < 0;
		});
		let state = EditorState.create({ doc: parsed.doc });
		state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
		expect(command(state, (tr) => (state = state.apply(tr)))).toBe(true);
		if (typed) state = state.apply(state.tr.insertText(typed));
		return serializeLatexFile(parsed, state.doc);
	}

	it.each([
		['a new last item', 'D.', createSplitListCommand(), 'New.'],
		['a new nested item', 'Nested.', createSplitListCommand(), 'New.'],
		['a nested item brought out', 'Nested.', createDedentListCommand(), ''],
		['an item brought out beside the next', 'C.', createDedentListCommand(), ''],
		['an item taken in beside the nested ones', 'D.', createIndentListCommand(), '']
	])('%s keeps one environment per list', (_name, words, command, typed) => {
		const out = edit(words, command, typed);
		expect(count(out, '\\begin{enumerate}')).toBe(count(out, '\\end{enumerate}'));
		expect(count(out, '\\begin{itemize}')).toBe(2);
		expect(count(out, '\\end{itemize}')).toBe(2);
		if (typed) expect(out).toContain(`\\item ${typed}`);
	});
});
