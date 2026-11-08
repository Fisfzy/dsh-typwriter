import { describe, it, expect } from 'vitest';
import { VisualParser, MAX_VISUAL_BYTES } from '$lib/workspace/visualParse.svelte';

describe('VisualParser size cap', () => {
	it('refuses a file past the byte cap before parsing, with the size for the toast', async () => {
		const parser = new VisualParser(() => '');
		const outcome = await parser.parse('a'.repeat(MAX_VISUAL_BYTES + 1));
		expect(outcome.parsed).toBeUndefined();
		expect(outcome.failure?.tooLarge).toBe(MAX_VISUAL_BYTES + 1);
		expect(outcome.failure?.timeout).toBe(false);
	});
});
