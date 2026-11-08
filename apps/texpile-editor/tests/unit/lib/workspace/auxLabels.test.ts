import { describe, expect, it } from 'vitest';
import { parseAuxLabels } from '$lib/workspace/auxLabels';

describe('parseAuxLabels', () => {
	it('reads the counter from cleveref twins and hyperref anchors, and the title', () => {
		const aux = [
			'\\newlabel{fig:a}{{3}{5}{A caption}{figure.3}{}}',
			'\\newlabel{fig:a@cref}{{[figure][3][]3}{[1][5][]5}}',
			'\\newlabel{lem:b}{{2.1}{7}{}{theorem.2.1}{}}',
			'\\newlabel{lem:b@cref}{{[lemma][1][2]2.1}{[1][7][]7}}',
			'\\newlabel{sec:c}{{4}{9}{Results}{section.4}{}}',
			'\\newlabel{eq:plain}{{1}{2}}'
		].join('\n');
		const { numbers, pages, kinds, titles } = parseAuxLabels(aux);
		expect(numbers).toEqual({ 'fig:a': '3', 'lem:b': '2.1', 'sec:c': '4', 'eq:plain': '1' });
		expect(pages['sec:c']).toBe('9');
		// the twin names the counter a shared-counter theorem style hides behind "theorem"
		expect(kinds).toEqual({ 'fig:a': 'figure', 'lem:b': 'lemma', 'sec:c': 'section' });
		expect(titles).toEqual({ 'fig:a': 'A caption', 'sec:c': 'Results' });
	});
});
