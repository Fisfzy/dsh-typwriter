import { describe, expect, it } from 'vitest';
import { Schema } from 'prosemirror-model';
import { baseMarks } from '$lib/editor/visual/schema/baseMarks';
import { blockSpellText, harperReading, readableSpellText } from '$lib/editor/spellcheck/blockSpellText';
import { parseLatexFile } from '$lib/workspace/latexRoundtrip';

const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		paragraph: { content: 'inline*', group: 'block' },
		text: { group: 'inline' }
	},
	marks: baseMarks
});

const link = (text: string, href = 'https://exmaple.com') => schema.text(text, [schema.marks.link.create({ href })]);

describe('blockSpellText', () => {
	it('blanks link text and keeps every offset', () => {
		const p = schema.nodes.paragraph.create(null, [
			schema.text('See '),
			link('exmaple.com', 'https://exmaple.com'),
			schema.text(' for detials.')
		]);
		const out = blockSpellText(p);
		expect(out).toBe('See ' + ' '.repeat('exmaple.com'.length) + ' for detials.');
		expect(out.length).toBe(p.textContent.length);
		expect(out.indexOf('detials')).toBe(p.textContent.indexOf('detials'));
	});

	it('reads an accent chip as its letter and puts every squiggle on its own word', async () => {
		const source =
			'\\begin{document}\nThe Poincar\\\'e map in \\cref{a} is usefull\\\\ and hides no misteak\\\\ from Na\\"{\\i}ve secnd readers.\n\\end{document}\n';
		const doc = parseLatexFile(source).doc;
		const paragraph = doc.child(0);
		const [{ LocalLinter }, { binaryInlined }] = await Promise.all([import('harper.js'), import('harper.js/binaryInlined')]);
		const linter = new LocalLinter({ binary: binaryInlined });
		const block = blockSpellText(paragraph);
		expect(block.length).toBe(paragraph.content.size);
		const reading = harperReading(block);
		const flagged = (await linter.lint(reading.text)).map((lint) => {
			const { offset, length } = reading.blockSpan(lint.span().start, lint.span().end - lint.span().start);
			return [paragraph.textBetween(offset, offset + length), readableSpellText(block.slice(offset, offset + length))];
		});
		expect(flagged).toEqual([
			["Poincar\\'e", 'Poincaré'],
			['usefull', 'usefull'],
			['misteak', 'misteak'],
			['secnd', 'secnd']
		]);
	});
});
