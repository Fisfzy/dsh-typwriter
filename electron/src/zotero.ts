// Zotero citation bridge, via Better BibTeX's localhost server (fixed port 23119).
//
// Three thin calls and no state: probe (is Zotero up, does it have BBT), search (JSON-RPC
// item.search - library matches with their citekeys, feeding the in-app picker dialog), and
// export (JSON-RPC item.export - the picked entries as BibTeX/BibLaTeX text). The renderer
// cannot make these requests itself: its CSP has no connect-src for the Zotero port, and that
// is fine - loopback fetches from main are the same idiom the Typst preview pages use.
//
// Deliberately NOT Better BibTeX's CAYW picker: that pops a window of Zotero's own, behind a
// one-at-a-time integration lock, and the request blocks while it is open - it read as a hang
// and wedged itself when the window went unnoticed. Searching and picking inside the app keeps
// the whole flow visible and lock-free.
import { ipcMain } from 'electron';

const BASE = 'http://127.0.0.1:23119/better-bibtex';

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function registerZotero(): void {
	// running: the port answered at all (Zotero's connector server). bbt: the better-bibtex
	// route exists AND reports ready - a plain Zotero answers the port but 404s the path.
	ipcMain.handle('zotero:probe', async () => {
		try {
			const res = await fetch(`${BASE}/cayw?probe=1`, { signal: AbortSignal.timeout(2000) });
			const text = await res.text();
			return { ok: true, running: true, bbt: res.ok && /ready/i.test(text) };
		} catch {
			return { ok: true, running: false, bbt: false };
		}
	});

	// an EMPTY query is a real request: item.search('') returns the whole library, which is what
	// fills the picker before the user types. Capped, because "whole library" can be thousands.
	ipcMain.handle('zotero:search', async (_e, body: { query: string }) => {
		const query = typeof body?.query === 'string' ? body.query.trim() : '';
		try {
			const res = await fetch(`${BASE}/json-rpc`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', method: 'item.search', params: [query] }),
				signal: AbortSignal.timeout(10_000)
			});
			if (!res.ok) return { ok: false, error: `Zotero answered ${res.status}` };
			const rpc = (await res.json()) as { result?: unknown; error?: { message?: string } };
			if (rpc.error) return { ok: false, error: rpc.error.message ?? 'search failed' };
			// CSL-JSON entries; keep only what the picker rows show, plus the key everything is by
			const items = (Array.isArray(rpc.result) ? rpc.result : [])
				.map((raw) => {
					const o = raw as Record<string, unknown>;
					const citekey =
						typeof o.citekey === 'string' ? o.citekey : typeof o['citation-key'] === 'string' ? (o['citation-key'] as string) : '';
					const authors = Array.isArray(o.author) ? (o.author as Array<Record<string, unknown>>) : [];
					const author = authors
						.map((a) => (typeof a.family === 'string' ? a.family : typeof a.literal === 'string' ? a.literal : ''))
						.filter(Boolean)
						.join(', ');
					const issued = o.issued as { 'date-parts'?: unknown[][] } | undefined;
					const year = String(issued?.['date-parts']?.[0]?.[0] ?? '');
					return { citekey, title: typeof o.title === 'string' ? o.title : '', author, year };
				})
				.filter((i) => i.citekey)
				.slice(0, 100);
			return { ok: true, items };
		} catch (err) {
			return { ok: false, error: message(err) };
		}
	});

	ipcMain.handle('zotero:export', async (_e, body: { keys: string[]; translator: string }) => {
		const keys = Array.isArray(body?.keys) ? body.keys.filter((k) => typeof k === 'string' && k) : [];
		const translator = typeof body?.translator === 'string' ? body.translator : '';
		if (!keys.length || !translator) return { ok: false, error: 'nothing to export' };
		try {
			const res = await fetch(`${BASE}/json-rpc`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', method: 'item.export', params: [keys, translator] }),
				signal: AbortSignal.timeout(30_000)
			});
			if (!res.ok) return { ok: false, error: `Zotero answered ${res.status}` };
			const rpc = (await res.json()) as { result?: unknown; error?: { message?: string } };
			if (rpc.error) return { ok: false, error: rpc.error.message ?? 'export failed' };
			// current BBT returns the text; some versions wrapped it in an array - take the string
			const result = rpc.result;
			const bib = typeof result === 'string' ? result : Array.isArray(result) ? result.find((r) => typeof r === 'string') : null;
			if (typeof bib !== 'string') return { ok: false, error: 'unexpected export response' };
			return { ok: true, bib };
		} catch (err) {
			return { ok: false, error: message(err) };
		}
	});
}
