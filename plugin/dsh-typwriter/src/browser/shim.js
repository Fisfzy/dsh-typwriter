// dsh-typwriter 浏览器 shim：等价于 Texpile 的 electron/src/preload.ts。
// 在 Texpile 应用模块之前加载，把 window.texpileNative / texpileTerminal 等全局补齐，
// 全部调用转发到宿主 /typwriter/api/rpc，单向下发走 /typwriter/api/events 的 SSE。
(function () {
  'use strict';
  if (window.__TYPWRITER_SHIM__) return;
  window.__TYPWRITER_SHIM__ = true;

  var RPC = '/typwriter/api/rpc';

  // ---- 单向 RPC（对应 ipcRenderer.send） ----
  function send(fn, args) {
    try {
      fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ fn: fn, args: args || [], oneway: true })
      }).catch(function () {});
    } catch (e) {
      /* ignore */
    }
  }

  // ---- 请求/响应 RPC（对应 ipcRenderer.invoke） ----
  function invoke(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ fn: fn, args: args })
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (r) {
        if (r && r.ok) return r.value;
        // 裸错误文本：渲染端的 ipc() 会再剥一次 "Error invoking remote method" 前缀
        throw new Error((r && r.error) || 'Unknown error');
      });
  }

  // ---- SSE 总线：一条流扇出成多个 onX ----
  var listeners = Object.create(null);
  var bus = null;
  var connected = false;
  var resolveBusReady = null;
  var busReady = new Promise(function (r) {
    resolveBusReady = r;
  });
  function ensureBus() {
    if (bus || typeof EventSource === 'undefined') return bus;
    bus = new EventSource('/typwriter/api/events', { withCredentials: true });
    bus.addEventListener('open', function () {
      connected = true;
      if (resolveBusReady) resolveBusReady(true);
    });
    bus.addEventListener('error', function () {
      connected = false;
    });
    return bus;
  }
  // 尽早就连：LSP 的 initialize 回包可能在毫秒级返回，晚一步订阅就永远收不到
  ensureBus();
  /** 等到 SSE 真正连上（最多等 3s，超时也放行，避免永久卡住） */
  function busReadyOrTimeout() {
    if (connected) return Promise.resolve(true);
    ensureBus();
    return Promise.race([
      busReady,
      new Promise(function (r) {
        setTimeout(function () {
          r(false);
        }, 3000);
      })
    ]);
  }
  function on(channel, cb) {
    var b = ensureBus();
    if (!b) return function () {};
    var set = listeners[channel];
    if (!set) {
      set = listeners[channel] = new Set();
      b.addEventListener(channel, function (e) {
        var payload;
        try {
          payload = JSON.parse(e.data);
        } catch (err) {
          return;
        }
        set.forEach(function (fn) {
          try {
            fn(payload);
          } catch (err) {
            console.error('[typwriter] listener failed', err);
          }
        });
      });
    }
    set.add(cb);
    return function () {
      set.delete(cb);
    };
  }

  function noopUnsub() {
    return function () {};
  }

  // ================= window.texpileNative =================
  window.texpileNative = {
    // 必须是同步的：Texpile 在首帧之前就读它（openWorkspace.ts 的 bootOpen）
    get bootstrap() {
      return window.__TEXPILE_BOOTSTRAP__ || { open: null, settings: {} };
    },

    // ---- 会话 / 设置 / 窗口 ----
    openFolder: function () {
      // 没有原生目录选择器；由 DSH 侧入口传 ?root= 打开。返回 null 让渲染端不误动。
      return Promise.resolve(null);
    },
    pickFolder: function () {
      return Promise.resolve(null);
    },
    pickFile: function () {
      return Promise.resolve(null);
    },
    getSettings: function () {
      return invoke('settings:get');
    },
    setSettings: function (partial) {
      return invoke('settings:set', partial);
    },
    replaceSettings: function (full) {
      return invoke('settings:replace', full);
    },
    claimWorkspace: function (root, kind) {
      return invoke('workspace:claim', root, kind);
    },
    releaseWorkspace: function () {
      return invoke('workspace:release');
    },
    claimStartupTasks: function () {
      return invoke('session:claimStartupTasks');
    },
    setZoomFactor: function (f) {
      return Promise.resolve(f);
    },
    windowGlassWorks: function () {
      return Promise.resolve(false);
    },
    setWindowGlass: function () {
      return Promise.resolve(false);
    },
    setNativeAppearance: function () {},
    newWindow: function () {
      return Promise.resolve();
    },
    openFolderNewWindow: function () {
      return Promise.resolve(null);
    },
    revealItem: function (path) {
      return invoke('shell:revealItem', path).catch(function () {
        return { ok: false };
      });
    },

    // ---- 文件系统 ----
    fsScan: function (root, exts) {
      return invoke('fs:scan', root, exts);
    },
    fsTree: function (root) {
      return invoke('fs:tree', root);
    },
    fsTreeScan: function (root, exts) {
      return invoke('fs:treeScan', root, exts);
    },
    fsRead: function (path) {
      return invoke('fs:read', path);
    },
    fsWrite: function (path, content) {
      return invoke('fs:write', path, content);
    },
    fsWriteBinary: function (path, bytes) {
      return invoke('fs:writeBinary', path, bytes);
    },
    fsStat: function (path) {
      return invoke('fs:stat', path);
    },
    fsProbe: function (path) {
      return invoke('fs:probe', path);
    },
    fsOp: function (body) {
      return invoke('fs:op', body);
    },
    fsTrash: function (body) {
      return invoke('fs:trash', body);
    },
    fsPurgeUndo: function (root) {
      return invoke('fs:purgeUndo', root);
    },
    fsSearch: function (root, q, regex, caseSensitive) {
      return invoke('fs:search', root, q, regex, caseSensitive);
    },
    fsRealRelative: function (root, rel) {
      return invoke('fs:realRelative', root, rel);
    },
    fsFormatLatex: function (path, text) {
      return invoke('fs:formatLatex', path, text);
    },
    // 没有目录监视器：外部改动不会自动刷新（v1 取舍）
    onWorkspaceFsChanged: noopUnsub,

    // SyncTeX 是 LaTeX 专有；Typst 没有对应数据。
    // 但 Typst 的"点 PDF 跳源码"由 tinymist 预览经 LSP 提供，不走这里。
    // 返回一个明确的错误，避免调用处拿到 "is not a function" 的模糊异常。
    synctex: function () {
      return Promise.resolve({
        ok: false,
        error: 'Typst 没有 SyncTeX 数据；请用右侧「预览」面板点击跳转（tinymist 提供）。'
      });
    }
  };

  // ================= window.texpileTerminal =================
  window.texpileTerminal = {
    available: function () {
      return invoke('terminal:available');
    },
    spawn: function (opts) {
      return invoke('terminal:spawn', opts);
    },
    write: function (id, data) {
      send('terminal:input', [{ id: id, data: data }]);
    },
    resize: function (id, cols, rows) {
      send('terminal:resize', [{ id: id, cols: cols, rows: rows }]);
    },
    kill: function (id) {
      send('terminal:kill', [{ id: id }]);
    },
    interrupt: function (id) {
      return invoke('terminal:interrupt', { id: id });
    },
    onData: function (cb) {
      return on('terminal:data', cb);
    },
    onExit: function (cb) {
      return on('terminal:exit', cb);
    }
  };

  // ================= 其余全局：能省则省，但不留 undefined 引发崩溃 =================
  window.texpileUpdates = {
    check: function () {
      return invoke('update:check');
    },
    installNow: function () {
      return Promise.resolve();
    },
    onStatus: noopUnsub
  };

  // Typst：LSP（补全/诊断/悬停）+ 实时预览（点击跳转来自 tinymist 的预览页）
  window.texpileTypst = {
    resolve: function () {
      return invoke('typst:resolve').catch(function () {
        return null;
      });
    },
    tinymistStatus: function () {
      return invoke('typst:tinymist:status').catch(function () {
        return { installed: false };
      });
    },
    installTinymist: function () {
      return invoke('typst:tinymist:install');
    },
    cancelTinymistInstall: function () {
      send('typst:tinymist:cancel', []);
    },
    removeTinymist: function () {
      return invoke('typst:tinymist:remove');
    },
    onTinymistProgress: noopUnsub,
    onTinymistFinished: noopUnsub,
    onInstallProgress: noopUnsub,

    // ---- LSP：裸 JSON 字符串双向 ----
    // startLsp 先等 SSE 连上再起服务，否则 initialize 的回包会在订阅生效前到达而丢失
    startLsp: function (root) {
      return busReadyOrTimeout().then(function () {
        return invoke('typst:lsp:start', root);
      });
    },
    send: function (json) {
      send('typst:lsp:send', [json]);
    },
    stopLsp: function () {
      send('typst:lsp:stop', []);
    },
    onMessage: function (cb) {
      return on('typst:lsp:message', cb);
    },
    onExit: function (cb) {
      return on('typst:lsp:exit', cb);
    },

    // ---- 实时预览 ----
    // host 形如 "127.0.0.1:23625"；直接返回它自己的页面地址
    preparePreview: function (host, background, foreground, scrollbarThumb, scrollbarRadius, dark) {
      return invoke('typst:preview:prepare', {
        host: host,
        background: background,
        foreground: foreground,
        scrollbarThumb: scrollbarThumb,
        scrollbarRadius: scrollbarRadius,
        dark: dark
      });
    },
    releasePreview: function () {
      send('typst:preview:release', []);
    },
    previewPageHtml: function (host) {
      return invoke('typst:preview:pageHtml', { host: host });
    },
    prepareGuestPreview: function () {
      return Promise.resolve({ ok: false, error: 'unsupported' });
    },
    relayOpen: function () {},
    relaySend: function () {},
    relayClose: function () {},
    onRelayEvent: noopUnsub,

    // ---- 工具链探测（偏好设置用，缺了不影响编辑） ----
    probeToolchain: function () {
      return invoke('toolchain:probe').catch(function () {
        return {};
      });
    },
    onProbeResult: noopUnsub,
    distros: function () {
      return invoke('toolchain:distros').catch(function () {
        return {};
      });
    },
    texBib: function () {
      return Promise.resolve(null);
    },
    packageFiles: function (spec) {
      return invoke('typst:packageFiles', spec).catch(function () {
        return null;
      });
    },
    dirForms: function () {
      return Promise.resolve(null);
    }
  };

  window.texpileSnippets = { list: function () { return Promise.resolve([]); } };
  window.texpileZotero = undefined;
  window.texpileDoi = undefined;
  window.texpileTemplates = undefined;

  // ================= window.texpileAcp：底部 Agent 面板（这里接的是 DSH） =================
  window.texpileAcp = {
    detect: function () {
      return invoke('acp:detect').catch(function () {
        return { dsh: false };
      });
    },
    start: function () {
      return invoke('acp:start');
    },
    prompt: function (blocks) {
      return invoke('acp:prompt', blocks);
    },
    cancel: function () {
      send('acp:cancel', []);
    },
    answer: function (id, optionId) {
      send('acp:answer', [{ id: id, optionId: optionId }]);
    },
    setConfig: function (configId, value) {
      return invoke('acp:config', { configId: configId, value: value });
    },
    chats: function () {
      return invoke('acp:chats').catch(function () {
        return [];
      });
    },
    openChat: function (id) {
      return invoke('acp:openChat', id);
    },
    close: function () {
      send('acp:close', []);
    },
    onEvent: function (cb) {
      return on('acp:event', cb);
    }
  };

  // 润色代理（Refine）：DSH 走 `--profile headless`，prompt 进、文本出
  window.texpileAgent = {
    detect: function () {
      return invoke('agent:detect').catch(function () {
        return {};
      });
    },
    // 预设选择器用：读本机 DSH 的技能 / 插件清单
    listSkills: function () {
      return invoke('agent:listSkills').catch(function () {
        return { ok: false, skills: [] };
      });
    },
    listPlugins: function () {
      return invoke('agent:listPlugins').catch(function () {
        return { ok: false, plugins: [] };
      });
    },
    // 模型 / 思考强度（AGENT 工具栏）
    modelInfo: function () {
      return invoke('agent:modelInfo').catch(function () {
        return { ok: false, models: [], current: { provider: null, model: null, reasoningEffort: null }, efforts: [] };
      });
    },
    setModel: function (sel) {
      return invoke('agent:setModel', sel);
    },
    // MCP 服务器管理（偏好设置 → AI 助手）：改动写 DSH profile patch，重启对话生效
    mcpList: function () {
      return invoke('agent:mcpList').catch(function () {
        return { ok: false, servers: [] };
      });
    },
    mcpSet: function (servers) {
      return invoke('agent:mcpSet', servers);
    },
    mcpTest: function (server) {
      return invoke('agent:mcpTest', server);
    },
    zoteroToken: function () {
      return invoke('agent:zoteroToken').catch(function () {
        return { ok: false, token: null };
      });
    },
    models: function () {
      // 形状必须与 AgentModelList 一致：{ ok: true, models: [...] }
      return Promise.resolve({ ok: true, models: [] });
    },
    run: function (id, prompt, system, agent) {
      return invoke('agent:run', { id: id, prompt: prompt, system: system, agent: agent });
    },
    cancel: function (id) {
      send('agent:cancel', [id]);
    }
  };

  console.log('[typwriter] shim installed; bootstrap =', window.__TEXPILE_BOOTSTRAP__);
})();
