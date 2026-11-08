import { it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runAgent } from '../../../../../electron/src/ai/runAgent';
import { agentArgv, SYSTEM_FILE } from '../../../../../electron/src/ai/agentCommand';

// a space in the folder, as under C:\Users\First Last, which the command lines have to survive
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texpile agent '));
const echo = path.join(dir, 'echo.mjs');
fs.writeFileSync(echo, "let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => process.stdout.write(s.toUpperCase()));");
const rules = path.join(dir, 'rules.mjs');
fs.writeFileSync(
	rules,
	"import { readFileSync } from 'node:fs'; let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => process.stdout.write(readFileSync(process.argv[2], 'utf8') + '|' + s));"
);
const slow = path.join(dir, 'slow.mjs');
fs.writeFileSync(slow, 'setTimeout(() => {}, 60000);');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

it('hands a custom command the rules and the request on stdin and reads its answer from stdout', async () => {
	const argv = agentArgv('custom', `"${process.execPath}" "${echo}"`);
	expect(argv).toEqual([process.execPath, echo]);
	expect(await runAgent(argv!, { system: 'be brief', request: 'make it shorter' }, new AbortController().signal)).toEqual({
		ok: true,
		text: 'BE BRIEF\n\nMAKE IT SHORTER'
	});
});

it('writes the rules to a file for an agent that takes them in place of its own, and sends it the request alone', async () => {
	expect(
		await runAgent([process.execPath, rules, SYSTEM_FILE], { system: 'be brief', request: 'make it shorter' }, new AbortController().signal)
	).toEqual({
		ok: true,
		text: 'be brief|make it shorter'
	});
});

// npm and pnpm put an agent on PATH as a .cmd launcher, which only cmd.exe can start
it.runIf(process.platform === 'win32')('starts a .cmd launcher through cmd.exe', async () => {
	const launcher = path.join(dir, 'agent.cmd');
	fs.writeFileSync(launcher, `@"${process.execPath}" "${echo}"\r\n`);
	expect(await runAgent([launcher, '--tools', ''], { system: '', request: 'fix the grammar' }, new AbortController().signal)).toEqual({
		ok: true,
		text: 'FIX THE GRAMMAR'
	});
});

it('ends the agent when the reader cancels', async () => {
	const abort = new AbortController();
	const run = runAgent([process.execPath, slow], { system: '', request: 'x' }, abort.signal);
	setTimeout(() => abort.abort(), 300);
	expect(await run).toMatchObject({ ok: false, cancelled: true });
});
