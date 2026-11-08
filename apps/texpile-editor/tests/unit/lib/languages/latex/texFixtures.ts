// the .tex files the source-map oracles run over: the repo's fixtures, plus VISUAL_FUZZ_CORPUS
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walk } from '../../workspace/visualEditsFuzz';

const FIXTURES = join(__dirname, '../../../../fixtures');
const LIVE = join(__dirname, '../../../../live/fixtures');

export const texFiles = [...walk(FIXTURES, /\.tex$/), ...walk(LIVE, /\.tex$/, 400_000)];
for (const dir of (process.env.VISUAL_FUZZ_CORPUS ?? '').split(';').filter(Boolean)) texFiles.push(...walk(dir, /\.tex$/, 400_000));

export function readTex(f: string): string {
	return readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
}
