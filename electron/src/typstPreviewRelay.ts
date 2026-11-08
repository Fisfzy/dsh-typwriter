// Websocket client legs for the Typst preview relay.
//
// While hosting a shared session, the renderer relays tinymist's live preview to guests: per
// guest it asks here for one websocket to the preview task's loopback data plane, and the bytes
// flow data plane <-> main <-> renderer <-> (sealed session frames) <-> guest. This module is only
// the first hop; it treats the traffic as opaque.
//
// It lives in MAIN because the renderer cannot open this socket itself in a packaged build:
// tinymist's data plane validates the Origin header of browser handshakes (accepting only its own
// origin, vscode-webview, and loopback http), and a packaged renderer presents `app://bundle`.
// Node's websocket sends no Origin header at all, which tinymist accepts - verified against
// tinymist 0.15.2: no header opens fine, while a non-loopback Origin is refused with 1006.

import type { WebContents } from 'electron';

// per window: bounded a little above the relay's own guest cap (8), so a renderer bug cannot fan
// out sockets without limit
const MAX_CONNS = 16;

export type RelayEvent = {
	id: number;
	ev: 'open' | 'data' | 'close';
	/** for 'data': a text frame arrives as string, a binary one as ArrayBuffer */
	data?: string | ArrayBuffer;
};

const relays = new Map<number, Map<number, WebSocket>>();
const cleanupHooked = new Set<number>();

function emit(sender: WebContents, event: RelayEvent): void {
	if (!sender.isDestroyed()) sender.send('typst:relay:event', event);
}

/**
 * Open connection `id` to the data plane at `host` on behalf of the calling window.
 *
 * `id` is the renderer's handle, unique per window; a reused id supersedes (closes) the previous
 * socket rather than leaking it. Loopback only: the address comes from the renderer, and the one
 * legitimate value is the preview task tinymist reported to it.
 */
export function open(sender: WebContents, id: number, host: string): void {
	if (!/^127\.0\.0\.1:\d+$/.test(host)) return;
	let conns = relays.get(sender.id);
	if (!conns) {
		conns = new Map();
		relays.set(sender.id, conns);
	}
	if (!cleanupHooked.has(sender.id)) {
		cleanupHooked.add(sender.id);
		const senderId = sender.id;
		sender.once('destroyed', () => {
			for (const ws of relays.get(senderId)?.values() ?? []) {
				try {
					ws.close();
				} catch {
					/* already closing */
				}
			}
			relays.delete(senderId);
			cleanupHooked.delete(senderId);
		});
	}
	conns.get(id)?.close();
	if (conns.size >= MAX_CONNS) {
		emit(sender, { id, ev: 'close' });
		return;
	}

	let ws: WebSocket;
	try {
		ws = new WebSocket(`ws://${host}`);
	} catch {
		emit(sender, { id, ev: 'close' });
		return;
	}
	ws.binaryType = 'arraybuffer';
	conns.set(id, ws);
	ws.onopen = () => emit(sender, { id, ev: 'open' });
	ws.onmessage = (m) => emit(sender, { id, ev: 'data', data: m.data as string | ArrayBuffer });
	ws.onclose = () => {
		// only report a close that is still current: a superseded socket's close must not tear
		// down the connection that replaced it under the same id
		if (relays.get(sender.id)?.get(id) === ws) {
			relays.get(sender.id)?.delete(id);
			emit(sender, { id, ev: 'close' });
		}
	};
	ws.onerror = () => {
		/* onclose follows and carries the teardown */
	};
}

/** forward one client->server message; silently dropped when the socket isn't open (the guest
 *  detects a dead stream by the close event, not by lost sends). */
export function send(sender: WebContents, id: number, data: string | ArrayBuffer): void {
	const ws = relays.get(sender.id)?.get(id);
	if (ws?.readyState === WebSocket.OPEN) ws.send(data);
}

export function close(sender: WebContents, id: number): void {
	const ws = relays.get(sender.id)?.get(id);
	if (!ws) return;
	relays.get(sender.id)?.delete(id);
	try {
		ws.close();
	} catch {
		/* already closing */
	}
}
