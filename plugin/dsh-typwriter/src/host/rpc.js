// RPC 派发：把渲染端 `window.texpileNative.*` 的调用映射到宿主实现。
// 通道名与 electron/preload.ts 里的 ipcRenderer.invoke 通道一一对应，
// 所以 shim 可以直接把 fn 名字透传过来。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as fsops from './fsops.js';
import * as agentlist from './agentlist.js';
import * as mcplist from './mcplist.js';
import { AcpHost } from './acp.js';
import { dshHome } from './state.js';

/** 需要"真实现"的通道→实现表；其余走桩 */
export function createDispatch({ store, terminals, lsp, acp, appDir, binDir, clearPendingLsp }) {
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

    // ---- 对话框：没有原生选择器，统一返回 null（渲染端会走自绘/静默） ----
    'dialog:openFolder': () => null,
    'dialog:pickFolder': () => null,
    'dialog:pickFile': () => null,
    'dialog:messageBox': () => null,
    'menu:popup': () => null,

    // ---- 工作区 ----
    'workspace:claim': () => ({ ok: true }),
    'workspace:release': () => ({ ok: true }),
    'shell:revealItem': () => ({ ok: false, error: 'reveal 不在网页宿主里实现' }),

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
    'typst:resolve': () => resolveTinymist(binDir),
    'typst:tinymist:status': () => {
      const found = resolveTinymist(binDir);
      return found ? { installed: true, path: found.command, version: found.version } : { installed: false };
    },
    'typst:tinymist:install': () => ({
      ok: false,
      error: '请手动把 tinymist.exe 放到插件 bin 目录；内置安装已禁用'
    }),
    'typst:packageFiles': () => ({ files: [] }),

    // ---- tinymist LSP：补全/诊断/悬停，以及预览（点击跳转靠它） ----
    'typst:lsp:start': (root) => {
      if (typeof clearPendingLsp === 'function') clearPendingLsp();
      return lsp.start(root);
    },
    'typst:lsp:send': (json) => { lsp.send(json); return null; },
    'typst:lsp:stop': () => { lsp.stop(); return null; },

    // ---- Typst 实时预览 ----
    // 不重写 tinymist 的预览页：直接把 iframe 指向它自己的 loopback 服务。
    // tinymist 的 data plane 只校验 loopback http 来源，我们的页面正好是。
    // 这样 "点 PDF 跳源码 / 光标跟随" 由 tinymist 原生提供，不用移植字符串补丁。
    'typst:preview:prepare': (opts = {}) => {
      const host = opts && typeof opts.host === 'string' ? opts.host : null;
      if (!host) return { ok: false, error: 'missing preview host' };
      return { ok: true, url: `http://${host}/` };
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
    'startup:mainStats', 'toolchain:dirForms', 'toolchain:distros', 'toolchain:probe',
    'toolchain:texBib', 'mcp:status', 'mcp:setEnabled', 'mcp:publishState',
    'agent:detect', 'acp:detect', 'zotero:probe', 'doi:search', 'templates:universeIndex'
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

/** 在插件 bin 目录里找 tinymist */
function resolveTinymist(binDir) {
  const exe = process.platform === 'win32' ? 'tinymist.exe' : 'tinymist';
  const candidates = [join(binDir, exe)];
  for (const c of candidates) {
    if (existsSync(c)) return { command: c, version: null, managed: true };
  }
  return null;
}
