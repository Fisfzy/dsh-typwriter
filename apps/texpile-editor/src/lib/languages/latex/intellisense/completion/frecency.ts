// frequency+recency completion ordering. LaTeX Workshop sorts statically (VS Code's suggest
// widget supplies its recently-used memory); here accepts are counted per label in localStorage
// with a 30-day half-life and mapped to CodeMirror's boost, which tie-breaks equal matches.
import { pickedCompletion, type Completion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { userData, updateUserData } from '$lib/storage/userData';

type UsageEntry = {
	/** decayed accept score as of t */
	s: number;
	/** last accept, ms epoch */
	t: number;
};

const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const MAX_BOOST = 30;

// in-memory working copy; the users blob is the persisted one
let usage: Record<string, UsageEntry> | null = null;

function load(): Record<string, UsageEntry> {
	usage ??= { ...userData.current.completionUsage };
	return usage;
}

function save(store: Record<string, UsageEntry>) {
	updateUserData({ completionUsage: { ...store } });
}

function decayed(e: UsageEntry, now: number) {
	return e.s * Math.pow(0.5, (now - e.t) / HALF_LIFE_MS);
}

export function recordAccept(label: string, now = Date.now()) {
	const store = load();
	const prev = store[label];
	store[label] = { s: (prev ? decayed(prev, now) : 0) + 1, t: now };
	const labels = Object.keys(store);
	if (labels.length > MAX_ENTRIES) {
		labels.sort((a, b) => decayed(store[b], now) - decayed(store[a], now));
		for (const stale of labels.slice(MAX_ENTRIES / 2)) delete store[stale];
	}
	save(store);
}

/** clones completions the user accepts often with a boost attached; others pass through as-is. */
export function withFrecency(options: Completion[], now = Date.now()): Completion[] {
	const store = load();
	return options.map((o) => {
		const e = store[o.label];
		if (!e) return o;
		const boost = Math.min(MAX_BOOST, Math.round(4 * Math.log2(1 + decayed(e, now))));
		// compose with boosts set upstream (math context, open-env priority), never replace them
		return boost > 0 ? { ...o, boost: Math.min(99, (o.boost ?? 0) + boost) } : o;
	});
}

/** records every accepted completion (any source); attach once per editor. */
export function frecencyTracker() {
	return EditorView.updateListener.of((update) => {
		for (const tr of update.transactions) {
			const picked = tr.annotation(pickedCompletion);
			if (picked) recordAccept(picked.label);
		}
	});
}

/** test seam: wipe the in-memory store so cases start clean. */
export function resetUsageForTests() {
	usage = null;
	updateUserData({ completionUsage: {} });
}
