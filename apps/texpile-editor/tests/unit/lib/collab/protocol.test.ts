import { describe, it, expect } from 'vitest';
import {
	FrameType,
	encodeFrame,
	decodeFrame,
	chunkBlob,
	BlobAssembler,
	BLOB_CHUNK_SIZE,
	chunkPreview,
	PreviewStream,
	parseRelayNotice,
	isSafeRel,
	isSafeCommentEvent,
	BROADCAST,
	type Frame,
	type PreviewPayload
} from '$lib/collab/protocol';

describe('collab protocol', () => {
	it('round-trips every frame type', () => {
		const frames: Frame[] = [
			{ type: FrameType.SYNC, from: 7, to: BROADCAST, payload: new Uint8Array([1, 2, 3]) },
			{ type: FrameType.AWARENESS, from: 7, to: 9, payload: new Uint8Array(0) },
			{ type: FrameType.HELLO, from: 1, to: BROADCAST, payload: { name: 'Ada', color: '#f00', role: 'guest' } },
			{ type: FrameType.BLOB_REQUEST, from: 2, to: 3, name: 'pdf' },
			{ type: FrameType.BLOB_CHUNK, from: 3, to: 2, payload: { name: 'pdf', rev: 4, index: 1, total: 2, bytes: new Uint8Array([9]) } },
			{ type: FrameType.CONTROL, from: 2, to: BROADCAST, payload: { kind: 'compile-request' } },
			{ type: FrameType.CONTROL, from: 4, to: BROADCAST, payload: { kind: 'file-op', op: 'rename', from: 'a.tex', to: 'b/c.tex' } },
			{ type: FrameType.PREVIEW, from: 5, to: 6, payload: { conn: 3, ev: 'data', seq: 41, part: 1, parts: 2, bytes: new Uint8Array([8]) } },
			{ type: FrameType.PREVIEW, from: 6, to: 5, payload: { conn: 1, ev: 'open', seq: 0, part: 0, parts: 1, bytes: new Uint8Array(0) } }
		];
		for (const f of frames) expect(decodeFrame(encodeFrame(f))).toEqual(f);
	});

	// the host runs guest file-ops against its real disk, so this is the traversal gate
	it('isSafeRel admits manifest-relative paths and nothing that escapes the root', () => {
		for (const ok of ['a.tex', 'chapters/intro.tex', 'a b/fig.png', '.gitignore']) expect(isSafeRel(ok), ok).toBe(true);
		for (const bad of ['', '/etc/passwd', 'C:/x', 'c:\\x', '..', '../x', 'a/../../x', 'a\\b', 'a//b', 'a/./b', 'a/']) {
			expect(isSafeRel(bad), bad).toBe(false);
		}
	});

	it('isSafeCommentEvent takes a well formed event and refuses a malformed or escaping one', () => {
		const anchor = { quote: 'text', prefix: '', suffix: '', start: 0, end: 4 };
		const open = { v: 1, t: 'open', id: 't1', file: 'main.tex', body: 'hi', anchor, at: 'now', by: 'mei' };
		expect(isSafeCommentEvent(open)).toBe(true);
		expect(isSafeCommentEvent({ ...open, file: '../main.tex' })).toBe(false);
		expect(isSafeCommentEvent({ ...open, anchor: null })).toBe(false);
		expect(isSafeCommentEvent({ v: 1, t: 'move', from: 'a.tex', to: '/etc/b.tex', at: 'now', by: 'mei' })).toBe(false);
		expect(isSafeCommentEvent({ v: 1, t: 'anchor', thread: 't1', anchor, at: 'now', by: 'mei' })).toBe(true);
	});

	// megabytes of real chunking, not a mock: ~1.5s alone but past vitest's 5s default when the
	// whole suite runs it in parallel with everything else
	it('chunks and reassembles blobs, including chunk-boundary sizes', { timeout: 20_000 }, () => {
		for (const size of [0, 1, BLOB_CHUNK_SIZE, BLOB_CHUNK_SIZE + 1, BLOB_CHUNK_SIZE * 2 + 17]) {
			const bytes = new Uint8Array(size).map((_, i) => i % 251);
			const chunks = chunkBlob('pdf', 1, bytes);
			expect(chunks.length).toBe(Math.max(1, Math.ceil(size / BLOB_CHUNK_SIZE)));
			const asm = new BlobAssembler();
			let out: Uint8Array | null = null;
			// deliver out of order to prove index handling
			for (const c of [...chunks].reverse()) out = asm.add(c) ?? out;
			expect(out && new Uint8Array(out)).toEqual(bytes);
		}
	});

	// the preview relay's transport rules: chunking keeps every frame under the relay's message
	// cap, and the seq walk is the ONLY thing that turns a silently dropped frame into a reattach
	describe('preview stream', () => {
		const feed = (stream: PreviewStream, payloads: PreviewPayload[]) => payloads.map((p) => stream.add(p));

		it('chunks one message into seq-consecutive parts and reassembles it', () => {
			const bytes = new Uint8Array(BLOB_CHUNK_SIZE * 2 + 5).map((_, i) => i % 251);
			const { payloads, nextSeq } = chunkPreview(1, 'data', 0, bytes);
			expect(payloads.length).toBe(3);
			expect(nextSeq).toBe(3);
			const results = feed(new PreviewStream(), payloads);
			expect(results.slice(0, 2)).toEqual([null, null]);
			const done = results[2] as { bytes: Uint8Array; text: boolean };
			expect(done.text).toBe(false);
			expect(new Uint8Array(done.bytes)).toEqual(bytes);
		});

		it('carries small messages whole, text flagged as text', () => {
			const { payloads, nextSeq } = chunkPreview(1, 'text', 7, new TextEncoder().encode('{"event":"current"}'));
			expect(payloads.length).toBe(1);
			expect(nextSeq).toBe(8);
			const stream = new PreviewStream();
			// pretend frames 0..6 already flowed
			for (let i = 0; i < 7; i++) stream.add(chunkPreview(1, 'data', i, new Uint8Array(1)).payloads[0]);
			const done = stream.add(payloads[0]) as { bytes: Uint8Array; text: boolean };
			expect(done.text).toBe(true);
			expect(new TextDecoder().decode(done.bytes)).toBe('{"event":"current"}');
		});

		it('reports a gap when a frame is lost, whether between messages or inside a chunk run', () => {
			const stream = new PreviewStream();
			const a = chunkPreview(1, 'data', 0, new Uint8Array(3)).payloads[0];
			expect(stream.add(a)).not.toBe('gap');
			// seq 1 never arrives
			const late = chunkPreview(1, 'data', 2, new Uint8Array(3)).payloads[0];
			expect(stream.add(late)).toBe('gap');

			const stream2 = new PreviewStream();
			const run = chunkPreview(1, 'data', 0, new Uint8Array(BLOB_CHUNK_SIZE * 2 + 1)).payloads;
			expect(stream2.add(run[0])).toBeNull();
			expect(stream2.add(run[2])).toBe('gap'); // middle chunk dropped
		});

		it('rejects a hostile parts count before it can size a buffer', () => {
			const stream = new PreviewStream();
			expect(stream.add({ conn: 1, ev: 'data', seq: 0, part: 0, parts: 1 << 20, bytes: new Uint8Array(1) })).toBe('gap');
		});
	});

	it('a newer rev obsoletes a half-finished older transfer', () => {
		const asm = new BlobAssembler();
		const oldChunks = chunkBlob('pdf', 1, new Uint8Array(BLOB_CHUNK_SIZE + 1));
		expect(asm.add(oldChunks[0])).toBeNull();
		const fresh = new Uint8Array([5, 6, 7]);
		expect(asm.add(chunkBlob('pdf', 2, fresh)[0])).toEqual(fresh);
		// the old transfer's tail can no longer complete
		expect(asm.add(oldChunks[1])).toBeNull();
	});

	// a peer controls `total`/`index`, so a bogus value must be rejected before it sizes a buffer
	it('rejects blob chunks with an out-of-range total or index instead of allocating', () => {
		const asm = new BlobAssembler();
		const base = { name: 'pdf', rev: 1, bytes: new Uint8Array([1]) };
		expect(asm.add({ ...base, index: 0, total: 500_000_000 })).toBeNull(); // would allocate ~500M slots
		expect(asm.add({ ...base, index: 0, total: 0 })).toBeNull();
		expect(asm.add({ ...base, index: 0, total: -1 })).toBeNull();
		expect(asm.add({ ...base, index: 5, total: 2 })).toBeNull(); // index past total
		expect(asm.add({ ...base, index: -1, total: 2 })).toBeNull();
		// a legitimate single-chunk blob still assembles
		expect(asm.add({ ...base, index: 0, total: 1 })).toEqual(base.bytes);
	});

	it('parses relay notices and rejects junk', () => {
		expect(parseRelayNotice('{"t":"peers","count":3}')).toEqual({ t: 'peers', count: 3 });
		expect(parseRelayNotice('not json')).toBeNull();
		expect(parseRelayNotice('{"x":1}')).toBeNull();
	});
});
