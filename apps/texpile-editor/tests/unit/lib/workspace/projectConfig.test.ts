// .texpile/config.json is hand-editable and git-merged, so readProjectConfig's contract is that
// nothing that comes out of it can be the wrong shape - a bad field reads as "not written", and a
// bad file reads as no file, never as a half-applied one.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ fs: {} as Record<string, string> }));

vi.mock('../../../../src/lib/workspace/fileSystem', () => ({
	readTextFile: async (path: string): Promise<string> => {
		const key = path.replace(/\\/g, '/');
		if (!(key in h.fs)) throw new Error('ENOENT: ' + path);
		return h.fs[key];
	},
	statFile: async (path: string) => ({ exists: path.replace(/\\/g, '/') in h.fs, mtimeMs: 0, size: 0 }),
	writeTextFile: async (path: string, content: string) => {
		h.fs[path.replace(/\\/g, '/')] = content;
	}
}));
vi.mock('../../../../src/lib/workspace/texpileDir', () => ({ ensureTexpileIgnore: async () => {} }));

import { readProjectConfig } from '../../../../src/lib/workspace/projectConfig';

const ROOT = '/proj';
const put = (cfg: unknown) => {
	h.fs['/proj/.texpile/config.json'] = typeof cfg === 'string' ? cfg : JSON.stringify(cfg);
};

beforeEach(() => {
	h.fs = {};
});

describe('readProjectConfig', () => {
	it('reads a well-formed file through unchanged', async () => {
		put({ v: 1, main: 'chapters/main.typ', latex: { command: 'latexmk {main}' }, typst: { outputs: { pdf: 'out/main.pdf' } } });
		expect(await readProjectConfig(ROOT)).toEqual({
			v: 1,
			main: 'chapters/main.typ',
			latex: { command: 'latexmk {main}' },
			typst: { outputs: { pdf: 'out/main.pdf' } }
		});
	});

	it('drops a main that is not a compilable kind, so a hand-edited .md never becomes {main}', async () => {
		put({ v: 1, main: 'notes.md', latex: { command: 'x {main}' } });
		expect(await readProjectConfig(ROOT)).toEqual({ v: 1, latex: { command: 'x {main}' } });
	});

	it('drops a main that walks out of the project', async () => {
		for (const bad of ['../outside.tex', '/etc/x.tex', 'C:/x.typ', 'a/../../x.typ', 'a\\b.tex']) {
			put({ v: 1, main: bad });
			expect((await readProjectConfig(ROOT))?.main, bad).toBeUndefined();
		}
	});

	it('keeps the empty-string main: it is the explicit "no main", distinct from absent', async () => {
		put({ v: 1, main: '' });
		expect((await readProjectConfig(ROOT))?.main).toBe('');
		put({ v: 1 });
		expect((await readProjectConfig(ROOT))?.main).toBeUndefined();
	});

	it('drops fields of the wrong type instead of storing nonsense', async () => {
		put({ v: 1, main: 42, latex: 'yes', typst: { command: 7, outputs: { pdf: 3, log: 'out/main.log' } } });
		expect(await readProjectConfig(ROOT)).toEqual({ v: 1, typst: { outputs: { log: 'out/main.log' } } });
	});

	it('reads corrupt JSON and unknown versions as no config at all', async () => {
		put('{ not json');
		expect(await readProjectConfig(ROOT)).toBeNull();
		put({ v: 2, main: 'main.tex' });
		expect(await readProjectConfig(ROOT)).toBeNull();
		put(['array']);
		expect(await readProjectConfig(ROOT)).toBeNull();
	});
});
