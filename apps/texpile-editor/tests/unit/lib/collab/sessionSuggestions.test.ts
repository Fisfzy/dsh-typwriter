// @vitest-environment jsdom
// suggestions in a shared session, end to end: real editors on every side, the host recording
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildAnchor } from '$lib/comments/anchor';
import { openEvent, type CommentEvent } from '$lib/comments/log';
import { removeAwarenessStates } from 'y-protocols/awareness';
import { disk } from './sessionDisk';

vi.mock('$lib/workspace/fileSystem', async () => {
	const { disk } = await import('./sessionDisk');
	return {
		readTextFile: async (path: string) => {
			const hit = Object.entries(disk).find(([k]) => path.replace(/\\/g, '/').endsWith(k));
			if (!hit) throw new Error(`ENOENT ${path}`);
			return hit[1];
		},
		writeTextFile: async (path: string, text: string) => {
			disk[path.replace(/\\/g, '/').replace(/^\/w\//, '')] = text;
		},
		joinPath: (a: string, b: string) => `${a}/${b}`
	};
});
vi.mock('$lib/workspace/texpileDir', () => ({
	texpilePath: (root: string, name: string) => `${root}/.texpile/${name}`,
	ensureTexpileIgnore: async () => {}
}));
vi.mock('$lib/comments/author', () => ({
	resolveAuthor: async (root: string | null, preferred: string) => preferred || (root === 'session' ? 'guest' : 'louis'),
	forgetAuthor: () => {}
}));

const { startSession, startSolo, openSuggestions, placedOn, withAllRejected, logged, agree, rejectAllOn, acceptAllOn, until, FILE } =
	await import('./sessionHarness');
type Session = Awaited<ReturnType<typeof startSession>>;
type Keys = import('./sessionHarness').Keys;
type Side = { ctl: Parameters<typeof placedOn>[0] };

const TEXT = 'We prove the estimator is sharp for smooth solutions.\n';

let open: Session | null = null;
async function session(o: Parameters<typeof startSession>[0] = { text: TEXT }) {
	open = await startSession(o);
	return open;
}
afterEach(() => {
	open?.close();
	open = null;
});

it('smoke: a guest typing in Suggesting reaches the host as their suggestion', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	mei.keys.type('new ', 'estimator');
	await s.quiet();
	expect(s.host.text()).toBe(TEXT.replace('the estimator', 'the new estimator'));
	expect(openSuggestions(s.host.ctl.threads)).toEqual([['mei', 'new ', '']]);
	expect(disk[FILE]).toBe(s.host.text());
	expect(logged().filter((e) => e.t === 'open')).toHaveLength(1);
	expect(withAllRejected(s.host.text(), placedOn(s.host.ctl)!.placed)).toBe(TEXT);
});

const blunt = TEXT.replace('sharp', 'blunt');
const adaBlunt = openEvent({
	id: 'ada-blunt',
	file: FILE,
	by: 'ada',
	body: '',
	anchor: buildAnchor(blunt, blunt.indexOf('blunt'), blunt.indexOf('blunt') + 5),
	at: 'now',
	restore: 'sharp'
});

// the same keys typed by one person alone, settling after each, are the reference
const SAME_AS_ALONE: [string, { text: string; log?: CommentEvent[] }, (k: Keys) => Promise<unknown>][] = [
	['replacing a word', { text: TEXT }, async (k) => k.replace('sharp', 'blunt')],
	['replacing a word by one that ends the same', { text: blunt }, async (k) => k.replace('blunt', 'tight')],
	['replacing a word by one that starts the same', { text: TEXT }, async (k) => k.replace('sharp', 'steep')],
	['replacing a word by one that shares its middle', { text: TEXT }, async (k) => k.replace('smooth', 'moot')],
	['inserting a word', { text: TEXT }, async (k) => k.type('new ', 'estimator')],
	['inserting a word that repeats the letters before it', { text: TEXT }, async (k) => k.type('ter estima', 'tor is')],
	['deleting a word a backspace at a time', { text: TEXT }, async (k) => k.erase('sharp ')],
	['deleting a selected word', { text: TEXT }, async (k) => k.cut('sharp ')],
	['deleting a selected word before one that starts the same', { text: TEXT }, async (k) => k.cut('smooth ')],
	['deleting a word before one that starts the same a backspace at a time', { text: TEXT }, async (k) => k.erase('smooth ')],
	[
		'deleting a word and typing its replacement',
		{ text: TEXT },
		async (k) => {
			await k.erase('sharp');
			await k.type('blunt', ' for smooth');
		}
	],
	[
		'deleting part of their own insertion',
		{ text: TEXT },
		async (k) => {
			await k.type('very new ', 'estimator');
			await k.erase('very ');
		}
	],
	[
		'typing inside their own replacement',
		{ text: TEXT },
		async (k) => {
			await k.replace('sharp', 'blunt');
			await k.replace('lun', 'ea');
		}
	],
	[
		'deleting across their own replacement and the words beside it',
		{ text: TEXT },
		async (k) => {
			await k.replace('sharp', 'blunt');
			await k.erase('is blunt');
		}
	],
	['typing inside someone else’s replacement', { text: blunt, log: [adaBlunt] }, async (k) => k.replace('lun', 'ea')],
	['deleting someone else’s replacement', { text: blunt, log: [adaBlunt] }, async (k) => k.erase('blunt ')],
	['typing just after someone else’s replacement', { text: blunt, log: [adaBlunt] }, async (k) => k.type('ly', ' for')]
];

const shapeAlone = (ctl: Side['ctl']) =>
	(placedOn(ctl)?.placed ?? []).map(({ from, to, restore, author }) => ({ from, to, restore, author }));

describe('the host records a guest’s keys the way it records one person typing them alone', () => {
	it.each(SAME_AS_ALONE)('%s', async (_, start, keys) => {
		const solo = await startSolo({ ...start, name: 'mei' });
		await keys(solo.keys);
		const alone = { text: solo.text(), placed: shapeAlone(solo.ctl) };
		solo.close();
		const base = withAllRejected(alone.text, placedOn(solo.ctl)!.placed);

		const s = await session(start);
		const mei = await s.join('mei');
		await mei.mode('suggesting');
		await keys(mei.keys);
		await agree(s, base);
		expect({ text: s.host.text(), placed: shapeAlone(s.host.ctl) }).toEqual(alone);
	});

	it.each(SAME_AS_ALONE)('%s, each key settling on the host before the next', async (_, start, keys) => {
		const solo = await startSolo({ ...start, name: 'mei' });
		await keys(solo.keys);
		const alone = { text: solo.text(), placed: shapeAlone(solo.ctl) };
		solo.close();

		const s = await session(start);
		const mei = await s.join('mei');
		await mei.mode('suggesting');
		await keys(mei.slowKeys);
		await s.quiet();
		expect({ text: s.host.text(), placed: shapeAlone(s.host.ctl) }).toEqual(alone);
	});

	// the visual editor splices the whole text in, which puts a letter typed beside the same letter after it
	it.each(SAME_AS_ALONE)('%s, from the visual editor', async (_, start, keys) => {
		const solo = await startSolo({ ...start, name: 'mei' });
		await keys(solo.keys);
		const alone = { text: solo.text(), placed: shapeAlone(solo.ctl) };
		solo.close();

		const s = await session(start);
		const mei = await s.join('mei');
		await mei.mode('suggesting');
		await keys(mei.visualKeys);
		await s.quiet();
		expect({ text: s.host.text(), placed: shapeAlone(s.host.ctl) }).toEqual(alone);
	});
});

it('a guest replaces, adds and deletes words; the host rejects them all and the file is exactly the original', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	mei.keys.replace('sharp', 'blunt');
	mei.keys.type('fully ', 'smooth');
	mei.keys.erase('We ');
	await agree(s, TEXT);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([
		['mei', '', 'We '],
		['mei', 'blunt', 'sharp'],
		['mei', 'fully ', '']
	]);
	await rejectAllOn(s.host.ctl, s);
	await agree(s, TEXT);
	expect(s.host.text()).toBe(TEXT);
	expect(s.host.ctl.threads.map((t) => t.decision)).toEqual(['rejected', 'rejected', 'rejected']);
	expect(
		logged()
			.filter((e) => e.t === 'open')
			.map((e) => e.by)
	).toEqual(['mei', 'mei', 'mei']);
});

it('the host accepts what a guest suggested: the words stay and nothing is left open', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	mei.keys.replace('sharp', 'blunt');
	mei.keys.type('fully ', 'smooth');
	await agree(s, TEXT);
	const suggested = s.host.text();
	await acceptAllOn(s.host.ctl, s);
	await agree(s, suggested);
	expect(s.host.text()).toBe(suggested);
	expect(s.host.ctl.threads.map((t) => t.decision)).toEqual(['accepted', 'accepted']);
	expect(openSuggestions(mei.ctl.threads)).toEqual([]);
});

it('a guest rejects their own suggestion: the words come back and nothing new is suggested', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	mei.keys.replace('sharp', 'blunt');
	mei.keys.type('fully ', 'smooth');
	await agree(s, TEXT);
	const blunt = mei.ctl.threads.find((t) => t.restore === 'sharp')!;
	expect(await mei.ctl.suggestions.reject(blunt)).toBe(true);
	await agree(s, TEXT);
	expect(s.host.text()).toBe(TEXT.replace('smooth', 'fully smooth'));
	expect(openSuggestions(s.host.ctl.threads)).toEqual([['mei', 'fully ', '']]);
	expect(s.host.ctl.threads.find((t) => t.id === blunt.id)?.decision).toBe('rejected');
	expect(logged().filter((e) => e.t === 'open')).toHaveLength(2);
});

it('a guest undoing their own Reject while suggesting suggests the words again', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	mei.keys.replace('sharp', 'blunt');
	await agree(s, TEXT);
	const rejected = mei.ctl.threads.find((t) => t.restore === 'sharp')!;
	// a person takes longer than the undo manager's half second to reach the Reject button
	mei.editor.undo.stopCapturing();
	expect(await mei.ctl.suggestions.reject(rejected)).toBe(true);
	mei.editor.undo.stopCapturing();
	await agree(s, TEXT);
	mei.editor.undo.undo();
	await agree(s, TEXT);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([['mei', 'blunt', 'sharp']]);
	expect(s.host.ctl.threads.find((t) => t.id === rejected.id)?.decision).toBe('rejected');
});

it('a guest undoing their own Reject while editing brings the same suggestion back', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	mei.keys.replace('sharp', 'blunt');
	await agree(s, TEXT);
	await mei.mode('editing');
	const rejected = mei.ctl.threads.find((t) => t.restore === 'sharp')!;
	mei.editor.undo.stopCapturing();
	expect(await mei.ctl.suggestions.reject(rejected)).toBe(true);
	mei.editor.undo.stopCapturing();
	await agree(s, TEXT);
	mei.editor.undo.undo();
	await agree(s, TEXT);
	expect(s.host.ctl.threads.filter((t) => !t.resolved).map((t) => t.id)).toEqual([rejected.id]);
});

it('a guest who signs comments with another name than the one they joined under suggests under that name', async () => {
	const s = await session();
	const mei = await s.join('mei', { author: 'Mei Chen' });
	await mei.mode('suggesting');
	mei.keys.replace('sharp', 'blunt');
	await s.quiet();
	// at the end of their own suggestion, so it grows rather than starting another
	mei.keys.type('ly', ' for');
	await agree(s, TEXT);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([['Mei Chen', 'bluntly', 'sharp']]);
	expect(await mei.ctl.suggestions.reject(mei.ctl.threads[0])).toBe(true);
	await agree(s, TEXT);
	expect(logged().flatMap((e) => (e.t === 'open' || e.t === 'resolve' ? [e.by] : []))).toEqual(['Mei Chen', 'Mei Chen']);
});

it('a guest accepts a suggestion someone else made', async () => {
	const s = await session();
	const mei = await s.join('mei');
	const ada = await s.join('ada');
	await mei.mode('suggesting');
	mei.keys.replace('sharp', 'blunt');
	await agree(s, TEXT);
	await acceptAllOn(ada.ctl, s);
	await agree(s, TEXT.replace('sharp', 'blunt'));
	expect(s.host.ctl.threads.map((t) => t.decision)).toEqual(['accepted']);
	expect(logged().flatMap((e) => (e.t === 'resolve' ? [[e.decision, e.by]] : []))).toEqual([['accepted', 'ada']]);
});

it('a guest in Editing changes the file without suggesting anything, beside the host suggesting', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await s.host.mode('suggesting');
	mei.keys.replace('sharp', 'blunt');
	s.host.keys.type('new ', 'estimator');
	const base = TEXT.replace('sharp', 'blunt');
	await agree(s, base);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([['louis', 'new ', '']]);
});

it('the host and a guest both suggesting in one sentence at once each keep their own words', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await s.host.mode('suggesting');
	await mei.mode('suggesting');
	const hostWords = 'new ';
	const guestWords = 'very ';
	for (let i = 0; i < 5; i++) {
		if (hostWords[i]) s.host.keys.type(hostWords[i], 'estimator');
		if (guestWords[i]) mei.keys.type(guestWords[i], 'smooth');
	}
	await agree(s, TEXT);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([
		['louis', 'new ', ''],
		['mei', 'very ', '']
	]);
});

it('two guests suggesting in one sentence at once each keep their own words', async () => {
	const s = await session();
	const mei = await s.join('mei');
	const ada = await s.join('ada');
	await mei.mode('suggesting');
	await ada.mode('suggesting');
	for (let i = 0; i < 5; i++) {
		if ('new '[i]) mei.keys.type('new '[i], 'estimator');
		if ('very '[i]) ada.keys.type('very '[i], 'smooth');
	}
	await agree(s, TEXT);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([
		['ada', 'very ', ''],
		['mei', 'new ', '']
	]);
	await rejectAllOn(ada.ctl, s);
	await agree(s, TEXT);
	expect(s.host.text()).toBe(TEXT);
});

it('a guest switching modes midway keeps what they typed before the switch in the mode they typed it in', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	mei.keys.type('new ', 'estimator');
	await mei.mode('editing');
	mei.keys.type('very ', 'smooth');
	await mei.mode('suggesting');
	mei.keys.erase('We ');
	const base = TEXT.replace('smooth', 'very smooth');
	await agree(s, base);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([
		['mei', '', 'We '],
		['mei', 'new ', '']
	]);
});

it('a guest editing inside another guest suggestion changes it the way it would for one person', async () => {
	const s = await session();
	const mei = await s.join('mei');
	const ada = await s.join('ada');
	await mei.mode('suggesting');
	mei.keys.replace('sharp', 'blunt');
	await agree(s, TEXT);
	// ada, editing, rewrites the suggested word: the suggestion is gone and her word stands
	ada.keys.replace('blunt', 'loose');
	await agree(s, TEXT.replace('sharp', 'loose'));
	expect(openSuggestions(s.host.ctl.threads)).toEqual([]);
	expect(s.host.ctl.threads.map((t) => t.decision)).toEqual(['closed']);
});

it('a guest suggesting inside another guest suggestion takes it over and keeps the original words', async () => {
	const s = await session();
	const mei = await s.join('mei');
	const ada = await s.join('ada');
	await mei.mode('suggesting');
	await ada.mode('suggesting');
	mei.keys.replace('sharp', 'blunt');
	await agree(s, TEXT);
	ada.keys.replace('blunt', 'loose');
	await agree(s, TEXT);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([['ada', 'loose', 'sharp']]);
	await rejectAllOn(s.host.ctl, s);
	await agree(s, TEXT);
	expect(s.host.text()).toBe(TEXT);
});

it('a guest undoing what they suggested withdraws it', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	mei.keys.type('new ', 'estimator');
	await agree(s, TEXT);
	mei.editor.undo.undo();
	await agree(s, TEXT);
	expect(s.host.text()).toBe(TEXT);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([]);
	mei.editor.undo.redo();
	await agree(s, TEXT);
	// the redo brings the words back at once, and like a paste they can stand either side of the space
	expect(openSuggestions(s.host.ctl.threads).map(([by, words, restore]) => [by, words.trim(), restore])).toEqual([['mei', 'new', '']]);
});

it('a guest retyping the words they deleted withdraws the deletion', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	mei.keys.erase('sharp ');
	await agree(s, TEXT);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([['mei', '', 'sharp ']]);
	mei.keys.type('sharp ', 'for');
	await agree(s, TEXT);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([]);
});

it('records a guest suggestion in a file the host does not have open, and places it when the host opens it', async () => {
	const s = await session({ text: TEXT, hostOpens: false });
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	mei.keys.replace('sharp', 'blunt');
	await s.quiet();
	expect(openSuggestions(s.host.ctl.threads)).toEqual([['mei', 'blunt', 'sharp']]);
	expect(disk[FILE]).toBe(TEXT.replace('sharp', 'blunt'));
	const w = s.host.writes.find((x) => x.tex.includes('blunt'))!;
	expect(w.log.some((e) => e.t === 'open' && e.by === 'mei')).toBe(true);
	mei.keys.type('fully ', 'smooth');
	await s.quiet();
	s.host.open();
	await agree(s, TEXT);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([
		['mei', 'blunt', 'sharp'],
		['mei', 'fully ', '']
	]);
});

it('every write of a guest suggestion has the log entries for it on disk first', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	for (const word of ['new ', 'very ', 'quite ']) {
		mei.keys.type(word, 'estimator');
		await s.quiet();
	}
	for (const w of s.host.writes) {
		const opened = w.log.filter((e) => e.t === 'open').length;
		const words = ['new ', 'very ', 'quite '].filter(
			(x) => w.tex.includes(x + 'estimator') || w.tex.includes(x + 'new') || w.tex.includes(x + 'very')
		).length;
		expect(opened, JSON.stringify(w.tex)).toBeGreaterThanOrEqual(words > 0 ? 1 : 0);
	}
	await agree(s, TEXT);
});

it('two guests deleting neighbouring words at once: everyone draws the struck words in the order the host recorded', async () => {
	const text = 'The adaptive scheme wins.\n';
	const s = await session({ text });
	const mei = await s.join('mei');
	const ada = await s.join('ada');
	await mei.mode('suggesting');
	await ada.mode('suggesting');
	mei.keys.cut('scheme ');
	ada.keys.erase('wins.');
	await agree(s, text);
	expect(placedOn(s.host.ctl)!.placed.map((p) => [p.author, p.restore])).toEqual([
		['mei', 'scheme '],
		['ada', 'wins.']
	]);
});

it('a guest rejecting Deletes stacked at one spot puts each one back in its place', async () => {
	const s = await session();
	const mei = await s.join('mei');
	const ada = await s.join('ada');
	await mei.mode('suggesting');
	await ada.mode('suggesting');
	// right to left, so each one stacks in front of the last
	for (const [who, words] of [
		[mei, 'solutions.'],
		[ada, 'smooth '],
		[mei, 'for '],
		[ada, 'sharp ']
	] as const) {
		who.keys.cut(words);
		await s.quiet();
	}
	await agree(s, TEXT);
	await rejectAllOn(mei.ctl, s);
	await agree(s, TEXT);
	expect(s.host.text()).toBe(TEXT);
});

it('two guests whose edits leave the file as it was last written still move the suggestions for everyone', async () => {
	const s = await session();
	const mei = await s.join('mei');
	const ada = await s.join('ada');
	await mei.mode('suggesting');
	await ada.mode('suggesting');
	mei.keys.type('new ', 'estimator');
	await s.quiet();
	ada.keys.cut('estimator ');
	await agree(s, TEXT);
	const written = s.host.text();
	// ada takes mei's words out and mei types them again, inside one write: the same file, but the
	// struck words now stand before them
	ada.keys.cut('new ');
	await until(() => !s.host.text().includes('new ') && !mei.text().includes('new '));
	mei.keys.type('new ', 'is sharp');
	await agree(s, TEXT);
	expect(s.host.text()).toBe(written);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([
		['ada', '', 'estimator '],
		['mei', 'new ', '']
	]);
});

// while the host is away the guests still reach each other, and it gets all of it back from one of
// them; nothing in that says who deleted what, so the names can be wrong, but no deleted word is lost
it('the host away while two guests edit: the one left to catch it up is editing, and the other’s deleted words are kept', async () => {
	const s = await session();
	const mei = await s.join('mei');
	const ada = await s.join('ada');
	await ada.mode('suggesting');
	await s.quiet();
	s.host.away();
	ada.keys.cut('smooth ');
	await until(() => !mei.text().includes('smooth'));
	mei.keys.cut('sharp ');
	await until(() => !ada.text().includes('sharp'));
	ada.leave();
	s.host.back();
	await agree(s, TEXT);
	expect(
		openSuggestions(s.host.ctl.threads)
			.map(([, , restore]) => restore.trim())
			.sort()
	).toEqual(['sharp', 'smooth']);
});

it('the host away long enough to forget who its guests are: their deleted words are kept', async () => {
	const s = await session();
	const mei = await s.join('mei');
	const ada = await s.join('ada');
	await mei.mode('suggesting');
	await ada.mode('suggesting');
	await s.quiet();
	s.host.away();
	// what the awareness timeout does after 30 seconds without a word from them
	removeAwarenessStates(s.host.session.awareness, [mei.doc.clientID, ada.doc.clientID], 'timeout');
	mei.keys.cut('sharp ');
	ada.keys.cut('smooth ');
	await until(() => mei.text() === ada.text() && !mei.text().includes('sharp') && !mei.text().includes('smooth'));
	s.host.back();
	await agree(s, TEXT);
});

it('a guest the host has not heard from for a while is still recorded in their own name and mode', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	await s.quiet();
	// what the awareness timeout does when a guest's updates are held up, while they are still typing
	removeAwarenessStates(s.host.session.awareness, [mei.doc.clientID], 'timeout');
	mei.keys.erase('sharp ');
	await agree(s, TEXT);
	expect(openSuggestions(s.host.ctl.threads)).toEqual([['mei', '', 'sharp ']]);
});

it('an older host that never says it records: a guest is not offered Suggesting', async () => {
	const s = await session({ text: TEXT, hostAdvertises: false });
	const mei = await s.join('mei');
	await s.quiet();
	expect(mei.hostRecords()).toBe(false);
	const s2 = await startSession({ text: TEXT });
	try {
		const ada = await s2.join('ada');
		await s2.quiet();
		expect(ada.hostRecords()).toBe(true);
	} finally {
		s2.close();
	}
});

it('a guest joining late draws the suggestions already made', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	mei.keys.replace('sharp', 'blunt');
	await agree(s, TEXT);
	await s.join('ada');
	await agree(s, TEXT);
});

it('a guest who drops off and comes back has their offline suggestions recorded, and the deleted words kept', async () => {
	const s = await session();
	const mei = await s.join('mei');
	await mei.mode('suggesting');
	await s.quiet();
	mei.away();
	mei.keys.erase('smooth ');
	mei.keys.type('new ', 'estimator');
	mei.back();
	await agree(s, TEXT);
	expect(openSuggestions(s.host.ctl.threads).map((x) => x[0])).toEqual(['mei', 'mei']);
});
