// A rename or drag-move onto a name that already existed replaced that file silently, with nothing
// in the recycle bin and an undo that moved the survivor back, leaving nothing at the destination.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyFileOp } from '../../../../../electron/src/fs/fsService';

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'texpile-rename-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('fs op rename', () => {
	it('refuses to land on an existing file, leaving both in place', async () => {
		writeFileSync(join(dir, 'a.tex'), 'A');
		writeFileSync(join(dir, 'b.tex'), 'B');
		await expect(applyFileOp({ action: 'rename', from: join(dir, 'a.tex'), to: join(dir, 'b.tex') })).rejects.toThrow(/already exists/);
		expect(readFileSync(join(dir, 'a.tex'), 'utf8')).toBe('A');
		expect(readFileSync(join(dir, 'b.tex'), 'utf8')).toBe('B');
	});

	it('refuses a move into a folder holding the same name', async () => {
		mkdirSync(join(dir, 'sub'));
		writeFileSync(join(dir, 'fig.png'), 'top');
		writeFileSync(join(dir, 'sub', 'fig.png'), 'nested');
		await expect(applyFileOp({ action: 'rename', from: join(dir, 'fig.png'), to: join(dir, 'sub', 'fig.png') })).rejects.toThrow(
			/already exists/
		);
		expect(readFileSync(join(dir, 'sub', 'fig.png'), 'utf8')).toBe('nested');
	});

	it('still renames onto a free name, and still allows a case-only rename', async () => {
		writeFileSync(join(dir, 'a.tex'), 'A');
		await applyFileOp({ action: 'rename', from: join(dir, 'a.tex'), to: join(dir, 'c.tex') });
		expect(existsSync(join(dir, 'a.tex'))).toBe(false);
		expect(readFileSync(join(dir, 'c.tex'), 'utf8')).toBe('A');
		await applyFileOp({ action: 'rename', from: join(dir, 'c.tex'), to: join(dir, 'C.tex') });
		expect(readFileSync(join(dir, 'C.tex'), 'utf8')).toBe('A');
	});
});
