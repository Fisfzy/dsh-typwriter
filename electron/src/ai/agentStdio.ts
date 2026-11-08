// How a prompt reaches an agent and its answer comes back. Most read the prompt as plain text and print the answer;
// Antigravity takes one JSON message per turn, because a prompt passed on its command line is dropped
import type { AgentChoice } from './agentCommand';

export type AgentStdio = {
	toStdin(prompt: string): string;
	fromStdout(out: string): string;
};

const PLAIN: AgentStdio = {
	toStdin: (prompt) => prompt,
	fromStdout: (out) => out
};

const STREAM_JSON: AgentStdio = {
	toStdin: (prompt) => JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n',
	/** the run's own "result" event holds the whole answer; the steps before it are deltas */
	fromStdout(out) {
		for (const line of out.split('\n').reverse()) {
			let event: { event?: unknown; result?: { status?: unknown; response?: unknown } };
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}
			if (event.event !== 'result') continue;
			return event.result?.status === 'SUCCESS' && typeof event.result.response === 'string' ? event.result.response : '';
		}
		return '';
	}
};

export function agentStdio(choice: unknown): AgentStdio {
	return (choice as AgentChoice) === 'agy' ? STREAM_JSON : PLAIN;
}
