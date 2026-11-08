// which threads the comment panel badges
import type { CommentAnchor } from '$lib/comments/anchor';
import type { CommentThread } from '$lib/comments/log';
import { isSuggestion } from '$lib/comments/suggest';
import type { CommentRange } from '$lib/editor/visual/extensions/comments';

export function placementBadges(
	threads: CommentThread[],
	file: string | null,
	lostHere: Set<string>,
	hiddenHere: Set<string>,
	visual: boolean
): { orphaned: Set<string>; hidden: Set<string> } {
	const orphaned = new Set(lostHere);
	for (const t of threads) if (t.file !== file && t.detached) orphaned.add(t.id);
	const hidden = new Set<string>();
	if (visual) {
		for (const id of hiddenHere) hidden.add(id);
		for (const t of threads) if (t.file !== file && t.hidden) hidden.add(t.id);
	}
	return { orphaned, hidden };
}

export function ghostThreads(ranges: CommentRange[], threads: CommentThread[], known: Map<string, CommentAnchor>): Set<string> {
	const out = new Set<string>();
	const expanded = new Set(ranges.filter((r) => r.to > r.from).map((r) => r.id));
	for (const r of ranges) if (r.to === r.from) out.add(r.id);
	for (const t of threads) if (!t.anchor.quote && !expanded.has(t.id) && !isSuggestion(t)) out.add(t.id);
	for (const [id, a] of known) if (!a.quote && !expanded.has(id)) out.add(id);
	return out;
}
