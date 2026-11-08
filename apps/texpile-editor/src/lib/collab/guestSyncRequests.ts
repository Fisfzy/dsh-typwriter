// request/response over the session's control channel: ask the host to resolve a SyncTeX
// position and wait (bounded) for the matching result frame
import type { ControlPayload } from './protocol';

export class GuestSyncRequests {
	private resolvers = new Map<number, (r: ControlPayload) => void>();
	private seq = 0;

	/** send returns false when there is no session to carry the frame */
	constructor(private readonly send: (p: ControlPayload) => boolean) {}

	/** a result frame arrived; answers the pending ask it belongs to */
	resolve(payload: ControlPayload & { reqId: number }): void {
		this.resolvers.get(payload.reqId)?.(payload);
		this.resolvers.delete(payload.reqId);
	}

	private request(
		base: { kind: 'synctex-inverse'; page: number; x: number; y: number } | { kind: 'synctex-forward'; file: string; line: number }
	): Promise<ControlPayload | null> {
		const reqId = ++this.seq;
		const payload = { ...base, reqId } as ControlPayload;
		return new Promise((resolve) => {
			this.resolvers.set(reqId, resolve);
			if (!this.send(payload)) {
				this.resolvers.delete(reqId);
				resolve(null);
				return;
			}
			setTimeout(() => {
				if (this.resolvers.delete(reqId)) resolve(null);
			}, 4000);
		});
	}

	async inverse(page: number, x: number, y: number): Promise<{ file: string; line: number; selectText?: string } | null> {
		const r = await this.request({ kind: 'synctex-inverse', page, x, y });
		return r && r.kind === 'synctex-inverse-result' ? { file: r.file, line: r.line, selectText: r.selectText } : null;
	}

	async forward(file: string, line: number): Promise<{ page: number; x: number; y: number; w?: number; h?: number } | null> {
		const r = await this.request({ kind: 'synctex-forward', file, line });
		return r && r.kind === 'synctex-forward-result' ? { page: r.page, x: r.x, y: r.y, w: r.w, h: r.h } : null;
	}
}
