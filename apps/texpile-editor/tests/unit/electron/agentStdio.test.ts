import { it, expect } from 'vitest';
import { agentStdio } from '../../../../../electron/src/ai/agentStdio';

it("wraps Antigravity's prompt as one message and reads the answer from its result event", () => {
	const io = agentStdio('agy');
	expect(JSON.parse(io.toStdin('make it shorter'))).toEqual({ event: 'user', message: { content: 'make it shorter' } });
	expect(io.toStdin('x').endsWith('\n')).toBe(true);

	const run = [
		'{"event":"init","init":{"model":"gemini-3.8-flash-low"}}',
		'{"event":"step_update","step_update":{"state":"ACTIVE","text_delta":"rea"}}',
		'{"event":"result","result":{"status":"SUCCESS","response":"ready\\n"}}',
		''
	].join('\n');
	expect(io.fromStdout(run)).toBe('ready\n');
	// a run that ended badly has no answer, so the error the agent printed is what the reader sees
	expect(io.fromStdout('{"event":"result","result":{"status":"ERROR","response":"nope"}}')).toBe('');
	expect(io.fromStdout('not json at all')).toBe('');
});

it('leaves every other agent to read the prompt as it is', () => {
	for (const choice of ['claude', 'codex', 'custom', '']) {
		expect(agentStdio(choice).toStdin('rewrite this')).toBe('rewrite this');
		expect(agentStdio(choice).fromStdout('the rewrite')).toBe('the rewrite');
	}
});
