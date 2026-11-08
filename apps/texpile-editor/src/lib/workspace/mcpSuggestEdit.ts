// Renderer end of the MCP suggest_edit tool: an agent's change put into the open file as a suggestion under the
// agent's name, found with the same search the comment tools use
import { workspaceRoot } from './workspaceStore';
import { relativeTo } from '$lib/comments/store.svelte';
import { dialectOfPath } from '$lib/comments/anchor';
import { lineOf } from '$lib/comments/anchorLocate';
import { collabHost } from '$lib/collab/hostStore.svelte';
import { projectIntelStore } from '$lib/stores/projectIntel';
import { agentEditProblem, knownCiteKeys } from '$lib/ai/agentEditGuard';
import { authorOf, fail, locate, NO_LOG, readTarget, relOf, str, type Args, type McpCommentDeps } from './mcpComments';

export async function suggestEditPayload(deps: McpCommentDeps, a: Args) {
	const ctl = deps.comments;
	const root = workspaceRoot.current;
	if (!root) return fail('no folder is open');
	if (!ctl.store.writable) return fail(NO_LOG);
	// suggesting is off while a session is hosted, see WorkspaceComments
	if (collabHost.active) return fail('suggestions are off while this window hosts a shared session');
	const rel = relOf(a.path);
	if (!rel) return fail('path is required');
	const replacement = str(a.replacement);
	if (replacement === undefined) return fail('replacement is required');
	const loaded = deps.getLoadedPath();
	if (!loaded || relativeTo(root, loaded) !== rel) return fail('suggestions go into the open file; open this one with open_file first');
	const target = await readTarget(deps, rel);
	if (!target.ok) return target;
	const loc = locate(target.src, rel, a);
	if (!loc.ok) return loc;
	const found = target.src.text.slice(loc.from, loc.to);
	// a loose match can span markup the replacement never saw, and replacing it would drop that markup
	if (found !== str(a.quote)) return fail('the quote only matched loosely; pass it exactly as the file has it, markup included');
	if (found === replacement) return fail('the replacement is the same as the quote');
	const known = knownCiteKeys(
		target.src.text,
		projectIntelStore.current.bibEntries.map((e) => e.key)
	);
	const problem = agentEditProblem(dialectOfPath(rel), found, replacement, known);
	if (problem && 'invented' in problem) return fail(`it cites ${problem.invented.join(', ')}, which the bibliography does not have`);
	if (problem) return fail(`it drops \\label{${problem.lost.join('}, \\label{')}}, which references may point at`);
	const id = await ctl.suggestions.suggestAs(authorOf(a), { from: loc.from, to: loc.to, insert: replacement }, str(a.note)?.trim() ?? '');
	if (!id) return fail('the editor did not take the edit; the text may have changed meanwhile');
	return { ok: true, suggestion: id, file: rel, line: lineOf(target.src.text, loc.from) };
}
