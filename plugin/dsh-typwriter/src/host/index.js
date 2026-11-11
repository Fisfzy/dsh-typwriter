// dsh-typwriter host 半片：把 Texpile 的渲染端 SPA 挂在 /typwriter 下，
// 并提供它需要的 bridge（RPC / 原始字节 / SSE / 终端）。
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Store, dshHome } from './state.js';
import { createDispatch, setOriginHint } from './rpc.js';
import { preparedPreviewHtml } from './previewPage.js';
import { Terminals } from './term.js';
import { LspHost } from './lsp.js';
import { AcpHost } from './acp.js';
import { appFilePath, injectIndex, readIndex, sendJson, serveFileBytes, serveStatic } from './static.js';
import { PreviewPageServer } from './previewServer.js';
import { createLogger } from './log.js';
import { WorkspaceWatcher } from './watch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..', '..');
const APP_DIR = join(PLUGIN_ROOT, 'app');
const BIN_DIR = join(PLUGIN_ROOT, 'bin');
const SHIM_FILE = join(PLUGIN_ROOT, 'src', 'browser', 'shim.js');

export const name = 'dsh-typwriter';

const BASE = '/typwriter';

/** 插件路由绕过 DSH 的 /api 信任栅栏，必须自己校验 */
function requestRejection(ctx, req) {
  const connection = ctx.get('connection');
  if (typeof connection?.requestRejection !== 'function') return 403;
  return connection.requestRejection({ headers: req.headers });
}

export default {
  inject: ['webServer', 'connection'],
  apply(ctx) {
    const store = new Store();
    // 桌面端宿主的 stdout 看不见（GUI 启动）：关键事件落盘，出问题可直接查
    const logger = createLogger(join(dshHome(), 'typwriter'));

    // ---- SSE：所有单向下发走一条流 ----
    const clients = new Set();
    // 没有订阅者时先缓存，连上后补发。
    // 没有这一层，LSP 的 initialize 回包（毫秒级）会在 EventSource 建立前到达并永久丢失，
    // 表现为客户端一直等回应、预览永远"正在连接"。
    const pendingFrames = [];
    const PENDING_LIMIT = 500;
    const emit = (channel, payload) => {
      const frame = `event: ${channel}\ndata: ${JSON.stringify(payload)}\n\n`;
      if (clients.size === 0) {
        pendingFrames.push(frame);
        if (pendingFrames.length > PENDING_LIMIT) pendingFrames.shift();
        return;
      }
      for (const res of clients) {
        try {
          res.write(frame);
        } catch {
          clients.delete(res);
        }
      }
    };

    const terminals = new Terminals(emit, BIN_DIR);
    // 外部改动（Agent / 其他编辑器写文件）→ 通知渲染端刷新树与缓冲区
    const watcher = new WorkspaceWatcher(emit, logger);
    const lsp = new LspHost(BIN_DIR, emit, logger);
    // ACP：在 Texpile 面板里跑 DSH。工作区优先用设置里的 acpWorkspace，否则用当前论文目录
    const acpWorkspace = () => {
      const s = store.state?.settings || {};
      // 自定义目录优先；否则回落到当前打开的论文目录（activeRoot）
      if (s.agentWorkspaceMode === 'custom') {
        const p = typeof s.agentWorkspacePath === 'string' ? s.agentWorkspacePath.trim() : '';
        if (p) return p;
      }
      const legacy = typeof s.acpWorkspace === 'string' ? s.acpWorkspace.trim() : '';
      return legacy || null;
    };
    const acp = new AcpHost(emit, {
      binDir: BIN_DIR,
      command: 'dsh',
      argsFor: () => ['--profile', 'acp'],
      workspace: () => acpWorkspace() || store.state?.activeRoot || null,
      // 关掉「继承宿主插件」时，用一个独立的 DSH 家目录：插件更干净、启动更快，
      // 但那里必须有 API key（否则模型调用会报 no API key）。
      env: () => {
        const s = store.state?.settings || {};
        if (s.agentInheritHostPlugins === false) {
          return { DSH_HOME: join(dshHome(), 'typwriter-agent') };
        }
        return {};
      }
    });
    // 清空尚未投递的 LSP 帧：重载后新客户端若收到上一轮会话的 initialize 回包，
    // 会按旧的 id 匹配、握手当场错乱。所以每次 startLsp 之前都把缓存丢掉。
    const clearPendingLsp = () => {
      for (let i = pendingFrames.length - 1; i >= 0; i--) {
        if (pendingFrames[i].startsWith('event: typst:lsp:')) pendingFrames.splice(i, 1);
      }
    };
    // 预览页的 loopback http 原点：tinymist 的数据面只接受 http://127.0.0.1 来的
    // WebSocket（Origin 白名单），DSH 桌面端页面原点是 dsh-app://app，同源提供会被
    // 拒绝；所以预览页由这个独立的小服务提供，渲染端跨源 iframe 嵌入。
    const previewServer = new PreviewPageServer();

    // 目录选择：DSH 平台的 ctx.directoryPicker（desktop=原生 IFileOpenDialog，
    // 远程=browse 后端）。服务可能在插件装配之后才就绪，所以这里惰性取。
    const pickDirectory = async () => {
      const picker = ctx.get('directoryPicker');
      const capability = picker?.capability?.();
      if (!capability) return null;
      if (capability.kind === 'native') {
        const result = await capability.pick(new AbortController().signal);
        return typeof result === 'string' && result ? result : null;
      }
      // browse 后端：本插件没有自己的目录浏览器，交给 DSH 侧入口（?root=）
      return null;
    };

    const dispatch = createDispatch({
      store,
      terminals,
      lsp,
      acp,
      appDir: APP_DIR,
      binDir: BIN_DIR,
      clearPendingLsp,
      previewServer,
      pickDirectory,
      logger,
      watcher
    });

    // 工作区围栏：只有已打开（activeRoot）或本次 claim 过的目录可以读字节
    const claimedRoots = new Set();
    const allowedRoots = () => {
      const roots = [];
      const active = store.state?.activeRoot;
      if (active) roots.push(active);
      for (const r of claimedRoots) roots.push(r);
      return roots;
    };

    const readBody = (req, limit = 64 * 1024 * 1024) =>
      new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', (c) => {
          total += c.length;
          if (total > limit) {
            reject(new Error('body too large'));
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });

	async function handle(req, res) {
		const url = new URL(req.url, 'http://127.0.0.1');
		let p = url.pathname;

		// 0) tinymist 预览页的注入版（web 宿主用同源页：画布框选的合成角点只在此页生效；
		//    桌面宿主的原点不受 http 来源规则限制，rpc 层按 originHint 选 loopback）
		if (p === `${BASE}/preview-page`) {
			try {
				const html = await preparedPreviewHtml({
					host: url.searchParams.get('host') ?? '',
					background: url.searchParams.get('bg') ?? '#ffffff',
					foreground: url.searchParams.get('fg') ?? '#000000',
					scrollbarThumb: url.searchParams.get('thumb') ?? '#888888',
					scrollbarRadius: url.searchParams.get('radius') ?? '6',
					dark: url.searchParams.get('dark') === '1'
				});
				res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
				return res.end(html);
			} catch (e) {
				return sendJson(res, 502, { error: String(e?.message || e) });
			}
		}

		// 0) 原始字节（取代 texfile://）
      if (p === `${BASE}/api/file`) {
        return serveFileBytes(req, res, { allowedRoots });
      }

      // 2) SSE
      if (p === `${BASE}/api/events`) {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no'
        });
        res.write(': typwriter events\n\n');
        clients.add(res);
        // 补发连接建立前缓存的下发
        if (pendingFrames.length) {
          const buffered = pendingFrames.splice(0, pendingFrames.length);
          for (const f of buffered) {
            try {
              res.write(f);
            } catch {
              break;
            }
          }
        }
        const ping = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            /* ignore */
          }
        }, 25000);
        req.on('close', () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }

      // 3) RPC
      if (p === `${BASE}/api/rpc` && req.method === 'POST') {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch (e) {
          return sendJson(res, 400, { ok: false, error: `bad request: ${e?.message || e}` });
        }
        const { fn, args = [], oneway } = body || {};
        try {
          setOriginHint(req.headers.origin || '');
          // 把 claim 记进围栏，并在活动根变化时持久化
          if (fn === 'workspace:claim') claimedRoots.add(args[0]);
          const value = await dispatch.call(fn, args);
          if (oneway) {
            res.writeHead(204).end();
            return;
          }
          return sendJson(res, 200, { ok: true, value: value ?? null });
        } catch (e) {
          // 裸错误文本：渲染端会再剥一次 IPC 前缀
          // 文件读写失败（LaTeX 工程里引用不存在的文件）是常态，不刷日志
          if (!fn.startsWith('fs:') && !fn.startsWith('agent:')) {
            logger.write(`[rpc] ${fn} failed: ${String(e?.message || e)}`);
          }
          return sendJson(res, 200, { ok: false, error: String(e?.message || e) });
        }
      }

      // 4) shim
      if (p === `${BASE}/shim.js`) {
        return serveStatic(res, SHIM_FILE);
      }

      // 5) 首页：注入 bootstrap + shim
      if (p === `${BASE}` || p === `${BASE}/`) {
        if (p === BASE) {
          res.writeHead(302, { location: `${BASE}/` });
          return res.end();
        }
        const activeRoot = await store.getActiveRoot();
        const settings = await store.getSettings();
        // 允许用 ?root= 临时指定论文目录（会写回 activeRoot）
        const qRoot = url.searchParams.get('root');
        let open = activeRoot ? { kind: 'folder', path: activeRoot } : null;
        if (qRoot) {
          open = { kind: 'folder', path: qRoot };
          await store.setActiveRoot(qRoot);
        }
        const html = await readIndex(APP_DIR).catch(() => null);
        if (html === null) {
          return sendJson(res, 500, {
            error: 'app/index.html 缺失：请先构建 Texpile 渲染端到 app/ 目录'
          });
        }
        const out = injectIndex(html, {
          bootstrap: { open, settings },
          base: `${BASE}/`
        });
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store'
        });
        return res.end(out);
      }

      // 6) 其余一律当 app/ 下的静态文件。两张映射：
      //   /typwriter/app/<x>   → APP_DIR/<x>        （index.html 里写死的绝对 URL、themes 的 BASE_URL）
      //   /typwriter/<x>       → APP_DIR/<x>        （spell 词典按 document.baseURI 相对解析）
      let rel = p.slice(BASE.length + 1);
      if (rel.startsWith('app/')) rel = rel.slice(4);
      if (!rel) return sendJson(res, 404, { error: `not found: ${p}` });
      const file = appFilePath(APP_DIR, rel);
      if (!file) return sendJson(res, 403, { error: 'forbidden' });
      // serveStatic 自己会发 404，这里不要重复写响应
      return serveStatic(res, file);
    }

    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'prefix',
          path: BASE,
          handler: async (req, res) => {
            try {
              const rejection = requestRejection(ctx, req);
              if (rejection) {
                sendJson(res, rejection, { error: '未授权' });
                return;
              }
              await handle(req, res);
            } catch (e) {
              if (res.headersSent) {
                res.end();
                return;
              }
              sendJson(res, 500, { error: String(e?.message || e) });
            }
          }
        }),
      'dsh-typwriter: /typwriter routes'
    );

    // 构建产物里的资源路径已全部改基相对（见 reports/build-patches.md），
    // 不再需要在站点根注册 /theme-init.js、/themes、/favicon.svg。

    ctx.effect(() => () => {
      terminals.killAll();
      lsp.stop();
      acp.close();
      previewServer.close();
      watcher.stop();
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      clients.clear();
    }, 'dsh-typwriter: teardown');

    // 启动自检：把缺失的构建产物说清楚，而不是等用户在浏览器里看白屏
    if (!existsSync(join(APP_DIR, 'index.html'))) {
      console.warn(`[typwriter] ${join(APP_DIR, 'index.html')} 不存在，请先构建渲染端`);
    }
    if (!existsSync(SHIM_FILE)) {
      console.warn(`[typwriter] ${SHIM_FILE} 不存在，界面无法拿到 bridge`);
    }
    console.log(`[typwriter] ready: app=${APP_DIR} bin=${BIN_DIR}`);
  }
};
