// RPC 派发：把渲染端 `window.texpileNative.*` 的调用映射到宿主实现。
// 通道名与 electron/preload.ts 里的 ipcRenderer.invoke 通道一一对应，
// 所以 shim 可以直接把 fn 名字透传过来。
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import * as fsops from './fsops.js';
import * as agentlist from './agentlist.js';
import * as mcplist from './mcplist.js';
import { AcpHost } from './acp.js';
import { dshHome } from './state.js';
import { preparedPreviewHtml } from './previewPage.js';

/** 需要"真实现"的通道→实现表；其余走桩 */
export function createDispatch({ store, terminals, lsp, acp, appDir, binDir, clearPendingLsp, previewServer, pickDirectory, logger, watcher }) {
  // 选择器列出的是论文助手实际会看到的家目录：与 index.js 里 ACP 的 env() 同一规则
  const agentHome = async () => {
    const s = await store.getSettings();
    if (s.agentInheritHostPlugins === false) return join(dshHome(), 'typwriter-agent');
    return dshHome();
  };

  // ---- 润色（Refine）：起一个临时 ACP 会话，收完文本就关掉 ----
  // 不用 `dsh --profile headless`：那个 profile 会被用户级 cordis.patch.yml 里失败的插件拖垮
  // （实测 "plugin tree failed to load"）。复用已经跑通的 acp 会话最稳，也不污染面板里的对话。
  let refineHost = null;

  async function runRefine({ prompt, system } = {}) {
    if (refineHost) return { ok: false, error: '上一次润色还在进行' };
    const message = system ? `${system}\n\n${prompt ?? ''}` : String(prompt ?? '');
    let text = '';
    const host = new AcpHost(
      (channel, payload) => {
        if (channel !== 'acp:event') return;
        if (payload?.type === 'update' && payload.update?.sessionUpdate === 'agent_message_chunk') {
          const c = payload.update.content;
          if (c?.type === 'text' && typeof c.text === 'string') text += c.text;
        }
      },
      {
        binDir,
        command: 'dsh',
        argsFor: () => ['--profile', 'acp'],
        workspace: () => store.state?.activeRoot || null
      }
    );
    refineHost = host;
    try {
      const st = await host.start();
      if (!st.ok) return { ok: false, error: 'DSH 未能启动（检查 dsh 是否在 PATH）' };
      const r = await host.prompt([{ type: 'text', text: message }]);
      if (!r.ok) return { ok: false, error: r.error || '润色失败' };
      const out = text.trim();
      return out ? { ok: true, text: out } : { ok: false, error: 'DSH 没有返回内容' };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    } finally {
      host.close();
      refineHost = null;
    }
  }

  const handlers = {
    // ---- 设置 / 启动 ----
    'settings:get': () => store.getSettings(),
    'settings:set': (partial) => store.setSettings(partial),
    'settings:replace': (full) => store.save({ settings: full || {} }).then(() => undefined),
    'window:bootstrap': async () => ({
      open: (await store.getActiveRoot()) ? { kind: 'folder', path: await store.getActiveRoot() } : null,
      settings: await store.getSettings()
    }),
    'session:claimStartupTasks': () => true,

    // ---- 对话框 ----
    // 目录选择走 DSH 平台的 directoryPicker 服务（desktop 是原生 IFileOpenDialog，
    // remote 场景是 browse 后端）。以前这里直接返回 null，界面上的「打开文件夹」
    // 就永远打不开别的目录——实机安装的第一个故障。
    'dialog:openFolder': async () => {
      try {
        const picked = (await pickDirectory?.()) ?? null;
        logger?.write?.(`[dialog] openFolder -> ${picked ?? 'null'}`);
        return picked;
      } catch (e) {
        logger?.write?.(`[dialog] openFolder failed: ${e?.message || e}`);
        console.error('[typwriter] open folder dialog failed:', e?.message || e);
        return null;
      }
    },
    'dialog:pickFolder': async () => {
      try {
        return (await pickDirectory?.()) ?? null;
      } catch (e) {
        console.error('[typwriter] pick folder dialog failed:', e?.message || e);
        return null;
      }
    },
    // 平台只提供目录选择器，没有「选单个文件」的能力；返回 null 让渲染端静默跳过
    'dialog:pickFile': () => null,
    'dialog:messageBox': () => null,
    'menu:popup': () => null,

    // ---- 工作区 ----
    // claim 是"这个目录现在归我"：落盘 + 起文件监视（外部改动靠它通知渲染端）
    'workspace:claim': async (root) => {
      if (typeof root === 'string' && root.trim()) {
        await store.setActiveRoot(root);
        watcher?.setRoot(root);
      }
      return { ok: true };
    },
    // 关闭工作区：清掉落盘的 activeRoot 并停止监视，下次打开回到开始页
    'workspace:release': async () => {
      watcher?.stop();
      await store.setActiveRoot(null);
      return { ok: true };
    },
    'shell:revealItem': async (path) => {
      const target = String(path || '');
      if (!target) return { ok: false, error: 'missing path' };
      try {
        if (process.platform === 'win32') {
          // /select, 与路径必须是两个 argv 元素；detached 避免拖住宿主
          spawn('explorer.exe', ['/select,', target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        } else if (process.platform === 'darwin') {
          spawn('open', ['-R', target], { detached: true, stdio: 'ignore' }).unref();
        } else {
          spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    },

    // ---- 文件系统 ----
    'fs:scan': (root, exts) => fsops.fsScan(root, exts),
    'fs:tree': (root) => fsops.fsTree(root),
    'fs:treeScan': (root, exts) => fsops.fsTreeScan(root, exts),
    'fs:read': (path) => fsops.fsRead(path),
    'fs:write': (path, content) => fsops.fsWrite(path, content),
    'fs:writeBinary': (path, bytes) => fsops.fsWriteBinary(path, bytes),
    'fs:stat': (path) => fsops.fsStat(path),
    'fs:probe': (path) => fsops.fsProbe(path),
    'fs:op': (body) => fsops.fsOp(body),
    'fs:trash': (body) => fsops.fsTrash(body),
    'fs:purgeUndo': () => fsops.fsPurgeUndo(),
    'fs:search': (root, q, regex, caseSensitive) => fsops.fsSearch(root, q, regex, caseSensitive),
    'fs:realRelative': (root, rel) => fsops.fsRealRelative(root, rel),
    'fs:formatLatex': (path, text) => fsops.fsFormatLatex(path, text),

    // ---- 终端（= 编译通道） ----
    'terminal:available': () => terminals.available(),
    'terminal:spawn': (opts) => terminals.spawn(opts),
    'terminal:input': (opts) => { terminals.input(opts); return { ok: true }; },
    'terminal:resize': (opts) => { terminals.resize(opts); return { ok: true }; },
    'terminal:interrupt': (opts) => terminals.interrupt(opts),
    'terminal:kill': (opts) => { terminals.kill(opts); return { ok: true }; },

    // ---- Typst 工具链 ----
    // 形状必须与 Texpile 的 TinymistInfo 完全一致：{command, version, typstVersion, source}。
    // 少 version 时 Preferences 会把内置 tinymist 判成「无法运行」，typstVersion/source
    // 缺了则详情行显示 "null (Typst undefined, ...)"——这也是"连不上 tinymist"观感的一部分。
    'typst:resolve': () => tinymistInfo(binDir),
    'typst:tinymist:status': () => {
      const info = tinymistInfo(binDir);
      return {
        // pinned 只是 UI 文案；内置的就是当前这份
        pinned: info?.version ?? '0.15.12',
        // 内置二进制随插件发布，没有"下载安装"这一步 → 不提供安装/卸载行
        supported: false,
        installed: info ? { command: info.command, version: info.version, typstVersion: info.typstVersion } : null,
        step: null
      };
    },
    'typst:tinymist:install': () => ({
      ok: false,
      reason: 'unsupported',
      detail: '内置 tinymist 随 Typwriter 插件提供，无需也无法在这里单独安装。重装插件即可恢复。'
    }),
    'typst:tinymist:remove': () => ({
      ok: false,
      reason: 'unsupported',
      detail: '内置 tinymist 随 Typwriter 插件提供，不能单独移除。'
    }),
    // 单向下发通道，没有下载任务可取消；给个处理器避免"未实现的通道"
    'typst:tinymist:cancel': () => null,
    'typst:packageFiles': () => null,

    // ---- 工具链探测（Preferences › Toolchain 的数据源） ----
    // 返回类型必须对齐 Texpile：probeToolchain → ToolProbe[]，distros → ToolDistro[]，
    // dirForms → 单个对象。以前这些通道返回 null，toolchainProbe.run() 会把 probes 置成
    // null，Preferences 一渲染就 TypeError——观感上就是"工具链/ tinymist 连不上"。
    'toolchain:probe': () => probeTools(binDir),
    'toolchain:distros': () => [],
    'toolchain:dirForms': (entry) => dirForms(entry),

    // ---- tinymist LSP：补全/诊断/悬停，以及预览（点击跳转靠它） ----
    'typst:lsp:start': (root) => {
      if (typeof clearPendingLsp === 'function') clearPendingLsp();
      return lsp.start(root);
    },
    'typst:lsp:send': (json) => { lsp.send(json); return null; },
    'typst:lsp:stop': () => { lsp.stop(); return null; },

	// ---- Typst 实时预览 ----
	// 预览页从本机 loopback http 原点提供（previewServer.js）。原因只有一个：tinymist 的
	// 数据面会校验 WebSocket 握手的 Origin，且只接受它自己、vscode-webview:// 与
	// http://127.0.0.1 / http://localhost 上的页面。DSH 桌面端的页面原点是 dsh-app://app，
	// 同源提供会被 tinymist 直接断开（1006）→ 界面报「预览页面无法连接到 tinymist」。
	'typst:preview:prepare': async (opts = {}) => {
		const host = opts && typeof opts.host === 'string' ? opts.host : null;
		if (!host) return { ok: false, error: 'missing preview host' };
		if (!/^127\.0\.0\.1:\d+$/.test(host)) return { ok: false, error: 'refusing a non-loopback preview host' };
		try {
			const html = await preparedPreviewHtml({
				host,
				background: String(opts.background ?? '#ffffff'),
				foreground: String(opts.foreground ?? '#000000'),
				scrollbarThumb: String(opts.scrollbarThumb ?? '#888888'),
				scrollbarRadius: opts.scrollbarRadius ?? 6,
				dark: opts.dark === true || opts.dark === '1' || opts.dark === 'true'
			});
			if (!previewServer) {
				// 没有 loopback 服务时的退路：老的同源地址（只在 http 原点的宿主里可用）
				const q = new URLSearchParams({
					host,
					bg: String(opts.background ?? '#ffffff'),
					fg: String(opts.foreground ?? '#000000'),
					thumb: String(opts.scrollbarThumb ?? '#888888'),
					radius: String(opts.scrollbarRadius ?? 6),
					dark: opts.dark ? '1' : '0'
				});
				return { ok: true, url: `/typwriter/preview-page?${q.toString()}`, sameOrigin: true };
			}
			const url = await previewServer.serve(html);
			logger?.write?.(`[preview] prepared ${host} -> ${url}`);
			return { ok: true, url };
		} catch (e) {
			logger?.write?.(`[preview] prepare failed host=${host}: ${String(e?.message || e)}`);
			return { ok: false, error: String(e?.message || e) };
		}
	},
    'typst:preview:release': () => null,
    'typst:preview:pageHtml': () => ({ ok: false, error: 'unsupported' }),
    'typst:preview:prepareGuest': () => ({ ok: false, error: 'unsupported' }),
    'typst:relay:open': () => null,
    'typst:relay:send': () => null,
    'typst:relay:close': () => null,

    // ---- ACP：底部 Agent 面板（这里接的是 DSH） ----
    'acp:detect': () => acp.detect(),
    'acp:start': () => acp.start(),
    // 预热：dsh --profile acp 冷启动实测 9-16s（node_modules 冷读 + Defender 扫描 + 插件装载），
    // 用户打开 Typwriter 时就把它拉起待命，之后点开 AGENT 面板即秒进。start() 幂等：
    // 已活复用、并发复用，面板真开时不会二次起动
    'acp:prewarm': async () => {
      const root = store.state?.activeRoot;
      if (!root) return { ok: false, reason: 'no-folder' };
      try {
        const st = await acp.start();
        return st?.ok ? { ok: true } : st;
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    },
    'acp:prompt': (blocks) => acp.prompt(blocks),
    'acp:cancel': () => { acp.cancel(); return null; },
    'acp:answer': (body) => { acp.answer(body?.id, body?.optionId ?? null); return null; },
    'acp:config': (body) => acp.setConfig(body?.configId, body?.value),
    'acp:chats': () => acp.chats(),
    'acp:openChat': (id) => acp.openChat(id),
    'acp:close': () => { acp.close(); return null; },
    // 润色用的命令行 agent：DSH 走 `--profile headless`（一句话任务、文本输出）
    'agent:detect': () => ({ claude: false, codex: false, agy: false, dsh: true }),
    // 预设选择器的数据源：读本机 DSH 的技能 / 插件
    'agent:listSkills': async () => ({ ok: true, skills: await agentlist.listSkills(await agentHome()) }),
    'agent:listPlugins': async () => ({ ok: true, plugins: await agentlist.listPlugins(await agentHome()) }),
    // AGENT 工具栏的模型 / 思考强度（写 <home>/settings.json，新 agent 生效）
    'agent:modelInfo': async () => ({ ok: true, ...(await agentlist.modelInfo(await agentHome())) }),
    'agent:setModel': async (sel) => ({ ok: true, ...(await agentlist.setModel(await agentHome(), sel || {})) }),
    // MCP 服务器管理（配置存插件设置，生成 DSH profile patch；改动重启对话生效）
    'agent:mcpList': async () => {
      const s = await store.getSettings();
      return { ok: true, servers: await mcplist.mcpList(s) };
    },
    'agent:mcpSet': async (servers) => {
      const r = await mcplist.mcpSet(servers || [], dshHome);
      // 配置的源头是插件设置：patch 是派生物，两边一起落
      await store.setSettings({ mcpServers: r.servers });
      return { ok: true, servers: r.servers };
    },
    'agent:mcpTest': async (server) => mcplist.mcpTest(server || {}),
    'agent:zoteroToken': async () => ({ ok: true, token: await mcplist.zoteroMcpToken() }),
    'agent:run': (body) => runRefine(body || {}),
    'agent:cancel': () => {
      if (refineHost) {
        refineHost.close();
        refineHost = null;
      }
      return null;
    },

    // ---- Git：明确不支持，让面板降级而不是报错 ----
    'git:status': () => ({ ok: false, reason: 'not-a-repo' }),
    'git:show': () => ({ ok: false, error: 'unsupported' }),
    'git:identity': () => ({ ok: true, name: null, email: null }),

    // ---- 更新：不支持 ----
    'update:check': () => ({ status: 'unsupported' })
  };

  // 无害桩：只要返回 ok / null，渲染端就会静默跳过
  const SILENT = new Set([
    'window:appearance', 'window:close', 'window:close-decision', 'window:cursorScreenPoint',
    'window:glassWorks', 'window:isMaximized', 'window:menu-state', 'window:minimize',
    'window:new', 'window:openFolderNew', 'window:overlay', 'window:reload-workspace',
    'window:setGlass', 'window:setZoom', 'window:toggle-devtools', 'window:toggleMaximize',
    'startup:mainStats', 'toolchain:texBib', 'mcp:status', 'mcp:setEnabled', 'mcp:publishState',
    'acp:detect', 'zotero:probe', 'doi:search', 'templates:universeIndex'
  ]);

  async function call(fn, args) {
    if (typeof fn !== 'string') throw new Error('missing fn');
    if (process.env.TYPWRITER_TRACE) {
      console.log(`[rpc] ${fn} ${JSON.stringify(args || []).slice(0, 140)}`);
    }
    const h = handlers[fn];
    if (h) return await h(...args);
    if (SILENT.has(fn)) return null;
    throw new Error(`typwriter: 未实现的通道 ${fn}`);
  }

  return { call, handlers, SILENT };
}

/** 在插件 bin 目录里找 tinymist（内置那份） */
function resolveTinymist(binDir) {
  const exe = process.platform === 'win32' ? 'tinymist.exe' : 'tinymist';
  const full = join(binDir, exe);
  return existsSync(full) ? full : null;
}

/** tinymist --version 只跑一次：结果缓存在模块里，`source` 是 Texpile 的 TinymistInfo 契约字段 */
let tinymistCache;
function tinymistInfo(binDir) {
  if (tinymistCache !== undefined) return tinymistCache;
  const command = resolveTinymist(binDir);
  if (!command) {
    tinymistCache = null;
    return null;
  }
  let out = '';
  try {
    out = execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  } catch {
    /* 版本读不出来也照样能用；下面给 unknown 占位，至少形状是对的 */
  }
  const version =
    /Build Git Describe:\s*v?([0-9][^\s]*)/i.exec(out)?.[1] ??
    /^\s*tinymist\s+v?([0-9][^\s]*)/im.exec(out)?.[1] ??
    null;
  const typstVersion = /Typst Version:\s*v?([0-9][^\s]*)/i.exec(out)?.[1] ?? null;
  tinymistCache = {
    command,
    version: version ?? 'unknown',
    typstVersion: typstVersion ?? 'unknown',
    // 这份 tinymist 是插件自带的（bundled），在 Texpile 的词汇里属于 managed
    source: 'managed'
  };
  return tinymistCache;
}

/** PATH 目录 + 插件 bin 目录，按"先插件 bin 后 PATH"的优先级排列 */
function searchDirs(binDir) {
  const out = [];
  if (binDir && existsSync(binDir)) out.push(binDir);
  for (const dir of String(process.env.PATH || process.env.Path || '').split(delimiter)) {
    if (dir) out.push(dir);
  }
  return out;
}

/** 在 PATH 附近找一个可执行文件，返回绝对路径（找不到 null） */
function whichProgram(name, binDir) {
  const exts = process.platform === 'win32' ? [`.exe`, `.cmd`, `.bat`, ''] : [''];
  for (const dir of searchDirs(binDir)) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        /* 无权限目录直接跳过 */
      }
    }
  }
  return null;
}

/** Preferences 里逐行显示的探测结果；tinymist 单独走 typst:resolve，这里不重复 */
const PROBE_TOOLS = ['latexmk', 'pdflatex', 'lualatex', 'xelatex', 'biber', 'bibtex', 'latexindent', 'synctex', 'git'];

function probeTools(binDir) {
  return PROBE_TOOLS.map((id) => {
    const command = whichProgram(id, binDir);
    return command
      ? { id, found: true, command, detail: command }
      : { id, found: false, command: id };
  });
}

/** toolchain:dirForms —— Texpile 用它把设置里的目录写法补成绝对/真实路径 */
function dirForms(entry) {
  const text = String(entry ?? '').trim();
  const absolute = text ? resolve(text) : '';
  let real = absolute;
  try {
    real = realpathSync(absolute);
  } catch {
    /* 目录不存在：real 与 absolute 相同即可 */
  }
  return {
    absolute,
    // 网页宿主没有"便携版应用"概念，永远返回绝对路径写法
    relative: null,
    exists: !!absolute && existsSync(absolute),
    real
  };
}
