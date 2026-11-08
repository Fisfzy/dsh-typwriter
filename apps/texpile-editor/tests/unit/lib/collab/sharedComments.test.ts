// @vitest-environment jsdom
// the session's comment log in the shared doc, through the real session engine: sealed frames over a
// relay that delivers late and out of order, guests dropping off and coming back
import { it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { deriveSessionKeys } from '$lib/collab/e2e/keys';
import { generateShareCode } from '$lib/collab/e2e/shareCode';
import { CollabSession } from '$lib/collab/session';
import type { RelayNotice } from '$lib/collab/protocol';
import type { Transport, TransportStatus } from '$lib/collab/transport';
import { buildAnchor } from '$lib/comments/anchor';
import { foldLog, openEvent, parseLog, replyEvent } from '$lib/comments/log';

let disk: Record<string, string> = {};

vi.mock('$lib/workspace/fileSystem', () => ({
	readTextFile: async (path: string) => {
		const hit = disk[path.replace(/\\/g, '/').replace(/^\/w\//, '')];
		if (hit === undefined) throw new Error(`ENOENT ${path}`);
		return hit;
	},
	writeTextFile: async (path: string, text: string) => {
		disk[path.replace(/\\/g, '/').replace(/^\/w\//, '')] = text;
	},
	joinPath: (a: string, b: string) => `${a}/${b}`
}));
vi.mock('$lib/workspace/texpileDir', () => ({
	texpilePath: (root: string, name: string) => (root === 'session' ? null : `${root}/.texpile/${name}`),
	ensureTexpileIgnore: async () => {}
}));
vi.mock('$lib/comments/author', () => ({ resolveAuthor: async () => 'someone', forgetAuthor: () => {} }));

const { CommentsController } = await import('$lib/workspace/commentsController.svelte');
const { commentLogOf, shareComments } = await import('$lib/collab/sharedComments');

const LOG = '.texpile/comments.jsonl';
const RUNS = Number(process.env.SHARED_COMMENTS_RUNS ?? 6);
const TEXT = 'We prove the estimator is sharp for smooth solutions of the problem.\n';

/** deterministic PRNG (mulberry32) so a failure reproduces byte-for-byte */
function rng(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

class Relay {
	transports = new Set<Link>();
	constructor(readonly delay: () => number) {}
	deliver(from: Link, data: Uint8Array): void {
		for (const t of this.transports)
			if (t !== from) setTimeout(() => t.transports() && t.onMessage?.(data, from.role === 'host'), this.delay());
	}
}

class Link implements Transport {
	onMessage: ((data: Uint8Array, fromHost: boolean) => void) | null = null;
	onNotice: ((n: RelayNotice) => void) | null = null;
	onStatus: ((s: TransportStatus, detail?: string) => void) | null = null;
	private up = false;
	constructor(
		private relay: Relay,
		readonly role: 'host' | 'guest'
	) {}
	transports(): boolean {
		return this.up;
	}
	start(): void {
		this.up = true;
		this.relay.transports.add(this);
		setTimeout(() => this.onStatus?.('connected'), 0);
	}
	send(data: Uint8Array<ArrayBuffer>): void {
		if (this.up) this.relay.deliver(this, data);
	}
	/** off the relay without ending the session, as a lost connection is */
	drop(): void {
		this.up = false;
		this.relay.transports.delete(this);
	}
	close(): void {
		this.drop();
	}
}

async function until(cond: () => boolean, ms = 15000, what = 'condition'): Promise<void> {
	const t0 = Date.now();
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error(`${what} not reached in time`);
		await new Promise((r) => setTimeout(r, 5));
	}
}

async function startSession(delay: () => number, log = '') {
	disk = { [LOG]: log };
	const key = (await deriveSessionKeys(generateShareCode())).contentKey;
	const relay = new Relay(delay);
	const stops: (() => void)[] = [];
	async function party(role: 'host' | 'guest', name: string) {
		const doc = new Y.Doc();
		const link = new Link(relay, role);
		const session = new CollabSession({ doc, transport: link, key, role, user: { name, color: '#123456' }, events: {} });
		link.start();
		const ctl = new CommentsController({
			root: () => (role === 'host' ? '/w' : 'session'),
			preferredAuthor: () => name,
			openFileAt: () => {},
			compares: () => role === 'host'
		});
		await ctl.load(role === 'host' ? '/w' : null);
		stops.push(() => session.destroy());
		return { name, doc, link, session, ctl, log: () => commentLogOf(doc).toArray() };
	}
	const host = await party('host', 'louis');
	stops.push(shareComments(host.ctl, commentLogOf(host.doc), 'host'));
	async function join(name: string) {
		const guest = await party('guest', name);
		stops.push(shareComments(guest.ctl, commentLogOf(guest.doc), 'guest'));
		return guest;
	}
	return { host, join, close: () => stops.reverse().forEach((stop) => stop()) };
}

type Party = Awaited<ReturnType<Awaited<ReturnType<typeof startSession>>['join']>>;

const shape = (p: Party) => JSON.stringify(p.ctl.threads);

it('keeps out what the host would not write, for every side', async () => {
	const s = await startSession(() => 0);
	const mei = await s.join('mei');
	const ada = await s.join('ada');
	await until(() => ada.session.peers.size === 2 && mei.session.peers.size === 2);
	const anchor = buildAnchor(TEXT, 3, 8);
	const good = JSON.stringify(openEvent({ id: 'ok', file: 'main.tex', by: 'mei', body: 'fine', anchor, at: 'now' }));
	const bad = [
		'not json',
		JSON.stringify({ v: 1, t: 'open', id: 'x' }),
		JSON.stringify(openEvent({ id: 'up', file: '../outside.tex', by: 'mei', body: 'no', anchor, at: 'now' })),
		JSON.stringify(openEvent({ id: 'git', file: '.git/config', by: 'mei', body: 'no', anchor, at: 'now' }))
	];
	(commentLogOf(mei.doc) as Y.Array<unknown>).push([...bad, 42, good]);
	await until(() => s.host.ctl.threads.length === 1 && ada.log().length === 1 && mei.log().length === 1, 15000, 'the refusal');
	expect(ada.ctl.threads.map((t) => t.id)).toEqual(['ok']);
	expect(mei.log()).toEqual([good]);
	await until(() => disk[LOG] === good + '\n');
	s.close();
});

it('gives a guest joining late the whole log, a long one included', async () => {
	const anchor = buildAnchor(TEXT, 3, 8);
	const lines = [JSON.stringify(openEvent({ id: 't', file: 'main.tex', by: 'louis', body: 'first', anchor, at: 'now' }))];
	for (let i = 0; i < 8000; i++)
		lines.push(
			JSON.stringify(replyEvent({ id: `r${i}`, thread: 't', by: 'louis', body: `reply number ${i} to the first comment`, at: `t${i}` }))
		);
	const s = await startSession(() => 0, lines.join('\n') + '\n');
	const mei = await s.join('mei');
	await until(() => mei.ctl.threads[0]?.messages.length === 8001, 20000, 'the long log');
	expect(shape(mei)).toBe(JSON.stringify(s.host.ctl.threads));
	s.close();
});

// the oracle: whatever the sides do at the same moment, and whoever drops off meanwhile, every side ends
// on the same threads, the host's file says the same, and a guest joining afterwards sees it too
it(
	'ends with every side on the same threads, whatever they did at once',
	async () => {
		for (let seed = 1; seed <= RUNS; seed++) {
			const rand = rng(seed);
			const pick = <T>(xs: T[]): T | undefined => xs[Math.floor(rand() * xs.length)];
			const s = await startSession(() => rand() * 20);
			const guests = [await s.join('mei'), await s.join('ada'), await s.join('bo')];
			const all = [s.host, ...guests];
			await until(() => all.every((p) => p.session.peers.size === 3), 15000, 'everyone meeting');
			const pending: Promise<unknown>[] = [];
			for (let step = 0; step < 120; step++) {
				const p = pick(all)!;
				const roll = rand();
				const thread = pick(p.ctl.threads);
				const message = thread && pick(thread.messages);
				const from = Math.floor(rand() * 40);
				if (roll < 0.25 || !thread) pending.push(p.ctl.openOn('main.tex', buildAnchor(TEXT, from, from + 5), `${p.name} ${step}`, p.name));
				else if (roll < 0.45) pending.push(p.ctl.reply(thread, `${p.name} says ${step}`, p.name));
				else if (roll < 0.65) pending.push(p.ctl.setResolved(thread, !thread.resolved, p.name));
				else if (roll < 0.75 && message) pending.push(p.ctl.editMessage(message, `${p.name} rewrote ${step}`));
				else if (roll < 0.82 && message) pending.push(p.ctl.removeMessage(thread, message));
				else if (roll < 0.9 && p !== s.host) {
					if (p.link.transports()) p.link.drop();
					else p.link.start();
				}
				if (rand() < 0.5) await new Promise((r) => setTimeout(r, rand() * 8));
			}
			await Promise.all(pending);
			for (const g of guests) if (!g.link.transports()) g.link.start();
			const same = () => all.every((p) => JSON.stringify(p.log()) === JSON.stringify(s.host.log()));
			await until(same, 20000, `seed ${seed}: every copy of the log agreeing`);
			for (const g of guests) expect(shape(g), `seed ${seed}: ${g.name}`).toBe(shape(s.host));
			await until(() => disk[LOG] === s.host.log().join('\n') + '\n', 5000, `seed ${seed}: the host's file`);
			expect(foldLog(parseLog(disk[LOG]))).toEqual(s.host.ctl.threads);
			const late = await s.join('late');
			await until(() => shape(late) === shape(s.host), 15000, `seed ${seed}: the late guest`);
			s.close();
		}
	},
	RUNS * 20_000
);
