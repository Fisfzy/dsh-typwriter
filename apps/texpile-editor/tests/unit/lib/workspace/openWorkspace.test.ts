// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { openFolderInWindow, provideFolderSwitch } from '$lib/workspace/openWorkspace';

describe('openFolderInWindow', () => {
	it('hands a folder pushed at an open workspace to its own switch, which sets the main file up', async () => {
		const switchFolder = vi.fn(async () => {});
		const release = provideFolderSwitch(switchFolder);
		expect(await openFolderInWindow('/papers/next')).toBe('opened');
		expect(switchFolder).toHaveBeenCalledWith('/papers/next', undefined);
		release();
	});
});
