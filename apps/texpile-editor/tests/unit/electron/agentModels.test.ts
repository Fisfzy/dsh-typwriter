import { it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { askModels } from '../../../../../electron/src/ai/agentModels';
import { agentArgv } from '../../../../../electron/src/ai/agentCommand';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texpile models '));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// reads JSON lines from stdin and answers each with the script's reply(msg, send)
function fakeAgent(name: string, reply: string): string[] {
	const file = path.join(dir, name);
	fs.writeFileSync(
		file,
		`const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
		const reply = ${reply};
		let rest = '';
		process.stdin.on('data', (d) => {
			const lines = (rest + d).split('\\n');
			rest = lines.pop();
			for (const l of lines) reply(JSON.parse(l), send);
		});`
	);
	return [process.execPath, file];
}

// prints its list and exits, the way a plain `models` command does
function fakeLister(name: string, body: string): string[] {
	const file = path.join(dir, name);
	fs.writeFileSync(file, body);
	return [process.execPath, file];
}

it("reads Claude Code's models from its SDK handshake, its default as ''", async () => {
	const claude = fakeAgent(
		'claude.mjs',
		`(msg, send) => {
			if (msg.request?.subtype !== 'initialize') return;
			send({ type: 'system', subtype: 'hello' });
			send({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: { models: [
				{ value: 'default', displayName: 'Default (recommended)', description: 'Opus 5' },
				{ value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5' }
			] } } });
		}`
	);
	expect(await askModels(claude, 'claude', '1.0.0')).toEqual({
		ok: true,
		models: [
			{ id: '', name: 'Default (recommended)', description: 'Opus 5' },
			{ id: 'haiku', name: 'Haiku', description: 'Haiku 4.5' }
		]
	});
});

// the app server answers model/list only after initialize and the initialized notice, a page at a time
it("reads every page of Codex's model/list after the handshake, leaving hidden models out", async () => {
	const codex = fakeAgent(
		'codex.mjs',
		`(() => {
			let ready = false;
			return (msg, send) => {
				if (msg.method === 'initialize') return send({ id: msg.id, result: { userAgent: 'codex' } });
				if (msg.method === 'initialized') return void (ready = true);
				if (msg.method !== 'model/list') return;
				if (!ready) return send({ id: msg.id, error: { message: 'not initialized' } });
				const first = !msg.params.cursor;
				send({ id: msg.id, result: first
					? { data: [{ id: 'a', model: 'gpt-a', displayName: 'A', description: 'first', hidden: false }], nextCursor: 'p2' }
					: { data: [{ id: 'b', model: 'gpt-b', displayName: 'B', description: '', hidden: false }, { id: 'h', model: 'gpt-h', displayName: 'H', description: '', hidden: true }], nextCursor: null } });
			};
		})()`
	);
	expect(await askModels(codex, 'codex', '1.0.0')).toEqual({
		ok: true,
		models: [
			{ id: 'gpt-a', name: 'A', description: 'first' },
			{ id: 'gpt-b', name: 'B', description: '' }
		]
	});
});

it("reads Antigravity's models from the list it prints", async () => {
	const agy = fakeLister(
		'agy.mjs',
		// the first line has no tab, as the real one's "Fetching available models..." does not
		`process.stdout.write(["Fetching available models...", "gemini-3.8-flash-low\\tGemini 3.8 Flash (Low)", "claude-sonnet-4-6\\tClaude Sonnet 4.6 (Thinking)", ""].join("\\n"));`
	);
	expect(await askModels(agy, 'agy', '1.0.0')).toEqual({
		ok: true,
		models: [
			{ id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)', description: '' },
			{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)', description: '' }
		]
	});
});

it('asks a preset for the chosen model, keeping Codex reading its prompt from stdin', () => {
	expect(agentArgv('claude', '', 'haiku')?.slice(0, 3)).toEqual(['claude', '--model=haiku', '-p']);
	expect(agentArgv('agy', '', 'gemini-3.8-flash-low')?.slice(0, 2)).toEqual(['agy', '--model=gemini-3.8-flash-low']);
	const codex = agentArgv('codex', '', 'gpt-a')!;
	expect(codex.slice(0, 3)).toEqual(['codex', 'exec', '--model=gpt-a']);
	expect(codex.at(-1)).toBe('-');
	expect(agentArgv('custom', 'ollama run llama3.1', 'haiku')).toEqual(['ollama', 'run', 'llama3.1']);
});
