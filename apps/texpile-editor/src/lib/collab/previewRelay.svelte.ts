// Host side of the Typst preview stream: one websocket leg per guest to the running preview
// task's data plane (held in electron main), spliced to that guest's sealed session frames.
//
// The GUEST owns each connection's lifecycle - it opens with a fresh `conn` epoch and recovers
// from anything (relay drop, gap, host preview restart) by closing and reopening. This side only
// answers: dial a leg on 'open', forward bytes both ways while it lives, and say 'close' when the
// socket dies. tinymist treats every data-plane connection as a fresh viewer and starts it with a
// whole-document frame, which is what makes reattach a complete recovery and retransmission
// unnecessary.
//
// Demand flows the other way too: a guest can ask for the preview while the host has its own pane
// closed, so `demand` is surfaced for WorkspaceView to keep the preview task alive whenever legs
// exist. The task itself (start/kill, its address) stays WorkspaceView's; it reports the address
// here via setHost.

import { collabHost } from './hostStore.svelte';
import { chunkPreview, type PreviewPayload } from './protocol';

type GuestLeg = {
	/** the guest's Y clientID, which is also where its frames go */
	guest: number;
	/** the guest's connection epoch; frames for another epoch are stale */
	conn: number;
	/** electron-side socket handle; 0 while the leg waits for the preview task to come up */
	relayId: number;
	/** host->guest frame counter for this leg (gap detection on the far end) */
	seq: number;
	/** deadline until which ONE `jump` frame may pass to this guest (it asked for a scroll) */
	jumpUntil?: number;
	/** when the leg's socket was dialed; a close moments later means the port refused us */
	dialedAt?: number;
	/** the socket reached 'open': the task answered, so a later close is NOT a refused dial */
	sawOpen?: boolean;
};

const EMPTY = new Uint8Array(0);

class PreviewRelayController {
	/** legs live or waiting; >0 must keep the preview task running even with the host pane closed */
	demand = $state(0);

	/**
	 * The task's port is refusing connections (several dials died instantly): the task is dead but
	 * its address is still held, so every guest attach fails forever. WorkspaceView wires this to
	 * kill the task; the demand effect then starts a fresh one for the still-asking guests.
	 */
	onTaskUnreachable: (() => void) | null = null;
	private fastCloses = 0;
	private pageFetchFails = 0;
	private lastUnreachableAt = 0;

	private legs = new Map<number, GuestLeg>(); // guest clientID -> its one leg
	private byRelayId = new Map<number, GuestLeg>();
	private nextRelayId = 1;
	private host: string | null = null;
	/** the raw page as tinymist serves it, fetched once per task and shipped to each asker */
	private pageHtml: string | null = null;
	private unsubRelay: (() => void) | null = null;
	/** guests whose page ask arrived before the task was up: guest -> time of latest ask */
	private pendingAskers = new Map<number, number>();
	/** the last guest whose preview click went up to tinymist; the next resolved jump is theirs */
	private srcClick: { guest: number; until: number } | null = null;

	private bridge() {
		return typeof window !== 'undefined' ? window.texpileTypst : undefined;
	}

	/** wire the session-frame and socket-event handlers; returns nothing, detach() undoes it. */
	attach(): void {
		collabHost.onPreview = (p, from) => this.onFrame(p, from);
		collabHost.onPreviewPageRequest = (from) => void this.servePage(from);
		this.unsubRelay = this.bridge()?.onRelayEvent((e) => this.onRelayEvent(e)) ?? null;
	}

	detach(): void {
		for (const leg of [...this.legs.values()]) this.dropLeg(leg, false);
		collabHost.onPreview = null;
		collabHost.onPreviewPageRequest = null;
		this.unsubRelay?.();
		this.unsubRelay = null;
		this.host = null;
		this.pageHtml = null;
		this.pendingAskers.clear();
		this.srcClick = null;
		this.demand = 0;
	}

	/**
	 * Legs plus live page-askers. An UNSERVED page ask must count as demand or the whole handshake
	 * deadlocks: the page needs the task, the task starts on demand, demand came only from legs,
	 * and a leg needs the page. Pending askers age out - the guest pane re-asks every few seconds
	 * while unserved, so an entry that stops refreshing means the asker is gone.
	 */
	private updateDemand(): void {
		const cutoff = Date.now() - 15000;
		for (const [guest, at] of this.pendingAskers) if (at < cutoff) this.pendingAskers.delete(guest);
		this.demand = this.legs.size + this.pendingAskers.size;
	}

	/**
	 * The preview task's data-plane address, from WorkspaceView's task management. Null means no
	 * task: existing legs are told 'close' (their viewers reconnect, re-raising demand until the
	 * task is back), and legs opened meanwhile wait here until an address arrives.
	 */
	setHost(host: string | null): void {
		if (host === this.host) return;
		this.host = host;
		this.pageHtml = null;
		this.fastCloses = 0; // a new task starts with a clean record
		this.pageFetchFails = 0;
		if (host) {
			for (const leg of this.legs.values()) if (leg.relayId === 0) this.dial(leg);
			// the askers whose page request predated the task; this is their answer arriving
			for (const from of [...this.pendingAskers.keys()]) void this.servePage(from);
		} else {
			for (const leg of [...this.legs.values()]) this.dropLeg(leg, true);
		}
	}

	/** a guest asked for the raw preview page; fetch it once and ship it over the blob channel. */
	private async servePage(from: number): Promise<void> {
		if (!this.host) {
			// No task yet: HOLD the ask and let it count as demand, so WorkspaceView starts the
			// task; setHost serves the held asks when the address arrives. Dropping the ask here
			// deadlocked the whole handshake (see updateDemand).
			this.pendingAskers.set(from, Date.now());
			this.updateDemand();
			return;
		}
		if (this.pageHtml === null) {
			const res = await this.bridge()?.previewPageHtml(this.host);
			if (!res?.ok || !res.html) {
				// An address is held but its HTTP side did not answer: the task is dead. The legs'
				// fast-close detector can never see this - without the page no viewer ever opens a
				// leg - so this was the one dead-task shape that never self-healed (a preview left
				// from before the session shared, guests asking forever). Keep the ask pending (it
				// must go on counting as demand) and treat repeated failures like refused dials.
				this.pendingAskers.set(from, Date.now());
				this.updateDemand();
				if (++this.pageFetchFails >= 2 && Date.now() - this.lastUnreachableAt > 10_000) {
					this.pageFetchFails = 0;
					this.lastUnreachableAt = Date.now();
					this.onTaskUnreachable?.();
				}
				return;
			}
			this.pageHtml = res.html;
			this.pageFetchFails = 0;
		}
		this.pendingAskers.delete(from);
		this.updateDemand();
		collabHost.sendPreviewPage(this.pageHtml, from);
	}

	/** one frame up from a guest: open a leg, feed its socket, or close it. */
	private onFrame(p: PreviewPayload, from: number): void {
		if (p.ev === 'open') {
			const old = this.legs.get(from);
			if (old) this.dropLeg(old, false); // one leg per guest; a new epoch supersedes
			const leg: GuestLeg = { guest: from, conn: p.conn, relayId: 0, seq: 0 };
			this.legs.set(from, leg);
			if (this.host) this.dial(leg);
			this.updateDemand();
			return;
		}
		const leg = this.legs.get(from);
		if (!leg || leg.conn !== p.conn) return; // stale epoch
		if (p.ev === 'close') {
			this.dropLeg(leg, false);
		} else if (p.ev === 'text') {
			const text = new TextDecoder().decode(p.bytes);
			// Upstream WHITELIST, not a blocklist: `srclocation` (an outline entry) and
			// `outline-sync` ask the server to touch THE HOST'S editor and die here. Two messages
			// pass: `current` (the attach handshake requesting a whole-document frame), and
			// `src-point` (a document click) - tinymist resolves that into an editor jump which
			// lands host-side, and claimSrcClick below is what lets the host hand the resolution
			// back to the guest that clicked instead of jumping its own editor.
			if (/^src-point([\s,]|$)/.test(text)) this.srcClick = { guest: from, until: Date.now() + 2500 };
			else if (text !== 'current') return;
			if (leg.relayId) this.bridge()?.relaySend(leg.relayId, text);
		} else if (p.ev === 'data') {
			// the viewer's upstream protocol is text-only (current/src-point/srclocation/
			// outline-sync); unexpected binary from a guest has no legitimate meaning here
			return;
		}
	}

	/* eslint-disable no-param-reassign -- dialing stamps the leg's relay bookkeeping */
	private dial(leg: GuestLeg): void {
		leg.relayId = this.nextRelayId++;
		leg.dialedAt = Date.now();
		this.byRelayId.set(leg.relayId, leg);
		this.bridge()?.relayOpen(leg.relayId, this.host!);
	}
	/* eslint-enable no-param-reassign */

	/** one event down from a leg's socket: confirm, forward (chunked), or tear down. */
	// eslint-disable-next-line id-denylist -- `data` is the preload bridge's event field (TexpileTypstBridge.onRelayEvent)
	private onRelayEvent(e: { id: number; ev: 'open' | 'data' | 'close'; data?: string | ArrayBuffer }): void {
		const leg = this.byRelayId.get(e.id);
		if (!leg) return; // a superseded socket's tail; electron already closed it
		if (e.ev === 'open') {
			leg.sawOpen = true;
			this.fastCloses = 0; // the task answered a dial: it is alive, whatever came before
			collabHost.sendPreview({ conn: leg.conn, ev: 'open', seq: 0, part: 0, parts: 1, bytes: EMPTY }, leg.guest);
		} else if (e.ev === 'data') {
			const text = typeof e.data === 'string';
			// Editor-driven view commands stay host-local: `jump` (follow / scroll-to-point) and
			// `cursor` (the host's cursor marker) fire on the HOST's typing and clicks, and
			// broadcasting them yanked every guest's view around while the host worked. The one
			// exception: a jump THIS guest just asked for (typst-scroll), which passes once
			// within its window - that is the whole guest-side forward sync.
			//
			// tinymist sends these as BINARY websocket messages (measured: a jump is a 41-byte
			// binary frame reading `jump,1 78.6 417.0,...`), so the sniff must decode the head of
			// small binary frames too - a text-only test let every one of them through and the
			// host's typing dragged every guest's view along.
			const head = text
				? (e.data as string).slice(0, 8)
				: (e.data as ArrayBuffer).byteLength <= 512
					? new TextDecoder().decode(new Uint8Array(e.data as ArrayBuffer, 0, Math.min(8, (e.data as ArrayBuffer).byteLength)))
					: '';
			if (/^cursor([\s,]|$)/.test(head)) return;
			if (/^jump([\s,]|$)/.test(head)) {
				if (!leg.jumpUntil || Date.now() > leg.jumpUntil) return;
				leg.jumpUntil = 0;
			}
			const bytes = text ? new TextEncoder().encode(e.data as string) : new Uint8Array(e.data as ArrayBuffer);
			const { payloads, nextSeq } = chunkPreview(leg.conn, text ? 'text' : 'data', leg.seq, bytes);
			leg.seq = nextSeq;
			for (const payload of payloads) collabHost.sendPreview(payload, leg.guest);
		} else {
			// A dial that closes WITHOUT EVER OPENING is a refused loopback connection - the task's
			// port is dead. Three in a row and we stop serving refusals: tell the owner to restart
			// the task (cooldown so a genuinely flapping task cannot kill-loop). sawOpen is the
			// load-bearing guard: a young-but-opened socket is normal guest reconnect churn, and
			// counting those killed a HEALTHY task the moment a joining guest's viewer ladder
			// rebuilt its connection a few times.
			if (!leg.sawOpen && leg.dialedAt && Date.now() - leg.dialedAt < 1500) {
				if (++this.fastCloses >= 3 && Date.now() - this.lastUnreachableAt > 10_000) {
					this.fastCloses = 0;
					this.lastUnreachableAt = Date.now();
					this.onTaskUnreachable?.();
				}
			}
			this.dropLeg(leg, true);
		}
	}

	/** this guest asked for a scroll: let the next `jump` frame through to it, briefly. The window
	 *  covers the LSP round trip plus the server's broadcast; anything later is a host-driven jump
	 *  again. */
	expectJump(guest: number): void {
		const leg = this.legs.get(guest);
		if (leg) leg.jumpUntil = Date.now() + 1500;
	}

	/**
	 * A resolved preview click (window/showDocument) just arrived: whose is it? Returns the guest
	 * that clicked within the window - the caller then sends THEM the jump instead of moving the
	 * host's caret - or null for the host's own click. One-shot, and the window is short because
	 * jump resolutions carry no origin: a host click racing a guest's inside 2.5s picks the guest.
	 */
	claimSrcClick(): number | null {
		const c = this.srcClick;
		this.srcClick = null;
		return c && Date.now() <= c.until ? c.guest : null;
	}

	/** guests still in the session; legs and held asks of departed ones go without a goodbye. */
	prune(present: number[]): void {
		const keep = new Set(present);
		for (const leg of [...this.legs.values()]) if (!keep.has(leg.guest)) this.dropLeg(leg, false);
		for (const guest of [...this.pendingAskers.keys()]) if (!keep.has(guest)) this.pendingAskers.delete(guest);
		this.updateDemand();
	}

	private dropLeg(leg: GuestLeg, notifyGuest: boolean): void {
		if (this.legs.get(leg.guest) === leg) this.legs.delete(leg.guest);
		if (leg.relayId) {
			this.byRelayId.delete(leg.relayId);
			this.bridge()?.relayClose(leg.relayId);
		}
		if (notifyGuest) collabHost.sendPreview({ conn: leg.conn, ev: 'close', seq: 0, part: 0, parts: 1, bytes: EMPTY }, leg.guest);
		this.updateDemand();
	}
}

export const previewRelay = new PreviewRelayController();
