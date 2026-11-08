import { it, expect } from 'vitest';
import { withDistribution } from '$lib/modals/window/distros.svelte';

it('puts the chosen install first, drops the other ones of its kind and keeps the rest of the folders', () => {
	const rows = [
		{
			entry: 'C:\\texlive\\2024\\bin\\windows',
			absolute: 'C:\\texlive\\2024\\bin\\windows',
			real: 'C:\\texlive\\2024\\bin\\windows',
			exists: true
		},
		{ entry: 'tools', absolute: 'D:\\app\\tools', real: 'D:\\app\\tools', exists: false },
		// MacTeX style: a folder of symlinks, listed by the spelling the user typed
		{ entry: '/Library/TeX/texbin', absolute: '/Library/TeX/texbin', real: '/usr/local/texlive/2025/bin/universal-darwin', exists: true }
	];
	const isDistro = (r: { real: string }) => /texlive|miktex/.test(r.real);
	expect(withDistribution(rows, isDistro, 'C:\\texlive\\2025\\bin\\windows')).toEqual(['C:\\texlive\\2025\\bin\\windows', 'tools']);
	expect(withDistribution(rows, isDistro, null)).toEqual(['tools']);
});
