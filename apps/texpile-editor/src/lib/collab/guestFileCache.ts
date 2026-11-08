// Object URLs for files the host serves on demand (images). One ask per rel@rev; a stale
// copy keeps showing while the fresh revision is in flight, rather than blanking.
export class GuestFileCache {
	private cache = new Map<string, { rev: number; url: string }>();
	private inFlight = new Set<string>();

	constructor(private readonly onArrive: () => void) {}

	receive(rel: string, rev: number, bytes: Uint8Array): void {
		const old = this.cache.get(rel);
		if (old) URL.revokeObjectURL(old.url);
		this.cache.set(rel, { rev, url: URL.createObjectURL(new Blob([bytes as BlobPart])) });
		this.inFlight.delete(rel + '@' + rev);
		this.onArrive();
	}

	/** the url cached at exactly `rev`, else the stale one ('' when none); asks once per rel@rev */
	urlFor(rel: string, rev: number, request: ((blobName: string) => void) | null): string {
		const hit = this.cache.get(rel);
		if (hit && hit.rev === rev) return hit.url;
		const key = rel + '@' + rev;
		if (rel && request && !this.inFlight.has(key)) {
			this.inFlight.add(key);
			request('f:' + rel);
		}
		return hit?.url ?? '';
	}

	/** revoke, don't just drop: a surviving object URL could render a previous host's bytes */
	clear(): void {
		for (const { url } of this.cache.values()) URL.revokeObjectURL(url);
		this.cache.clear();
		this.inFlight.clear();
	}
}
