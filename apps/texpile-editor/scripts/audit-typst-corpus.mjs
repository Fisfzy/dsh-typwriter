// Round-trip audit against an external corpus of real .typ files.
//
// The repo's own fixtures only prove we agree with ourselves on source we wrote. This runs the two
// properties that actually matter over somebody else's Typst:
//
//   byte-exact   a no-edit save reproduces the file exactly
//   fixed point  regeneration (what an EDITED block goes through) does not drift on the second pass
//
// Usage:  node scripts/audit-typst-corpus.mjs <dir>          e.g. a typst checkout's tests/suite
//         node scripts/audit-typst-corpus.mjs <dir> --list   also name every failing file
//
// Nothing is vendored: point it at any directory of .typ files. It exits non-zero if a byte-exact
// failure is found, which is the guarantee no document should ever violate.
//
// Note on the fixed-point count: typst's own suite stores tests in a harness format whose
// `--- name eval ---` section markers are, in real Typst, the em-dash shorthand. Files in that
// format collapse into one long paragraph and drift on regeneration - correctly, since that is what
// the markup means. Those are reported separately so they cannot be mistaken for document bugs.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dir, ...flags] = process.argv.slice(2);
const list = flags.includes('--list');

if (!dir || !existsSync(dir)) {
	console.error('usage: node scripts/audit-typst-corpus.mjs <dir-of-typ-files> [--list]');
	process.exit(2);
}

// the converter is TS with $lib aliases, so this runs through vite-node rather than plain node
const { createServer } = await import('vite');
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const load = (p) => server.ssrLoadModule(pathToFileURL(join(import.meta.dirname, '..', p)).pathname);

const { parseTypstFile, serializeTypstFile } = await load('src/lib/typst/visual/roundtrip.ts');
const { serializeToTypst } = await load('src/lib/typst/visual/serializer.ts');
const { typstToProseMirror } = await load('src/lib/typst/visual/converter.ts');

const walk = (d) =>
	readdirSync(d, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.typ') ? [join(d, e.name)] : []
	);

/** typst's test-suite format, not a document: `--- name eval ---` section markers. */
const HARNESS = /^---\s.*\s---$/m;

const files = walk(dir);
const stats = { byte: [], fpDoc: [], fpHarness: [], crash: [] };

for (const file of files) {
	const src = readFileSync(file, 'utf8');
	const harness = HARNESS.test(src);
	try {
		const parsed = parseTypstFile(src);
		if (serializeTypstFile(parsed, parsed.doc) !== src) stats.byte.push(file);
		const gen1 = serializeToTypst(typstToProseMirror(src).doc);
		const gen2 = serializeToTypst(typstToProseMirror(gen1).doc);
		if (gen1 !== gen2) (harness ? stats.fpHarness : stats.fpDoc).push(file);
	} catch (e) {
		stats.crash.push(`${file}: ${e}`);
	}
}

await server.close();

const report = (label, arr) => {
	console.log(`${label.padEnd(28)} ${arr.length}`);
	if (list) for (const f of arr) console.log(`    ${f}`);
};

console.log(`\ncorpus: ${dir}\nfiles:  ${files.length}\n`);
report('crashes', stats.crash);
report('byte-exact failures', stats.byte);
report('fixed-point (documents)', stats.fpDoc);
report('fixed-point (harness format)', stats.fpHarness);

const fatal = stats.crash.length + stats.byte.length + stats.fpDoc.length;
console.log(`\n${fatal === 0 ? 'PASS' : `FAIL - ${fatal} problem(s) that are not harness-format artifacts`}`);
process.exit(fatal === 0 ? 0 : 1);
