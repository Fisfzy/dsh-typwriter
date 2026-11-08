// Live-mode edit-class matrix, browser-harness edition: the REAL DraftView mounted in
// headless Chromium (vite dev serves it), the REAL engine behind an HTTP bridge, and the
// REAL dispatch decision layer ($lib/draft/dispatch) imported by the page. No Electron.
//
// No build step: the bridge bundles the engine from electron/src and vite dev serves the
// renderer from source, so edits on either side are picked up per run.
// Run from apps/texpile-editor:  node tests/live/matrix.mjs [--only=fixture[:scenario]]
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { FIXTURES, applyOp } from './scenarios.mjs';
import { classify, collectUntilQuiet } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '../..');
const BRIDGE = 8099;
const VITE = 5177;

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const [onlyFixture, onlyScenario] = only ? only.split(':') : [null, null];

// one edit, so the compile after it is the patch's own: a row it drew or moved that the engine set elsewhere is
// a wrong render. (A session of several keys has no such compile, so the app does not grade moved rows.)
function gradeVerify(events, res) {
	for (const e of events) {
		if (e.kind !== 'patch-verify') continue;
		const d = e.detail ?? {};
		if (d.verdict === 'wrong' || (d.flowDrift ?? 0) > 0.5) {
			res.outcome = 'WRONG';
			res.reasons.push(`VERIFY-WRONG/p${d.page}/drift${d.drift}/flow${d.flowDrift ?? 0}`);
		}
	}
}

const waitHttp = async (url, tries = 120) => {
	for (let i = 0; i < tries; i++) {
		try {
			const r = await fetch(url);
			if (r.status < 500) return;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error('not up: ' + url);
};

const bridge = spawn(process.execPath, [path.join(here, 'server.mjs')], { stdio: 'inherit' });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'dev', '--port', String(VITE), '--strictPort'], {
	cwd: appRoot,
	stdio: 'ignore'
});
const killEngines = () => {
	for (const im of ['lualatex.exe', 'luatex.exe'])
		try {
			execSync(`taskkill /F /IM ${im} /T`, { stdio: 'ignore' });
		} catch {
			/* none */
		}
};

const post = async (p, body) => (await fetch(`http://localhost:${BRIDGE}${p}`, { method: 'POST', body: JSON.stringify(body) })).json();
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const rows = [];

try {
	await waitHttp(`http://localhost:${BRIDGE}/ping`);
	await waitHttp(`http://localhost:${VITE}/tests/live/live.html`);
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
	page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
	await page.goto(`http://localhost:${VITE}/tests/live/live.html`, { timeout: 60000 });
	await page.waitForFunction(() => !!window.__live, undefined, { timeout: 60000 });

	for (const fx of FIXTURES) {
		if (onlyFixture && fx.name !== onlyFixture) continue;
		console.log(`\n== fixture ${fx.name} ==`);
		const { root } = await post('/fixture', { name: fx.name, run: stamp });
		let base = fs.readFileSync(path.join(root, 'main.tex'), 'utf8');
		await page.evaluate((r) => window.__live.open(r), root);
		let ev0 = await collectUntilQuiet(page, { quietMs: 1500, maxMs: 60000 });
		if (!ev0.some((e) => e.kind === 'compiled')) console.log('  (warmup compile not observed)', ev0.map((e) => e.kind).join(' '));

		for (const sc of fx.scenarios) {
			if (onlyScenario && sc.name !== onlyScenario) continue;
			let pre = base;
			if (sc.preOp) {
				// a prior edit whose patch left the baseline behind (the app's normal state
				// mid-writing); dispatch it and discard its events. Like the app, the baseline
				// only advances if a reconcile happens to land (mirror it from disk).
				pre = applyOp(base, { ...sc, anchor: sc.preAnchor ?? sc.anchor, op: sc.preOp, line: undefined });
				if (pre === null) pre = base;
				else {
					const dp = await page.evaluate(([a, b]) => window.__live.decide(a, b), [base, pre]);
					if (dp.kind === 'patch') {
						await page.evaluate(([req, r, buf]) => window.__live.patch(req, r, buf), [dp, root, pre]);
						const evPre = await collectUntilQuiet(page, { maxMs: 12000 });
						if (evPre.some((e) => e.kind === 'compiled')) base = fs.readFileSync(path.join(root, 'main.tex'), 'utf8');
					}
				}
			}
			const edited = applyOp(pre, sc);
			if (edited === null) {
				rows.push({ fixture: fx.name, ...sc, outcome: 'ANCHOR-MISSING', latencyMs: null, reasons: [] });
				console.log(`  ${sc.name}: ANCHOR-MISSING`);
				continue;
			}
			const d = await page.evaluate(([a, b]) => window.__live.decide(a, b), [base, edited]);
			if (process.env.MATRIX_DEBUG) console.log(`   decide: ${d.kind}`, JSON.stringify(d).slice(0, 300));
			let res;
			if (d.kind === 'noop') res = { outcome: 'NOOP', latencyMs: 0, reasons: [] };
			else if (d.kind === 'skip-unbalanced') res = { outcome: 'HOLD', latencyMs: null, reasons: ['skip-unbalanced'] };
			else if (d.kind === 'boundary' || d.kind === 'env-body') {
				// the app debounces then full-recompiles: reproduce that so the doc advances
				await post('/write', { root, content: edited });
				await page.evaluate(() => window.__live.recompile());
				const ev = await collectUntilQuiet(page, { maxMs: sc.maxMs ?? 16000 });
				const c = classify(ev);
				res = { outcome: 'RECOMPILE', latencyMs: c.latencyMs, reasons: [d.kind === 'env-body' ? 'env-body:' + d.env : 'boundary-line'] };
			} else if (d.kind === 'structural') {
				// no JS-placed splice exists: structural = the honest debounced full pass
				res = { outcome: 'RECOMPILE', latencyMs: null, reasons: [d.reason] };
				await post('/write', { root, content: edited });
				await page.evaluate(() => window.__live.recompile());
				await collectUntilQuiet(page, { maxMs: 20000 });
			} else {
				// patch dispatch through the real instantPatch
				await page.evaluate(([req, r, buf]) => window.__live.patch(req, r, buf), [d, root, edited]);
				if (process.env.MATRIX_SHOT_EARLY) {
					await new Promise((r) => setTimeout(r, 500));
					await page.screenshot({ path: path.join(here, 'results', `early-${fx.name}-${sc.name}.png`), fullPage: true });
				}
				let ev = await collectUntilQuiet(page, { maxMs: sc.maxMs ?? 12000 });
				if (process.env.MATRIX_DUMP_EVENTS)
					fs.writeFileSync(path.join(here, 'results', `events-${fx.name}-${sc.name}.json`), JSON.stringify(ev, null, 1));
				for (let retry = 0; retry < 2 && !ev.length; retry++) {
					// straggler race (a late compile/warm settling as we dispatched): retry patiently
					console.log(
						`   (no events, retry ${retry + 1}; raw=`,
						JSON.stringify(await page.evaluate(() => (window.__draftEvents || []).map((e) => e.kind))).slice(0, 300),
						')'
					);
					await new Promise((r) => setTimeout(r, 1500 + retry * 2500));
					await page.evaluate(([req, r, buf]) => window.__live.patch(req, r, buf), [d, root, edited]);
					ev = await collectUntilQuiet(page, { maxMs: sc.maxMs ?? 12000 });
				}
				if (sc.thenOp) {
					const edited2 = applyOp(edited, { ...sc, op: sc.thenOp });
					if (edited2 !== null) {
						const d2 = await page.evaluate(([a, b]) => window.__live.decide(a, b), [base, edited2]);
						if (d2.kind === 'patch') {
							await page.evaluate(([req, r, buf]) => window.__live.patch(req, r, buf), [d2, root, edited2]);
							ev = ev.concat(await collectUntilQuiet(page, { maxMs: sc.maxMs ?? 12000 }));
						}
					}
				}
				res = classify(ev);
				if (d.transient && res.outcome === 'NOFEEDBACK') res.outcome = 'TRANSIENT';
				if (!sc.thenOp) gradeVerify(ev, res);
				if (process.env.MATRIX_DEBUG) console.log('   events:', JSON.stringify(ev).slice(0, 2500));
			}
			if (process.env.MATRIX_SHOT)
				await page.screenshot({ path: path.join(here, 'results', `shot-${fx.name}-${sc.name}.png`), fullPage: true });
			// baseline resync: make sure a compile has landed with the edited source. It is also the
			// only grade an ADOPTED patch gets: no reconcile runs behind one, so what it painted meets
			// the engine's own records here, as records-adopted-drift, or not at all
			base = edited;
			if (sc.thenOp) base = applyOp(edited, { ...sc, op: sc.thenOp }) ?? edited;
			await post('/write', { root, content: base });
			await page.evaluate(() => window.__live.recompile());
			const resync = await collectUntilQuiet(page, { quietMs: 1200, maxMs: 25000 });
			if (!sc.thenOp && res.outcome !== 'WRONG') gradeVerify(resync, res);
			for (const e of resync) {
				if (e.kind !== 'records-adopted-drift') continue;
				const d = e.detail ?? {};
				res.reasons.push(`ADOPTED-DRIFT/dy${d.maxDy}/dx${d.maxDx}/rows${d.rows}v${d.freshRows}`);
				// a render claimed exact that the engine placed elsewhere; the rest is record rounding
				if (d.maxDy > 0.5 || d.maxDx > 0.5 || d.rows !== d.freshRows) res.outcome = 'WRONG';
			}
			if (process.env.MATRIX_DEBUG) console.log('   resync:', JSON.stringify(resync).slice(0, 1500));
			const ceilOk = sc.expect.includes(res.outcome);
			console.log(
				`  ${sc.name}: ${res.outcome}${res.latencyMs != null ? ` ${res.latencyMs}ms` : ''} ${ceilOk ? 'AT-CEILING' : `(ceiling ${sc.expect.join('|')})`} ${res.reasons.join(',')}`
			);
			rows.push({ fixture: fx.name, ...sc, ...res });
		}
		await post('/stop', {});
	}
	await browser.close();
} finally {
	bridge.kill();
	vite.kill();
	killEngines();
}

const md = [
	`# Live-mode edit-class matrix - ${stamp}`,
	'',
	'| Fixture | Scenario | Outcome | Latency | Ceiling | At ceiling | Reasons |',
	'|---|---|---|---|---|---|---|',
	...rows.map(
		(r) =>
			`| ${r.fixture} | ${r.name} | ${r.outcome} | ${r.latencyMs != null ? r.latencyMs + 'ms' : '-'} | ${(r.expect || []).join('/')} | ${
				(r.expect || []).includes(r.outcome) ? 'yes' : 'NO'
			} | ${(r.reasons || []).join(', ')} |`
	),
	'',
	`At ceiling: ${rows.filter((r) => (r.expect || []).includes(r.outcome)).length}/${rows.length}`
].join('\n');
const outDir = path.join(here, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `matrix-${stamp}.md`), md);
console.log('\n' + md);
console.log(`\nwritten to tests/live/results/matrix-${stamp}.md`);
