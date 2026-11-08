// writing threads' detached and hidden verdicts back to the log
import type { CommentStore } from '$lib/comments/store.svelte';
import { placeEvent, type CommentEvent, type CommentThread } from '$lib/comments/log';
import { isSuggestion } from '$lib/comments/suggest';

type PlacementVerdictsDeps = {
	store: CommentStore;
	author: () => Promise<string>;
	commit: (...events: CommentEvent[]) => Promise<void>;
};

/**
 * ONLY the differences are written. Two reasons, and the second is not optional: appending on every
 * pass would grow a committed file every time anyone opened a folder, and - because appending
 * reassigns `store.threads`, which the controller's resolve() reads - it would re-enter resolve() and
 * append again, forever. Writing only deltas makes the second pass find nothing to say and stop.
 */
export class PlacementVerdicts {
	/** verdicts whose place event is still being written, keyed d:/h: + thread id; a second pass
	 *  landing before the first commit (a disk reload and a log refresh from one watcher event)
	 *  must not write the same line twice */
	private inFlight = new Map<string, boolean>();

	constructor(private readonly deps: PlacementVerdictsDeps) {}

	async detached(file: string, lost: Set<string>): Promise<void> {
		if (!this.deps.store.writable) return;
		const stale = this.deps.store.forFile(file).filter((t) => asFlag(t.detached) !== lost.has(t.id));
		await this.write('d:', stale, lost, (t) => ({ thread: t.id, detached: lost.has(t.id) }));
	}

	/** `file` is passed rather than taken as the open one because the report can land a beat after a file switch */
	async hidden(file: string, lost: Set<string>): Promise<void> {
		if (!this.deps.store.writable) return;
		const stale = this.deps.store.forFile(file).filter((t) => !isSuggestion(t) && asFlag(t.hidden) !== lost.has(t.id));
		await this.write('h:', stale, lost, (t) => ({ thread: t.id, hidden: lost.has(t.id) }));
	}

	private async write(
		key: 'd:' | 'h:',
		stale: CommentThread[],
		lost: Set<string>,
		fields: (t: CommentThread) => { thread: string; detached?: boolean; hidden?: boolean }
	): Promise<void> {
		const fresh = stale.filter((t) => this.inFlight.get(key + t.id) !== lost.has(t.id));
		if (fresh.length === 0) return;
		for (const t of fresh) this.inFlight.set(key + t.id, lost.has(t.id));
		try {
			const by = await this.deps.author();
			const at = new Date().toISOString();
			await this.deps.commit(...fresh.map((t) => placeEvent({ ...fields(t), by, at })));
		} finally {
			for (const t of fresh) this.inFlight.delete(key + t.id);
		}
	}
}

/**
 * An unrecorded status read as "fine", which is what makes browsing a project free.
 *
 * The panel only ever asks `if (t.detached)`, so "nobody has looked" and "looked, nothing wrong"
 * produce the same row. Telling them apart on disk would therefore buy nothing and cost a line per
 * thread the first time anyone opens each file - a committed log gaining hundreds of entries that
 * all say nothing is wrong. So only the interesting answer is written: `true` when the text has
 * gone, and `false` only to CORRECT a recorded `true` that is no longer so.
 */
function asFlag(v: boolean | undefined): boolean {
	return v === true;
}
