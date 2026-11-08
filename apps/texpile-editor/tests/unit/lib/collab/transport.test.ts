import { it, expect, vi, afterEach } from 'vitest';
import { RelayTransport } from '$lib/collab/transport';

class FakeSocket {
	static opened: FakeSocket[] = [];
	static OPEN = 1;
	binaryType = '';
	readyState = 0;
	onopen: (() => void) | null = null;
	onmessage: ((ev: { data: unknown }) => void) | null = null;
	onclose: ((ev: { code: number }) => void) | null = null;
	onerror: (() => void) | null = null;
	constructor() {
		FakeSocket.opened.push(this);
	}
	close() {}
}

afterEach(() => {
	vi.useRealTimers();
	FakeSocket.opened = [];
});

it('retries a network drop but not a close code the relay chose', () => {
	vi.useFakeTimers();
	vi.stubGlobal('WebSocket', FakeSocket);
	const transport = new RelayTransport('ws://relay', 'room', 'proof');
	const seen: string[] = [];
	transport.onStatus = (s, detail) => seen.push(detail ? `${s}:${detail}` : s);
	transport.connect();
	FakeSocket.opened[0].onclose?.({ code: 1006 });
	vi.advanceTimersByTime(1500);
	expect(FakeSocket.opened).toHaveLength(2);
	FakeSocket.opened[1].onclose?.({ code: 4011 });
	vi.advanceTimersByTime(60_000);
	expect(FakeSocket.opened).toHaveLength(2);
	expect(seen).toEqual(['connecting', 'disconnected', 'connecting', 'closed:4011']);
	vi.unstubAllGlobals();
});
