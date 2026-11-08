// gzip helpers for collab frames. Large sync/state frames (seeding a big .tex, or the full-doc
// reply a guest gets on join) would otherwise blow the relay's per-message cap; LaTeX source

async function run(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
	const writer = stream.writable.getWriter();
	// lib0/gzip output is plain ArrayBuffer-backed, never shared; cast as seal.ts does for WebCrypto
	void writer.write(bytes as BufferSource);
	void writer.close();
	const reader = stream.readable.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			total += value.byteLength;
		}
	}
	const out = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.byteLength;
	}
	return out;
}

export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
	return run(bytes, new CompressionStream('gzip'));
}
export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
	return run(bytes, new DecompressionStream('gzip'));
}
