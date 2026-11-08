// @vitest-environment jsdom
// a guest keeps the host's suggestions placed while the text moves under it, and its decisions
// reach the host before the edit they cause
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { buildAnchor } from '$lib/comments/anchor';
import { anchorEvent, openEvent, type CommentEvent } from '$lib/comments/log';
import { activeSuggestions } from '$lib/comments/activeSuggestions.svelte';

let disk: Record<string, string> = {};

vi.mock('$lib/workspace/fileSystem', () => ({
	readTextFile: async (path: string) => {
		const hit = Object.entries(disk).find(([k]) => path.replace(/\\/g, '/').endsWith(k));
		if (!hit) throw new Error(`ENOENT ${path}`);
		return hit[1];
	},
	writeTextFile: async () => {
		throw new Error('a guest has no disk');
	},
	joinPath: (a: string, b: string) => `${a}/${b}`
}));
vi.mock('$lib/workspace/texpileDir', () => ({
	texpilePath: () => null,
	ensureTexpileIgnore: async () => {}
}));
vi.mock('$lib/comments/author', () => ({ resolveAuthor: async () => 'guest', forgetAuthor: () => {} }));

const { CommentsController } = await import('$lib/workspace/commentsController.svelte');
const { commentLogOf, shareComments } = await import('$lib/collab/sharedComments');

const ROOT = 'session';
const FILE = `${ROOT}/main.tex`;
const TEXT = 'We prove the estimator is sharp for smooth solutions.\n';

function suggestion(id: string, text: string, words: string, restore: string) {
	const at = text.indexOf(words);
	return openEvent({ id, file: 'main.tex', anchor: buildAnchor(text, at, at + words.length), body: '', by: 'host', at: 'now', restore });
}

function guest(initial: string, mode: 'editing' | 'suggesting' = 'editing') {
	let text = initial;
	const trace: string[] = [];
	// the host's copy of the shared doc and this guest's, passing changes straight across
	const hostDoc = new Y.Doc();
	const guestDoc = new Y.Doc();
	hostDoc.on('update', (u: Uint8Array, origin: unknown) => origin !== guestDoc && Y.applyUpdate(guestDoc, u, hostDoc));
	guestDoc.on('update', (u: Uint8Array, origin: unknown) => origin !== hostDoc && Y.applyUpdate(hostDoc, u, guestDoc));
	commentLogOf(guestDoc).observe((ev, tr) => {
		if (!tr.local) return;
		for (const d of ev.changes.delta)
			for (const line of (d.insert ?? []) as string[]) {
				const e = JSON.parse(line) as CommentEvent;
				trace.push(`share ${e.t}${e.t === 'resolve' ? ` ${e.decision ?? 'reopened'}` : ''}`);
			}
	});
	const ctl = new CommentsController({
		root: () => ROOT,
		preferredAuthor: () => 'guest',
		openFileAt: () => {},
		activeText: () => text,
		mode: () => mode,
		compares: () => false,
		applyEdit: async (e) => {
			trace.push('edit');
			text = text.slice(0, e.from) + e.insert + text.slice(e.to);
			return true;
		},
		saveNow: () => {}
	});
	const remote = async (next: string) => {
		text = next;
		ctl.suggestions.textChanged(FILE, text);
		await ctl.suggestions.settle();
	};
	const join = async (log: CommentEvent[]) => {
		await ctl.load(null);
		ctl.reanchor(FILE, text);
		commentLogOf(hostDoc).push(log.map((e) => JSON.stringify(e)));
		shareComments(ctl, commentLogOf(guestDoc), 'guest');
	};
	/** the host adding to the session's log */
	const hostAdds = (e: CommentEvent) => commentLogOf(hostDoc).push([JSON.stringify(e)]);
	return { ctl, trace, join, remote, hostAdds, text: () => text };
}

describe('a guest in a shared session', () => {
	beforeEach(() => {
		disk = {};
		activeSuggestions.current = [];
	});

	it('puts the old words back after the host edited elsewhere, telling the host first', async () => {
		const g = guest(TEXT);
		await g.join([suggestion('s1', TEXT, 'sharp', 'reliable')]);
		await g.remote('Note. ' + TEXT);
		expect(activeSuggestions.current.map((s) => g.text().slice(s.from, s.to))).toEqual(['sharp']);
		expect(await g.ctl.suggestions.reject(g.ctl.threads[0])).toBe(true);
		expect(g.text()).toBe('Note. We prove the estimator is reliable for smooth solutions.\n');
		expect(g.trace).toEqual(['share resolve rejected', 'edit']);
	});

	it('places a suggestion that arrives before the text it sits in', async () => {
		const g = guest(TEXT);
		await g.join([]);
		const after = TEXT.replace('sharp', 'tight');
		g.hostAdds(suggestion('s2', after, 'tight', 'sharp'));
		expect(g.ctl.orphaned.has('s2')).toBe(true);
		await g.remote(after);
		expect(g.ctl.orphaned.has('s2')).toBe(false);
		expect(activeSuggestions.current.map((s) => [after.slice(s.from, s.to), s.restore])).toEqual([['tight', 'sharp']]);
	});

	it('keeps drawing its own deletions until the host has recorded all of them', async () => {
		const g = guest(TEXT, 'suggesting');
		await g.join([]);
		const one = TEXT.replace('sharp', 'shar');
		const two = TEXT.replace('sharp', 'sha');
		await g.remote(one);
		await g.remote(two);
		const at = one.indexOf('shar') + 4;
		g.hostAdds(openEvent({ id: 's3', file: 'main.tex', anchor: buildAnchor(one, at, at), body: '', by: 'guest', at: 'now', restore: 'p' }));
		expect(activeSuggestions.current.map((s) => s.restore)).toEqual(['rp']);
		g.hostAdds(anchorEvent({ thread: 's3', anchor: buildAnchor(two, at - 1, at - 1), restore: 'rp', by: 'guest', at: 'now' }));
		expect(activeSuggestions.current.map((s) => [s.id, s.restore])).toEqual([['s3', 'rp']]);
	});
});
