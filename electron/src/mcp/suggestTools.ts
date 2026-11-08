// The one tool that changes a document: an edit that lands as a suggestion the reader accepts or rejects
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { relayer, type TargetWindow } from './relay';
import { byArg, pickArgs, rootArg } from './commentTools';

export function registerSuggestTools(server: McpServer, target: TargetWindow): void {
	const relay = relayer(target);

	server.registerTool(
		'suggest_edit',
		{
			title: 'Suggest an edit',
			description:
				'Put a change into the open file as a suggestion under your name: the new words go in, the old ones ' +
				'show struck through, and the reader accepts or rejects it. Use it for wording the author should ' +
				'review (a rewrite, a grammar fix, a fix for a compile error), and your own file tools for mechanical ' +
				'edits. The quote must match the editor buffer exactly, markup included, and be found once; pass ' +
				'prefix, suffix or line to pick between copies. Only the file open in the editor takes suggestions, so ' +
				'open_file first. Refused when the replacement cites a key the bibliography does not have or drops a ' +
				'\\label. Replies with the suggestion id; get_comments reports its decision once the reader acts on it.',
			inputSchema: {
				path: z.string().describe('workspace-relative path of the open file'),
				quote: z.string().describe('the exact text to replace, as the file has it'),
				replacement: z.string().describe('the new text; empty to suggest deleting the quote'),
				note: z.string().optional().describe('a few words shown on the suggestion, such as "shorter" or "fixes the undefined reference"'),
				...pickArgs,
				by: byArg,
				root: rootArg
			}
		},
		// longer than the default wait: a visual editor re-reads the changed paragraph before it can answer
		({ path: p, quote, replacement, note, prefix, suffix, line, by, root }) =>
			relay(root, 'suggest_edit', { path: p, quote, replacement, note, prefix, suffix, line, by }, 10000)
	);
}
