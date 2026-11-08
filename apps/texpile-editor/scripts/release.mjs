// Cut a release: bump the version and move the CHANGELOG's [Unreleased] notes into a dated,
// numbered section. Changesets-lite for a single app (no fragment files, no package graph).
//
//   node scripts/release.mjs patch|minor|major   # bump from the current version
//   node scripts/release.mjs 1.2.3                # set an explicit version
//
// Writes CHANGELOG.md + the root and app package.json, then prints the next git steps. Does NOT
// commit, tag, or touch latest.json -- release.yml builds that from CHANGELOG.md at tag time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ROOT_CHANGELOG, parse } from './changelog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT_PKG = path.join(here, '../../../package.json');
const APP_PKG = path.join(here, '../package.json');
const COMPATIBILITY = 'apps/texpile-editor/src/lib/collab/compatibility.ts';
const COLLAB_WIRE = ['apps/texpile-editor/src/lib/collab', 'apps/texpile-editor/src/lib/comments/log.ts'];

function warnAboutCollabCompatibility(lastTag, next) {
	const git = (...args) =>
		execFileSync('git', args, { cwd: path.join(here, '../../..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	const oldestIn = (source) => /COLLAB_OLDEST = '([^']+)'/.exec(source)?.[1];
	let changed;
	let before;
	try {
		changed = git('diff', '--name-only', lastTag, '--', ...COLLAB_WIRE)
			.split('\n')
			.filter((f) => f.endsWith('.ts'));
	} catch {
		console.warn(`\nwarning: could not compare collaboration code against ${lastTag}; check COLLAB_OLDEST in ${COMPATIBILITY} by hand`);
		return;
	}
	try {
		before = oldestIn(git('show', `${lastTag}:${COMPATIBILITY}`));
	} catch {
		before = undefined;
	}
	const now = oldestIn(fs.readFileSync(path.join(here, '../../..', COMPATIBILITY), 'utf8'));
	if (!changed.length || (before !== undefined && before !== now)) return;
	console.warn(`\nwarning: collaboration code changed since ${lastTag}, and COLLAB_OLDEST is still ${now}:`);
	for (const f of changed) console.warn(`  ${f}`);
	console.warn(
		`If Texpile ${now} and ${next} could not share a session, set COLLAB_OLDEST in ${COMPATIBILITY} to ${next} before committing the release.`
	);
}

const arg = process.argv[2];
if (!arg) {
	console.error('usage: release.mjs <patch|minor|major|x.y.z>');
	process.exit(1);
}

const cur = JSON.parse(fs.readFileSync(ROOT_PKG, 'utf8')).version;
const [maj, min, pat] = cur.split('.').map(Number);
const next =
	arg === 'major' ? `${maj + 1}.0.0` : arg === 'minor' ? `${maj}.${min + 1}.0` : arg === 'patch' ? `${maj}.${min}.${pat + 1}` : arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) {
	console.error(`invalid version "${next}" (expected patch|minor|major or x.y.z)`);
	process.exit(1);
}

const md = fs.readFileSync(ROOT_CHANGELOG, 'utf8');
const entries = parse(md);
if (entries.some((e) => e.version === next)) {
	console.error(`CHANGELOG.md already has a ${next} section`);
	process.exit(1);
}
const pending = entries.find((e) => e.version.toLowerCase() === 'unreleased');
if (!pending || !pending.notes.length) {
	console.error('no notes under "## [Unreleased]"; add release notes there first');
	process.exit(1);
}

// replace the Unreleased section with an empty Unreleased + the new dated section; older
// releases below are kept as-is. Output is normalized so it stays prettier-clean.
const today = new Date().toISOString().slice(0, 10);
const section = `## [${next}] - ${today}\n\n` + pending.notes.map((n) => `- ${n}`).join('\n');
const unrelHead = md.search(/^##\s+\[?Unreleased\]?/im);
const nextHead = md.slice(unrelHead).search(/\n##\s+/); // start of the next (older) section, or -1
const before = md.slice(0, unrelHead).replace(/\n*$/, '\n\n');
const older = nextHead === -1 ? '' : md.slice(unrelHead + nextHead).replace(/^\n+/, '\n');
const out = `${before}## [Unreleased]\n\n${section}\n${older}`.replace(/\n*$/, '\n');
fs.writeFileSync(ROOT_CHANGELOG, out);

for (const pkg of [ROOT_PKG, APP_PKG]) {
	const j = JSON.parse(fs.readFileSync(pkg, 'utf8'));
	j.version = next;
	fs.writeFileSync(pkg, JSON.stringify(j, null, '\t') + '\n');
}

console.log(`released ${cur} -> ${next}`);
console.log('  updated CHANGELOG.md, package.json (root + app)');
warnAboutCollabCompatibility(`v${cur}`, next);
console.log('\nnext:');
console.log(`  git commit -am "release v${next}"`);
console.log(`  git tag v${next} && git push --follow-tags   # release.yml builds + publishes`);
