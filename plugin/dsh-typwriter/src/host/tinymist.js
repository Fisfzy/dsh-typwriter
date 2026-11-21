// 自带 tinymist / typst 的下载安装器。
//
// 为什么需要它：插件包在 npm 上不带 `bin/`（gitignore 掉了，打包时也没有），而写作台的
// 预览、LSP 诊断、终端里的 `typst compile` 全指望 `bin/` 里那两份二进制（见 lsp.js#exe()
// 与 term.js 的 PATH 前置）。干净机器上 PATH 里同样没有 → 开箱即用不成立。
//
// 所以这里把「安装」做成真的：按当前平台挑官方 release 的 asset，下载 → 校验（能跑起来才算
// 装好）→ 解包 → 落到 <插件>/bin/，并把进度和结果用 SSE 广播给面板（契约见 app.d.ts 的
// TinymistInstallStep / TinymistInstallResult）。
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 与随包测试过的那两份对齐（bin/ 里的 tinymist v0.15.12 / typst 0.15.1） */
const TINYMIST_VERSION = '0.15.12';
const TYPST_VERSION = '0.15.1';

const TINYMIST_REPO = 'Myriad-Dreamin/tinymist';
const TYPST_REPO = 'typst/typst';

/** 平台三元组：只列我们真正验证过「官方有对应 asset」的组合，其余报 unsupported 而不是瞎猜 */
const TARGETS = {
	'win32-x64': { triple: 'x86_64-pc-windows-msvc', kind: 'zip', exe: 'tinymist.exe', typstExe: 'typst.exe' },
	'win32-arm64': { triple: 'aarch64-pc-windows-msvc', kind: 'zip', exe: 'tinymist.exe', typstExe: 'typst.exe' },
	'linux-x64': { triple: 'x86_64-unknown-linux-gnu', kind: 'tar.gz', exe: 'tinymist', typstExe: 'typst' },
	'linux-arm64': { triple: 'aarch64-unknown-linux-gnu', kind: 'tar.gz', exe: 'tinymist', typstExe: 'typst' },
	'darwin-arm64': { triple: 'aarch64-apple-darwin', kind: 'tar.gz', exe: 'tinymist', typstExe: 'typst' },
	'darwin-x64': { triple: 'x86_64-apple-darwin', kind: 'tar.gz', exe: 'tinymist', typstExe: 'typst' }
};

export function targetFor(platform = process.platform, arch = process.arch) {
	return TARGETS[`${platform}-${arch}`] ?? null;
}

/** GitHub release 的 asset 清单（一次安装只问一次；限流时退回按名字直接拼） */
const releaseAssets = new Map();
async function assetsOf(repo, tag) {
	const key = `${repo}@${tag}`;
	if (releaseAssets.has(key)) return releaseAssets.get(key);
	const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v${tag}`, {
		headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-typwriter' }
	});
	if (!res.ok) throw new Error(`release ${repo} v${tag}: HTTP ${res.status}`);
	const json = await res.json();
	const assets = (json.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
	releaseAssets.set(key, assets);
	return assets;
}

/** 在 asset 清单里挑出当前平台的那一个；挑不到就 null（调用方按 unsupported 处理）
 *
 * 必须按「<cli>-<三元组>.<ext>」精确取：同一个 release 里还有 tinymist-docs-tool-<三元组>.zip
 * 这种同名兄弟，宽松的 includes() 会先撞上它，解出来是个看不懂文档的工具。
 */
function pickAsset(assets, target, ext, cliName) {
	const wanted = assets.filter((a) => a.name.endsWith(ext) && !a.name.endsWith('.sha256'));
	const exact = wanted.find((a) => a.name === `${cliName}-${target.triple}${ext}`);
	if (exact) return exact;
	return (
		wanted.find(
			(a) => a.name.startsWith(`${cliName}-`) && a.name.includes(target.triple) && !/docs-tool|debug|\.pdb$/i.test(a.name)
		) ?? null
	);
}

/** 下载一个 URL 到文件，边写边报进度；截图不到总长时 total 记 0（UI 会显示不确定进度）
 *
 * 不用 fetch 的 body 流：undici 默认 bodyTimeout 300s，这条线路上 30MB 的包经常超过它，
 * 结果就是「下到一半 terminated」。这里换成 node:https，超时只按「多久没收到数据」算，
 * 并带 Range 断点续传 + 两次重试——国内访问 GitHub release 的现实约束。
 */
async function fetchOnce(url, dest, { signal, onProgress, received, total }) {
	const headers = { 'user-agent': 'dsh-typwriter' };
	// 续传：只取还没下到的部分。GitHub 的对象存储对 Range 支持很好（206）
	if (received > 0) headers.range = `bytes=${received}-`;
	const res = await fetch(url, { signal, redirect: 'follow', headers });
	if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
	const status = res.status;
	const length = Number(res.headers.get('content-length') || 0);
	// 206：content-length 是「剩余长度」，全长要从上次的 total 推回来
	const full = status === 206 ? total || received + length : length;
	const out = createWriteStream(dest, { flags: status === 206 ? 'a' : 'w' });
	let got = status === 206 ? received : 0;
	let last = 0;
	try {
		for await (const chunk of res.body) {
			if (signal?.aborted) throw new Error('cancelled');
			got += chunk.length;
			if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
			const now = Date.now();
			if (now - last > 120) {
				last = now;
				onProgress({ phase: 'download', received: got, total: full });
			}
		}
	} finally {
		await new Promise((r) => out.end(r));
	}
	onProgress({ phase: 'download', received: got, total: full || got });
	return { received: got, total: full };
}

async function download(url, dest, { signal, onProgress, total }) {
	// curl 优先：它跟随系统代理设置（Windows 的 WinINET / macOS 的系统代理），而这台机器上
	// Node 的直连会 UND_ERR_CONNECT_TIMEOUT；curl 还自带重试与断点续传（-C -）。
	if (hasCurl()) return downloadViaCurl(url, dest, { signal, onProgress, total });

	let received = 0;
	let known = total || 0;
	// 四次尝试 + Range 续传：GitHub release 的直连会中途断
	for (let attempt = 0; attempt < 4; attempt++) {
		if (signal?.aborted) throw new Error('cancelled');
		const r = await fetchOnce(url, dest, { signal, onProgress, received, total: known });
		if (r.total) known = r.total;
		received = r.received;
		if (!known || received >= known) return received;
	}
	throw new Error(`下载未完成（${received}/${known || '?'} 字节）`);
}

function hasCurl() {
	const r = spawnSync('curl', ['--version'], { stdio: 'ignore', windowsHide: true });
	return r.status === 0;
}

function downloadViaCurl(url, dest, { signal, onProgress, total }) {
	return new Promise((resolve, reject) => {
		const args = ['-L', '--fail', '--silent', '--show-error', '--retry', '3', '--retry-delay', '2', '-C', '-', '-o', dest, url];
		const child = spawn('curl', args, { windowsHide: true });
		let err = '';
		// curl 的进度在 stderr 上是一堆 \r，不如直接看落盘大小：稳定、也不依赖版本
		const tick = setInterval(() => {
			stat(dest)
				.then((s) => onProgress({ phase: 'download', received: s.size, total: total || s.size }))
				.catch(() => {});
		}, 300);
		const abort = () => child.kill();
		signal?.addEventListener('abort', abort, { once: true });
		child.stderr?.on('data', (c) => (err += c));
		child.on('error', (e) => {
			clearInterval(tick);
			reject(e);
		});
		child.on('close', (code) => {
			clearInterval(tick);
			signal?.removeEventListener('abort', abort);
			if (signal?.aborted) return reject(new Error('cancelled'));
			if (code === 0) return resolve();
			reject(new Error(err.trim() || `curl exit ${code}`));
		});
	});
}

/** 用系统 tar 解包：Windows 10+ 的 bsdtar 能读 zip，GNU tar / bsdtar 都能读 tar.gz */
function untar(archive, dir) {
	return new Promise((resolve, reject) => {
		const child = spawn('tar', ['-xf', archive, '-C', dir], { windowsHide: true });
		let err = '';
		child.stderr?.on('data', (c) => (err += c));
		child.on('error', reject);
		child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `tar exit ${code}`))));
	});
}

/** 解包目录里按文件名找可执行文件（release 里可能在根，也可能套一层目录） */
async function findBinary(dir, name) {
	const stack = [dir];
	while (stack.length) {
		const at = stack.pop();
		let entries;
		try {
			entries = await readdir(at, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			const full = join(at, e.name);
			if (e.isDirectory()) stack.push(full);
			else if (e.name === name) return full;
		}
	}
	return null;
}

/** 跑一次 --version 拿到版本号；跑不起来 = 这份二进制在这个平台上不能用 */
function probeVersion(exe) {
	return new Promise((resolve) => {
		let out = '';
		const child = spawn(exe, ['--version'], { windowsHide: true });
		const timer = setTimeout(() => child.kill(), 15000);
		child.stdout?.on('data', (c) => (out += c));
		child.stderr?.on('data', (c) => (out += c));
		child.on('error', () => {
			clearTimeout(timer);
			resolve({ ok: false, out: '' });
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ ok: code === 0, out });
		});
	});
}

function tinymistVersionOf(out) {
	return (
		/Build Git Describe:\s*v?([0-9][^\s]*)/i.exec(out)?.[1] ??
		/^\s*tinymist\s+v?([0-9][^\s]*)/im.exec(out)?.[1] ??
		null
	);
}

const CANCELLED = Symbol('cancelled');

/**
 * 一次安装 = 一份 pin 住的 tinymist（+ typst CLI）。
 *
 * status() 读的是宿主缓存的探测结果（rpc.js 的 tinymistInfo），安装成功后由调用方
 * forget() 掉缓存再重新探测，避免「装好了但界面还显示未安装」。
 */
export class TinymistInstaller {
	constructor({ binDir, emit, logger, probe, forget }) {
		this.binDir = binDir;
		this.emit = emit || (() => {});
		this.logger = logger;
		this.probe = probe;
		this.forget = forget;
		this.running = null;
		this.abort = null;
		this.step = null;
	}

	/** 当前平台能不能装：不联网，只看有没有对应三元组 */
	get supported() {
		return !!targetFor();
	}

	status() {
		const info = this.probe?.() ?? null;
		return {
			pinned: TINYMIST_VERSION,
			supported: this.supported,
			installed: info ? { command: info.command, version: info.version, typstVersion: info.typstVersion } : null,
			step: this.step
		};
	}

	#progress(step) {
		this.step = step;
		this.emit('typst:tinymist:progress', step);
	}

	#finish(result) {
		this.step = null;
		this.emit('typst:tinymist:finished', result);
		return result;
	}

	async install() {
		// 已经在位就直接成功：UI 只在缺失时露按钮，但重进面板可能重复点
		const now = this.probe?.();
		if (now) return { ok: true, command: now.command, version: now.version, typstVersion: now.typstVersion };
		if (this.running) return this.running;

		const target = targetFor();
		if (!target) {
			return this.#finish({
				ok: false,
				reason: 'unsupported',
				detail: `没有为 ${process.platform}/${process.arch} 提供预编译的 tinymist；请自行安装后放进 PATH。`
			});
		}

		this.abort = new AbortController();
		this.running = this.#run(target).finally(() => {
			this.running = null;
			this.abort = null;
		});
		return this.running;
	}

	cancel() {
		this.abort?.abort();
	}

	async #run(target) {
		const signal = this.abort.signal;
		let work = null;
		try {
			await mkdir(this.binDir, { recursive: true });
			work = await mkdtemp(join(tmpdir(), 'typwriter-tinymist-'));

			const tinymist = await this.#asset(TINYMIST_REPO, TINYMIST_VERSION, target, target.kind === 'zip' ? '.zip' : '.tar.gz');
			if (!tinymist) {
				return this.#finish({
					ok: false,
					reason: 'unsupported',
					detail: `tinymist v${TINYMIST_VERSION} 的发布里没有 ${target.triple} 的包。`
				});
			}
			await this.#place(tinymist, target, target.exe, work, signal);

			// typst CLI：编译走终端里的 `typst compile`，缺了它只有预览能看、编译仍会失败。
			// 属于尽力而为：失败只记日志，不让整次「安装 tinymist」失败。
			try {
				const typst = await this.#asset(TYPST_REPO, TYPST_VERSION, target, target.kind === 'zip' ? '.zip' : '.tar.gz');
				if (typst) await this.#place(typst, target, target.typstExe, work, signal, true);
				else this.logger?.write?.(`[tinymist] typst v${TYPST_VERSION} 没有 ${target.triple} 的包，跳过`);
			} catch (e) {
				if (e === CANCELLED) throw e;
				this.logger?.write?.(`[tinymist] typst CLI 安装失败（不影响 tinymist）: ${e.message || e}`);
			}

			this.forget?.();
			const info = this.probe?.();
			if (!info) {
				return this.#finish({
					ok: false,
					reason: 'broken',
					detail: '文件已解出，但 tinymist 跑不起来（版本号读不到）。请检查杀毒软件或系统架构。'
				});
			}
			return this.#finish({ ok: true, command: info.command, version: info.version, typstVersion: info.typstVersion });
		} catch (e) {
			if (e === CANCELLED || signal.aborted) {
				return this.#finish({ ok: false, reason: 'cancelled', detail: '安装已取消。' });
			}
			const reason =
				e?.reason ??
				(e?.code === 'ENOSPC'
					? 'disk'
					: /fetch failed|ENOTFOUND|EAI_AGAIN|network|HTTP \d/i.test(String(e?.message))
						? 'offline'
						: 'download');
			this.logger?.write?.(`[tinymist] install failed: ${e?.stack || e}`);
			return this.#finish({ ok: false, reason, detail: String(e?.message || e) });
		} finally {
			if (work) await rm(work, { recursive: true, force: true }).catch(() => {});
		}
	}

	async #asset(repo, version, target, ext) {
		const cliName = repo.split('/')[1].toLowerCase();
		let assets;
		try {
			assets = await assetsOf(repo, version);
		} catch (e) {
			// 限流/断网时退回按发布页的命名直接拼（GitHub 会 302 到对象存储）
			const name = `${cliName}-${target.triple}${ext}`;
			this.logger?.write?.(`[tinymist] release API 不可用（${e.message || e}），改按命名猜测 ${name}`);
			return { name, url: `https://github.com/${repo}/releases/download/v${version}/${name}` };
		}
		return pickAsset(assets, target, ext, cliName);
	}

	async #place(asset, target, exeName, work, signal, quiet = false) {
		const archive = join(work, asset.name);
		// 次要包（typst CLI）不报进度：一次安装只有一条进度条，两个文件会让它先满再回退
		const step = (s) => {
			if (!quiet) this.#progress(s);
		};
		step({ phase: 'download', received: 0, total: asset.size || 0 });
		await download(asset.url, archive, {
			signal,
			total: asset.size || 0,
			onProgress: step
		});
		const archiveBytes = (await stat(archive)).size;
		if (!archiveBytes) throw new Error('下载得到空文件');

		step({ phase: 'verify', received: archiveBytes, total: archiveBytes });
		if (asset.size && archiveBytes !== asset.size) {
			throw Object.assign(new Error(`大小不符：期望 ${asset.size}，实际 ${archiveBytes}`), { reason: 'checksum' });
		}

		step({ phase: 'extract', received: archiveBytes, total: archiveBytes });
		const dir = join(work, `x-${exeName}`);
		await mkdir(dir, { recursive: true });
		await untar(archive, dir);

		const found = await findBinary(dir, exeName);
		if (!found) {
			const seen = await readdir(dir, { recursive: true }).catch(() => []);
			throw Object.assign(new Error(`包内找不到 ${exeName}（解出：${seen.slice(0, 6).join(', ')}）`), { reason: 'extract' });
		}

		const dest = join(this.binDir, exeName);
		await copyFile(found, dest);
		if (process.platform !== 'win32') await chmod(dest, 0o755);

		const version = await probeVersion(dest);
		if (!version.ok) throw Object.assign(new Error(`${exeName} 解出后无法运行`), { reason: 'broken' });
		this.logger?.write?.(`[tinymist] ${exeName} 已安装（${tinymistVersionOf(version.out) ?? 'unknown'}）`);
	}

	async remove() {
		const names = ['tinymist.exe', 'tinymist', 'typst.exe', 'typst'];
		let removed = 0;
		for (const n of names) {
			await rm(join(this.binDir, n), { force: true }).then(
				() => removed++,
				() => {}
			);
		}
		this.forget?.();
		const info = this.probe?.();
		if (info) return { ok: false, reason: 'disk', detail: '还有别的 tinymist 在 PATH 上，移除插件自带的之后依然可用。' };
		return { ok: true };
	}
}
