// Discarding an edit reverts the file to text the visual-doc cache already holds, so the reload
// hands the view back the very node it was built from. Deciding off the last node the host
// installed called that "nothing to do", left the discarded edits on screen, and the next save
// wrote them back to disk.
import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { docSwapKind } from '$lib/editor/visual/docSwap';

const schema = new Schema({
	nodes: {
		doc: { content: 'paragraph+' },
		paragraph: { content: 'text*', toDOM: () => ['p', 0] },
		text: {}
	}
});

const docOf = (text: string) => schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])]);

describe('docSwapKind', () => {
	it('reloads the same file when the view has drifted from the node it was built with', () => {
		const opened = docOf('as saved');
		const edited = docOf('as saved, plus a discarded edit');
		expect(docSwapKind(opened, edited, '/w/main.tex', '/w/main.tex')).toBe('reload');
	});

	it('does nothing when the view already shows that document', () => {
		const mounted = docOf('as saved');
		expect(docSwapKind(mounted, mounted, '/w/main.tex', '/w/main.tex')).toBe('none');
	});

	it('treats a different path as another file', () => {
		expect(docSwapKind(docOf('a'), docOf('b'), '/w/other.tex', '/w/main.tex')).toBe('newFile');
	});
});
