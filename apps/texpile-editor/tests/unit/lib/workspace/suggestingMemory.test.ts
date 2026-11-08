// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { savedSuggesting, setSuggesting } from '$lib/workspace/workspaceStore';

beforeEach(() => localStorage.clear());

it('remembers Suggesting per folder, and a folder never switched starts in Editing', () => {
	setSuggesting('C:/Papers/Review', true);
	expect(savedSuggesting('c:/papers/review/')).toBe(true);
	expect(savedSuggesting('C:/Papers/Mine')).toBe(false);
	setSuggesting('C:/Papers/Review', false);
	expect(savedSuggesting('C:/Papers/Review')).toBe(false);
	expect(JSON.parse(localStorage.getItem('texpile:workspaces')!).folders['c:/papers/review']).not.toHaveProperty('suggesting');
});
