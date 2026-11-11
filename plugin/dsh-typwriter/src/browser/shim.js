// dsh-typwriter 浏览器 shim：等价于 Texpile 的 electron/src/preload.ts。
// 在 Texpile 应用模块之前加载，把 window.texpileNative / texpileTerminal 等全局补齐，
// 全部调用转发到宿主 /typwriter/api/rpc，单向下发走 /typwriter/api/events 的 SSE。
(function () {
  'use strict';
  if (window.__TYPWRITER_SHIM__) return;
  window.__TYPWRITER_SHIM__ = true;

  var RPC = '/typwriter/api/rpc';

  // 诊断上报：把页面里的关键失败/阶段写到宿主日志（桌面端没有 DevTools，
  // 这是唯一能看到 app 侧到底卡在哪一步的通道）。
  function dbg(text) {
    try {
      send('debug:log', [String(text)]);
    } catch (e) {
      /* ignore */
    }
  }

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
  // 宿主在面板切换等瞬间可能把请求挂住（实测 iframe 重建时 settings:get 永久 pending，
  // 应用卡在启动屏）：每次调用带超时，超时重试一次，两次都失败才报错。
  function fetchOnce(fn, args, signal) {
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ fn: fn, args: args }),
      signal: signal
    }).then(function (res) {
      return res.json();
    });
  }
  function invoke(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    var attempt = function (n) {
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
      var p = fetchOnce(fn, args, ctrl ? ctrl.signal : undefined);
      if (timer) p = p.finally(function () { clearTimeout(timer); });
      return p.catch(function (e) {
        if (n > 0 && (e && (e.name === 'AbortError' || String(e).indexOf('Failed to fetch') >= 0))) {
          return attempt(n - 1);
        }
        throw e;
      });
    };
    return attempt(1).then(function (r) {
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

  // ================= 目录选择 =================
  // DSH 的目录选择器有两个后端（ctx.directoryPicker 的能力区分）：
  //   native —— /api/directoryPicker/pick：在宿主桌面上弹系统对话框
  //   browse —— /api/directoryPicker/list + createDirectory：应用内浏览器
  //
  // 关键：桌面 profile 里装了 dsh-mobile / dsh-remote，connection 因此允许远程来源，
  // directory-picker-auto 判定"可能有远程客户端"，会挂 browse 后端而不是 native。
  // 之前只接 native（宿主 dialog:openFolder 在 browse 组合里只能返回 null），
  // 所以"打开文件夹"仍然没有任何反应。这里自己实现应用内浏览器，两种后端都能用。
  var pickSeq = 0;
  var pickActive = null;

  /** 调 DSH 平台 API：POST /api/<namespace>/<method>，client-request 信封 */
  function platformCall(method, args) {
    var rpcId = 'tw-pick-' + ++pickSeq;
    return fetch('/api/' + method, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: rpcId,
        method: method,
        payload: { args: args || {} }
      })
    }).then(function (res) {
      return res.json();
    }).then(function (env) {
      var r = env && env.result;
      if (r && r.ok) return r.value;
      var err = new Error((r && r.error && r.error.message) || ('gateway error: ' + method));
      err.api = true;
      err.code = r && r.error && r.error.code;
      err.details = r && r.error && r.error.details;
      throw err;
    });
  }

  function pickEl(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  var PICK_STYLE = [
    '.twpick-backdrop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;',
    'background:rgba(8,10,14,.45);font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:CanvasText}',
    '.twpick-panel{display:flex;flex-direction:column;width:min(720px,calc(100vw - 40px));max-height:min(78vh,760px);',
    'background:Canvas;border:1px solid ButtonBorder;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.38);overflow:hidden}',
    '.twpick-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid ButtonBorder}',
    '.twpick-title{flex:1;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.twpick-x{border:0;background:transparent;color:CanvasText;font:inherit;font-size:15px;line-height:1;padding:4px 6px;border-radius:6px;cursor:pointer;opacity:.7}',
    '.twpick-x:hover{opacity:1;background:color-mix(in srgb,CanvasText 10%,transparent)}',
    '.twpick-bar{display:flex;gap:8px;padding:10px 14px;border-bottom:1px solid ButtonBorder}',
    '.twpick-input{flex:1;min-width:0;font:inherit;padding:6px 10px;border:1px solid ButtonBorder;border-radius:7px;background:Field;color:FieldText;outline:none}',
    '.twpick-input:focus{border-color:Highlight}',
    '.twpick-btn{font:inherit;padding:6px 12px;border:1px solid ButtonBorder;border-radius:7px;background:ButtonFace;color:ButtonText;cursor:pointer;white-space:nowrap}',
    '.twpick-btn:hover:not(:disabled){filter:brightness(.96)}',
    '.twpick-btn.primary{background:Highlight;border-color:Highlight;color:HighlightText;font-weight:600}',
    '.twpick-btn:disabled{opacity:.5;cursor:default}',
    '.twpick-crumbs{display:flex;flex-wrap:wrap;gap:2px;padding:8px 14px 0}',
    '.twpick-crumb{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;border-radius:5px;',
    'background:transparent;color:LinkText;font:inherit;font-size:12px;padding:2px 5px;cursor:pointer}',
    '.twpick-crumb:hover{background:color-mix(in srgb,CanvasText 9%,transparent)}',
    '.twpick-list{flex:1;min-height:150px;overflow:auto;padding:8px 10px 12px}',
    '.twpick-row{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;border-radius:7px;',
    'background:transparent;color:CanvasText;font:inherit;text-align:left;cursor:pointer}',
    '.twpick-row:hover{background:color-mix(in srgb,CanvasText 9%,transparent)}',
    '.twpick-row .n{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.twpick-row.hidden{opacity:.55}',
    '.twpick-empty,.twpick-loading{padding:20px 10px;color:GrayText;text-align:center}',
    '.twpick-foot{display:flex;align-items:center;gap:8px;padding:12px 14px;border-top:1px solid ButtonBorder}',
    '.twpick-msg{flex:1;min-width:0;font-size:12px;color:GrayText;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  ].join('');

  function ensurePickStyle() {
    if (document.getElementById('tw-pick-style')) return;
    var style = document.createElement('style');
    style.id = 'tw-pick-style';
    style.textContent = PICK_STYLE;
    (document.head || document.documentElement).appendChild(style);
  }

  /**
   * 应用内目录浏览器。解析为选中的绝对路径，取消为 null。
   * @param {string} title
   * @param {{path:string,home?:string,crumbs?:Array,entries?:Array,truncated?:boolean}} initial
   */
  function openBrowsePicker(title, initial) {
    if (pickActive) return pickActive.promise;
    ensurePickStyle();

    var resolveFn;
    var promise = new Promise(function (resolve) {
      resolveFn = resolve;
    });

    var marked = document.activeElement;
    var state = { path: '', crumbs: [], entries: [], home: '' };
    var loading = false;

    var overlay = pickEl('div', 'twpick-backdrop');
    var panel = pickEl('div', 'twpick-panel');
    overlay.appendChild(panel);

    var head = pickEl('div', 'twpick-head');
    head.appendChild(pickEl('span', 'twpick-title', title || '选择文件夹'));
    var closeX = pickEl('button', 'twpick-x', '✕');
    closeX.type = 'button';
    closeX.title = '取消';
    head.appendChild(closeX);
    panel.appendChild(head);

    var bar = pickEl('div', 'twpick-bar');
    var upBtn = pickEl('button', 'twpick-btn', '↑ 上一级');
    upBtn.type = 'button';
    var pathInput = pickEl('input', 'twpick-input');
    pathInput.type = 'text';
    pathInput.spellcheck = false;
    pathInput.placeholder = '输入绝对路径，回车跳转';
    var goBtn = pickEl('button', 'twpick-btn', '转到');
    goBtn.type = 'button';
    bar.appendChild(upBtn);
    bar.appendChild(pathInput);
    bar.appendChild(goBtn);
    panel.appendChild(bar);

    var crumbs = pickEl('div', 'twpick-crumbs');
    panel.appendChild(crumbs);

    var list = pickEl('div', 'twpick-list');
    panel.appendChild(list);

    var foot = pickEl('div', 'twpick-foot');
    var msg = pickEl('span', 'twpick-msg', '');
    var cancelBtn = pickEl('button', 'twpick-btn', '取消');
    cancelBtn.type = 'button';
    var okBtn = pickEl('button', 'twpick-btn primary', '选择此文件夹');
    okBtn.type = 'button';
    foot.appendChild(msg);
    foot.appendChild(cancelBtn);
    foot.appendChild(okBtn);
    panel.appendChild(foot);

    function finish(value) {
      if (!pickActive) return;
      pickActive = null;
      document.removeEventListener('keydown', onKey, true);
      try {
        overlay.remove();
      } catch (e) {
        /* ignore */
      }
      if (marked && typeof marked.focus === 'function') {
        try {
          marked.focus();
        } catch (e) {
          /* ignore */
        }
      }
      resolveFn(value);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    }

    function setMsg(text) {
      msg.textContent = text || '';
    }

    function renderCrumbs() {
      crumbs.textContent = '';
      var rows = Array.isArray(state.crumbs) ? state.crumbs : [];
      for (var i = 0; i < rows.length; i++) {
        (function (row) {
          var b = pickEl('button', 'twpick-crumb', row.name || row.path);
          b.type = 'button';
          b.title = row.path;
          b.addEventListener('click', function () {
            go(row.path);
          });
          crumbs.appendChild(b);
        })(rows[i]);
      }
    }

    function renderEntries() {
      list.textContent = '';
      var entries = Array.isArray(state.entries) ? state.entries : [];
      if (!entries.length && !loading) {
        list.appendChild(pickEl('div', 'twpick-empty', '（这个目录下没有子文件夹）'));
        return;
      }
      for (var i = 0; i < entries.length; i++) {
        (function (entry) {
          var row = pickEl('button', 'twpick-row' + (entry.hidden ? ' hidden' : ''));
          row.type = 'button';
          row.title = entry.path;
          row.appendChild(document.createTextNode('📁'));
          row.appendChild(pickEl('span', 'n', entry.name));
          row.addEventListener('click', function () {
            go(entry.path);
          });
          list.appendChild(row);
        })(entries[i]);
      }
    }

    function showLoading() {
      loading = true;
      list.textContent = '';
      list.appendChild(pickEl('div', 'twpick-loading', '载入中…'));
    }

    function go(path) {
      var target = String(path == null ? '' : path).trim();
      showLoading();
      setMsg('');
      platformCall('directoryPicker/list', target ? { path: target } : {}).then(
        function (listing) {
          loading = false;
          state = {
            path: listing.path || target,
            home: listing.home || state.home,
            crumbs: listing.crumbs || [],
            entries: listing.entries || []
          };
          pathInput.value = state.path;
          renderCrumbs();
          renderEntries();
          if (listing.truncated) setMsg('目录项过多，列表已截断');
        },
        function (err) {
          loading = false;
          pathInput.value = state.path || target;
          renderCrumbs();
          renderEntries();
          setMsg((err && err.message) || '无法读取该目录');
        }
      );
    }

    function goUp() {
      var rows = state.crumbs || [];
      if (rows.length >= 2) return go(rows[rows.length - 2].path);
      var p = String(state.path || '');
      var cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      if (cut > 0) return go(p.slice(0, cut));
      setMsg('已经在顶层目录');
    }

    upBtn.addEventListener('click', goUp);
    goBtn.addEventListener('click', function () {
      go(pathInput.value);
    });
    pathInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        go(pathInput.value);
      }
    });
    okBtn.addEventListener('click', function () {
      if (state.path) finish(state.path);
    });
    cancelBtn.addEventListener('click', function () {
      finish(null);
    });
    closeX.addEventListener('click', function () {
      finish(null);
    });
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) finish(null);
    });
    document.addEventListener('keydown', onKey, true);

    pickActive = { promise: promise, finish: finish };
    document.body.appendChild(overlay);

    if (initial && initial.path) {
      state = {
        path: initial.path,
        home: initial.home || '',
        crumbs: initial.crumbs || [],
        entries: initial.entries || []
      };
      pathInput.value = state.path;
      renderCrumbs();
      renderEntries();
    }
    setTimeout(function () {
      pathInput.focus();
      if (typeof pathInput.select === 'function') pathInput.select();
    }, 0);

    return promise;
  }

  /** 宿主兜底：native 后端时宿主 dialog:openFolder 会弹系统对话框 */
  function hostOpenFolder() {
    return invoke('dialog:openFolder').catch(function () {
      return null;
    });
  }

  /**
   * 选目录：优先系统对话框（native 后端），组合里只有 browse 时用应用内浏览器。
   * 解析为绝对路径；取消/不可用为 null。
   */
  function chooseDirectory(title) {
    var label = typeof title === 'string' && title.trim() ? title.trim() : '选择论文文件夹';
    return platformCall('directoryPicker/pick', {}).then(
      function (picked) {
        // native 后端：系统对话框的结果就是终局；null 表示用户取消，不再弹第二个选择器
        return typeof picked === 'string' && picked ? picked : null;
      },
      function (err) {
        // 组合里是 browse 后端：pick 以 directory-picker/unavailable 拒绝
        if (err && err.code === 'directory-picker/unavailable') return browseThenPick(label);
        // 平台 API 有回答但 pick 走不通：再试 browse，仍不行才退回宿主
        if (err && err.api) return browseThenPick(label);
        // 没有平台 API（旧宿主/独立运行）：退回宿主自己的对话框
        return hostOpenFolder();
      }
    );
  }

  /** browse 组合：先取一次根目录列表再开浏览器；列表也失败时给空壳让用户输路径 */
  function browseThenPick(label) {
    return platformCall('directoryPicker/list', {}).then(
      function (listing) {
        return openBrowsePicker(label, listing);
      },
      function (err) {
        if (err && err.api) {
          return openBrowsePicker(label, { path: '', home: '', crumbs: [], entries: [] });
        }
        return hostOpenFolder();
      }
    );
  }

  // ================= window.texpileNative =================
  window.texpileNative = {
    // 必须是同步的：Texpile 在首帧之前就读它（openWorkspace.ts 的 bootOpen）
    get bootstrap() {
      return window.__TEXPILE_BOOTSTRAP__ || { open: null, settings: {} };
    },

    // ---- 会话 / 设置 / 窗口 ----
    openFolder: function () {
      // 开始页/文件菜单的"打开文件夹"：browse 组合走应用内浏览器，native 组合走系统对话框。
      return chooseDirectory('选择论文文件夹');
    },
    pickFolder: function (title) {
      return chooseDirectory(title || '选择文件夹');
    },
    pickFile: function (title) {
      return invoke('dialog:pickFile', title).catch(function () {
        return null;
      });
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
    // 目录监视：外部改动（DSH Agent / 其他编辑器写文件）由宿主的 fs.watch 合并后下发
    onWorkspaceFsChanged: function (cb) {
      return on('workspace:fs-changed', function (changes) {
        if (typeof cb === 'function') cb(Array.isArray(changes) ? changes : []);
      });
    },

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
        return { pinned: '', supported: false, installed: null, step: null };
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
        origin: window.location.origin,
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
      return invoke('toolchain:probe').then(function (v) {
        // 契约是数组；宿主异常时也返回数组，否则 Preferences 的 each 会炸
        return Array.isArray(v) ? v : [];
      });
    },
    onProbeResult: noopUnsub,
    distros: function () {
      return invoke('toolchain:distros').then(function (v) {
        return Array.isArray(v) ? v : [];
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
    dirForms: function (entry) {
      return invoke('toolchain:dirForms', entry).catch(function () {
        // 宿主没有这个通道时，至少给出能渲染的形状
        return { absolute: String(entry || ''), relative: null, exists: false, real: String(entry || '') };
      });
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
    // 后台预拉起 dsh（面板没开也拉），打开面板时免 9-16s 冷启动
    prewarm: function () {
      return invoke('acp:prewarm').catch(function () {
        return { ok: false };
      });
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

  // app 侧的 console.error / 未处理 rejection 也转到宿主日志：AGENT 桥失败只在这里露头
  try {
    var __ce = console.error.bind(console);
    var __cw = console.warn.bind(console);
    console.error = function () {
      try {
        dbg('console.error ' + Array.prototype.map.call(arguments, function (a) { return String((a && a.stack) || (a && a.message) || a); }).join(' ').slice(0, 1500));
      } catch (e) {}
      return __ce.apply(null, arguments);
    };
    console.warn = function () {
      try {
        dbg('console.warn ' + Array.prototype.map.call(arguments, function (a) { return String((a && a.message) || a); }).join(' ').slice(0, 800));
      } catch (e) {}
      return __cw.apply(null, arguments);
    };
    window.addEventListener('unhandledrejection', function (e) {
      try { dbg('unhandledrejection ' + String((e && e.reason && e.reason.message) || (e && e.reason) || '?')); } catch (err) {}
    });
  } catch (e) {
    /* ignore */
  }

  // ================= window.texpileSession：DSH 原生会话（同源 Gateway） =================
  // DSH 本体的会话 API 就在同一个源上：POST /api/<endpoint>（client-request 信封）+
  // WS /api/remote.mux（follow 流）。AGENT 面板由此直接说 DSH 原生协议——会话即工作区
  // 原生会话（DSH 侧栏可见可管理），且免掉自起 `dsh --profile acp` 子进程的 9-16s 冷启动。
  // 参数名规则（实测）：网关按 TS 方法签名的参数名校验——session/list 用 _request（下划线
  // 前缀保留），create/prompt/follow/cancel 用 request；其余命名参数平铺在 args 里。
  window.texpileSession = (function () {
    var rpcSeq = 0;
    function call(endpoint, args) {
      var rpcId = 'tw-' + (++rpcSeq);
      var t0 = Date.now();
      // 15s 上限：没有它，桌面端一旦请求挂住，画布的「发送」就永远转圈，界面无法自解释
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
      dbg('session ' + endpoint + ' ->');
      return fetch('/api/' + endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        signal: ctrl ? ctrl.signal : undefined,
        body: JSON.stringify({ type: 'client-request', rpcId: rpcId, method: endpoint, payload: { args: args || {} } })
      })
        .then(function (r) {
          return r.text().then(function (t) { return { status: r.status, text: t }; });
        })
        .then(function (x) {
          var env;
          try { env = JSON.parse(x.text); } catch (e) {
            throw new Error('gateway ' + endpoint + ' 非 JSON 响应（HTTP ' + x.status + '）: ' + String(x.text).slice(0, 140));
          }
          var res = env && env.result;
          if (res && res.ok) {
            dbg('session ' + endpoint + ' ok ' + (Date.now() - t0) + 'ms');
            return res.value;
          }
          throw new Error((res && res.error && res.error.message) || 'gateway error: ' + endpoint);
        })
        .catch(function (e) {
          var msg = String((e && e.message) || e);
          if (e && e.name === 'AbortError') msg = 'gateway 超时 15s: ' + endpoint;
          dbg('session ' + endpoint + ' FAIL ' + (Date.now() - t0) + 'ms ' + msg.slice(0, 300));
          throw new Error(msg);
        })
        .finally(function () { if (timer) clearTimeout(timer); });
    }

    // ---- WS mux：一条 /api/remote.mux 承载任意多条逻辑流（follow/control）----
    var ws = null;
    var wsReady = null;
    var streams = Object.create(null); // streamId -> { onFrame, onDone, onError }
    // mux 地址：web 下用页面自身 host；桌面端页面是 dsh-app://app，location.host 是 'app'，
    // ws://app/... 永远连不上（DNS 失败/超时），AGENT 会话 follow 就卡死。
    // 外壳（同源父窗口）在 __DSH_TRANSPORT__.streamBaseUrl 里给了它真正拥有的 Host origin，
    // 用它拼 ws://127.0.0.1:<port>/api/remote.mux（鉴权 cookie 由 Electron 会话带去）。
    function muxUrl() {
      var base = null;
      try {
        var t = (window.parent && window.parent !== window ? window.parent.__DSH_TRANSPORT__ : null) || globalThis.__DSH_TRANSPORT__;
        if (t && typeof t.streamBaseUrl === 'string' && t.streamBaseUrl) base = t.streamBaseUrl;
      } catch (e) {
        /* 跨源父窗口：读不到就按同源处理 */
      }
      var u = new URL('/api/remote.mux', base || location.href);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return u.href;
    }
    function ensureWs() {
      if (ws && ws.readyState <= 1) return wsReady;
      wsReady = new Promise(function (resolve, reject) {
        var url = muxUrl();
        dbg('mux connect ' + url);
        var sock;
        try {
          sock = new WebSocket(url);
        } catch (e) {
          dbg('mux construct FAIL ' + String((e && e.message) || e));
          reject(new Error('WS mux 地址无效: ' + url));
          return;
        }
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          ws = null; wsReady = null;
          dbg('mux timeout 12s ' + url);
          try { sock.close(); } catch (e) {}
          reject(new Error('WS /api/remote.mux 连接超时（12s）: ' + url));
        }, 12000);
        sock.onopen = function () { settled = true; clearTimeout(timer); dbg('mux open ' + url); resolve(sock); };
        sock.onerror = function () {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            dbg('mux fail ' + url);
            reject(new Error('WS /api/remote.mux 连接失败: ' + url));
          }
        };
        sock.onclose = function () {
          clearTimeout(timer);
          dbg('mux close ' + url);
          ws = null; wsReady = null;
          var ids = Object.keys(streams);
          var orphans = ids.map(function (id) { return streams[id]; });
          streams = Object.create(null);
          for (var i = 0; i < orphans.length; i++) orphans[i] && orphans[i].onError && orphans[i].onError(new Error('WS 已断开'));
        };
        sock.onmessage = function (ev) {
          var msg;
          try { msg = JSON.parse(ev.data); } catch (e) { return; }
          var s = streams[msg.streamId];
          if (!s) return;
          if (msg.type === 'item') s.onFrame && s.onFrame(msg.value);
          else if (msg.type === 'error') { s.onError && s.onError(new Error(msg.error && msg.error.message || 'stream error')); delete streams[msg.streamId]; }
          else if (msg.type === 'end') { s.onDone && s.onDone(); delete streams[msg.streamId]; }
        };
        ws = sock;
      });
      return wsReady;
    }
    var streamSeq = 0;
    function openStream(endpoint, args, handlers) {
      var id = 'tws-' + (++streamSeq);
      streams[id] = handlers;
      return ensureWs().then(function (sock) {
        sock.send(JSON.stringify({ type: 'open', streamId: id, endpoint: endpoint, payload: { args: args || {} } }));
        return function cancel() {
          try { sock.send(JSON.stringify({ type: 'cancel', streamId: id })); } catch (e) { /* ignore */ }
          delete streams[id];
        };
      }, function (e) {
        delete streams[id];
        throw e;
      });
    }

    return {
      available: function () { return true; },
      // 会话生命周期：建在指定目录（= DSH 工作区原生会话）；不传 sessionId 则服务端新建
      create: function (opts) {
        return call('session/create', { request: { cwd: opts && opts.cwd, sessionId: opts && opts.sessionId } });
      },
      prompt: function (sessionId, text) {
        return call('session/prompt', {
          request: {
            requestId: 'tw-req-' + (++rpcSeq),
            sessionId: sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: text }]
          }
        });
      },
      cancel: function (sessionId) {
        return call('session/cancel', { request: { sessionId: sessionId } });
      },
      list: function () {
        return call('session/list', { _request: {} }).then(function (v) { return (v && v.items) || []; });
      },
      page: function (sessionId, maxMessages) {
        return call('session/page', {
          request: { address: { kind: 'session', sessionId: sessionId }, maxMessages: maxMessages || 200 }
        });
      },
      modelCatalog: function () {
        // 无参端点：descriptor 校验零参数，传 _request 反而报 args 不匹配
        return call('session/modelCatalog', {});
      },
      selectModel: function (sessionId, selection) {
        return call('session/selectModel', { request: Object.assign({ sessionId: sessionId }, selection || {}) });
      },
      // 事件流：初始 snapshot（含历史 records）+ 增量 event / assistant-stream 帧
      // 事件流：优先 WS mux（实时流）；桌面端 dsh-app 源连不上 loopback WS（鉴权 cookie 不随
      // 跨站 WS 发送，实测 403），2.5s 内没连上就退回 HTTP 轮询 session/page。
      // 轮询拿不到逐 token 增量，但 user/assistant 消息、工具卡片、标题都会到，
      // 关键是「发送」不会永远转圈：assistant/message 一到就放行。
      follow: function (sessionId, handlers) {
        var cancelled = false;
        var timer = null;
        function page() {
          return call('session/page', {
            request: { address: { kind: 'session', sessionId: sessionId }, maxMessages: 200 }
          });
        }
        function flatten(rec) {
          return rec && rec.event ? rec.event : rec;
        }
        function pollMode() {
          var lastSeq = -1;
          var seen = Object.create(null);
          function emit(ev) {
            if (!ev || typeof ev !== 'object') return;
            if (typeof ev.seq === 'number') {
              if (ev.seq <= lastSeq) return;
              lastSeq = ev.seq;
            } else {
              var key = JSON.stringify(ev).slice(0, 200);
              if (seen[key]) return;
              seen[key] = 1;
            }
            handlers.onFrame && handlers.onFrame({ type: 'event', event: ev });
          }
          function tick() {
            if (cancelled) return;
            page().then(function (v) {
              if (cancelled) return;
              var recs = (v && v.records) || [];
              for (var i = 0; i < recs.length; i++) emit(flatten(recs[i]));
            }).catch(function (e) {
              if (!cancelled && handlers.onError) handlers.onError(new Error('跟随会话失败: ' + ((e && e.message) || e)));
            }).finally(function () {
              if (!cancelled) timer = setTimeout(tick, 900);
            });
          }
          return page().then(function (v) {
            if (cancelled) return function () {};
            var recs = (v && v.records) || [];
            var events = recs.map(flatten);
            for (var i = 0; i < events.length; i++) {
              if (events[i] && typeof events[i].seq === 'number' && events[i].seq > lastSeq) lastSeq = events[i].seq;
            }
            handlers.onFrame && handlers.onFrame({ type: 'snapshot', records: events });
            timer = setTimeout(tick, 900);
            return function cancel() {
              cancelled = true;
              if (timer) clearTimeout(timer);
            };
          }, function (e) {
            if (handlers.onError) handlers.onError(new Error('打开会话失败: ' + ((e && e.message) || e)));
            return function () {};
          });
        }
        var mux = openStream('session/follow', {
          request: { address: { kind: 'session', sessionId: sessionId }, assistantStream: true }
        }, handlers);
        var settled = false;
        return new Promise(function (resolve) {
          mux.then(function (cancelMux) {
            if (settled) {
              try { cancelMux(); } catch (e) {}
              return;
            }
            settled = true;
            resolve(cancelMux);
          }, function () {
            if (settled) return;
            settled = true;
            resolve(pollMode());
          });
          setTimeout(function () {
            if (settled) return;
            settled = true;
            try { mux.then(function (c) { try { c(); } catch (e) {} }, function () {}); } catch (e) {}
            resolve(pollMode());
          }, 2500);
        });
      }
    };
  })();

  console.log('[typwriter] shim installed; bootstrap =', window.__TEXPILE_BOOTSTRAP__);
})();
