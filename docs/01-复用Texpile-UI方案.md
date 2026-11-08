# 方案：保留 Texpile UI，做成左上角入口的 DSH 插件

> 本文替代 `00-结论与路线.md` 里的"自研 Typst 工作台"路线。策略改为：**不重写 UI，把 Texpile 的界面整块搬进 DSH**。
> 桥接实现规格见 `texpile-bridge-spec.md`（620 行，逐成员判定）。

---

## 一、可行性：已验证，不是推断

我在这台机器上真的跑通了：

| 验证项 | 结果 |
|---|---|
| 渲染端能否构建成独立 Web 包 | ✅ `vite build --outDir dist-plugin --base /texpile-desk/app/` **exit 0，2m11s** |
| 产物 | 7543 文件 / **80.62 MB**（`base` 重写全部生效，asset URL 都是 `/texpile-desk/app/...`） |
| 能否在普通浏览器启动 | ✅ **能**。`texpileNative` 为 `undefined`（完全无桥）时，界面正常渲染出开始页：`START / Open Folder… / Join Session / Preferences… / Texpile v1.6.2` |
| 无桥时是否崩 | ✅ 不崩。点"Open Folder"静默无操作，应用仍在位（88 个资源正常加载） |
| 左上角注册方式 | ✅ 与自媒体工作台完全一致，且 `dsh-media-desk` **就在当前 desktop profile 的 bundle 列表里跑着** |

证据截图：`reports/proof-texpile-boots-in-browser.png`

结论：**"保留 Texpile 的 UI 资产"这条路是通的**，不需要重写界面。

---

## 二、注册方式（照抄自媒体工作台）

`dsh-media-desk/dist/client.js` 的真实写法（已从产物中提取）：

```js
function za(e){
  e.slots.inject("main", () => e.slots.register({ name:"main", key: K }, MainPage));
  e.slots.inject("sidebar.panellist", () => e.slots.register(
    { name:"sidebar.panellist", id: K, order: 5, label: () => "自媒体工作台" }, Icon));
}
// 依赖数组 ["slots"]
```

- `sidebar.panellist` 挂在 `sidebar` 下（`dsh-harness/docs/subsystems/slots.md:118`），就是左上角那个入口。
- `main` 是主区根（`slots.md:135`），keyed page，`key` 与 panellist 的 `id` **必须相同**。
- 包结构：`package.json` 的 `dsh` 字段 + `cordis.patch.yml` 4 行 `- insert:`，同一个包出 host 半片与 client 半片。

**为什么用同源 iframe**：DSH 自己就有用 iframe 的 `browser` 侧栏标签（`docs/subsystems/sidebar-right.md:144`），iframe 不是禁区。同源 iframe 还能白拿：localStorage 共享、cookie 自动携带、Texpile 的 Tailwind 4 + 全局 CSS 不会污染 DSH 主题（如果直接 mount，这两套 CSS 必然打架）。对"最快上线"来说这是明显更优解。

---

## 三、目标架构

```
DSH 主区 (main slot)
└─ <iframe src="/texpile-desk/">          ← 同源，无 CORS 问题
     └─ index.html
          ├─ <script> window.__TEXPILE_BOOTSTRAP__ = {...} </script>   ← 必须最先
          ├─ <script src="/texpile-desk/shim.js">                     ← 等价于 electron preload
          └─ Vite 的 assets/index-*.js                                ← 原封不动的 Texpile
                ↓ fetch / WebSocket，全部同源
插件 host 半片：inject ['webServer','connection']
├─ /texpile-desk/*            静态 SPA（自建路由，不走 /plugins/assets，因为那里只收图片）
├─ POST /texpile-desk/api/rpc 1:1 映射 ipcRenderer.invoke
├─ GET  /texpile-desk/api/file 取代 texfile://（需 Range/206、ETag、root 围栏）
├─ GET  /texpile-desk/api/events SSE，扇出所有 onX 回调
├─ WS   /texpile-desk/api/pty 终端（= 编译通道）
└─ WS   /texpile-desk/api/lsp tinymist JSON-RPC
```

鉴权：插件路由**绕过** `/api` 信任栅栏，但 `ctx.connection` 恰好提供了两个方法
（`docs/subsystems/web-server.md:79-95`）：
- `ctx.connection.requestRejection(request)` → 返回拒绝状态或 undefined
- `ctx.connection.admit(request)` → 放行则返回 operator Peer

`dsh-media-desk` 的 host 正好就是 `inject: ['webServer','connection']`，照抄即可。

---

## 四、五个会烧掉一周的坑（都已定位到行号）

1. **`bootstrap` 必须是同步的**
   `preload.ts:35-41` 用 `sendSync` 同步取 bootstrap，`main.ts:38` → `openWorkspace.ts:18-20` 在首帧前就读。
   若 shim 里做成 Promise，`bootOpen()` 永远 null → **永远停在开始页，且不报错**。
   → index.html 里先注入 `window.__TEXPILE_BOOTSTRAP__`，shim 用 getter 同步返回。

2. **`isDesktop()` 只看 `openFolder` 在不在**
   `fileSystem.ts:251-253`。漏了 `openFolder` → `isDesktop()` 假 → `WorkspaceView.svelte:172` 把 `termDock.available` 置 false → `compilePipeline.svelte.ts:207` **静默 return**，用户点编译什么都不发生（连 toast 都没有）。
   → `openFolder` 必须无条件提供，哪怕先返回 null。

3. **编译不是 API，是往终端里打一条命令行**
   `compilePipeline.svelte.ts:95-103` → `terminalDockState.svelte.ts:19` → `Terminal.svelte:98-103`。
   22 个"启动必需"成员里 **8 个属于 `texpileTerminal`**。
   → **想丢终端 = 丢编译**。必须用 `ctx.subprocess` 的 pty 实现（DSH 有 pty 支持）。

4. **`fsStat` 要 mtime，而 DSH 的 `ctx.fs.stat` 没有**
   编译完成判定完全靠 `fsStat().mtimeMs`（`compileWatchers.ts:29-97`）。DSH `FsInfo` 只有 `version/type/size`（`packages/fs/fs/src/types.ts:76-83`）。
   → 这一项**必须走插件侧 `node:fs.stat`**，不能用 `ctx.fs`。漏了会导致第二次编译被 `busy` 挡住。

5. **`texfile://` 有 3 个解析点，不是 1 个**
   构造点只有 `fileSystem.ts:420-422`，但解析点在 `fileSystem.ts:524-527`、`editor/visual/fileAccess.ts:41-43`、`:45-50`。
   → 只改构造点，图片和 PDF 会"空白但不报错"，极难排查。

另外几个规模事实（影响"照类型实现"的判断）：
- **是 10 个全局，不是 9 个**：`preload.ts:5` 还 `import './preloadSnippets'`，后者在 `preloadSnippets.ts:4` 挂了 `texpileSnippets`。漏掉它，LaTeX 片段补全和包文件面会静默空掉。
- `texpileNative` 实际 **134 个成员**，而 `TexpileNative` 类型只声明 74 个（47 个可选）——**类型比现实窄**，照类型实现会漏掉窗口/菜单/MCP 那一圈。
- 全量 **213 个成员：启动必需 22 / 功能必需 19 / 可跳过 172**。也就是说 **81% 可以不做**。
- 真正要实现的 **A+B = 41 个方法**——这是工期估算的分母。
- 一个反直觉点：**编译日志不是"流"**。原始输出走 PTY 帧，结构化诊断则靠 `fsStat` + `fsRead` 轮询落盘的日志文件。所以 pty 和 `fsStat` 两件事都不能省。

路由共 **9 条注册**：`/texpile-desk` 静态前缀、`POST /api/rpc`（1:1 映射 `ipcRenderer.invoke`，125 条通道一张白名单表）、`GET /api/file`、SSE `/api/events`、WS `/api/pty`、WS `/api/lsp`，外加 `/theme-init.js`、`/themes`、`/favicon.svg` 三条站点根资产路由（这三个是绝对路径，不补就是白屏或丢主题）。
鉴权不重写 HMAC，直接 `ctx.get('connection').requestRejection({ headers })`。

---

## 五、v1 范围（能上线的最小闭环）

**做**（按 `agent-bridge` 的剪枝清单）：
`bootstrap`(注入) + `openFolder`(桩) + `getSettings/setSettings` + `fsScan/fsRead/fsWrite/fsStat/fsOp` + `claimWorkspace/releaseWorkspace` + `GET /api/file` + `POST /api/rpc` + 终端 8 个成员（pty）

→ 得到：**能开目录、能编辑 .typ（源码 + 可视化 WYSIWYG）、能存盘、能编译、能看 PDF**。

**不做**（172 个 C 类）：自动更新、ACP Agent 标签页、Zotero / DOI / 模板、协作共享会话、git 面板（可后补）、原生菜单/标题栏、原生上下文菜单、MCP 面板。
**LSP 第二批**：先只做 completion / diagnostics / hover，别一次全上。

**产物瘦身**（80.6 MB → 约 35 MB）：砍 `harper_wasm`（19.3 MB，语法校对）、`spell/*.trie.gz`（13.9 MB，8 种语言词典）、`live-preview-demo.mp4`（1.45 MB 演示视频）。这三项都不影响编辑与编译。

---

## 六、工期

| 阶段 | 内容 | 估计 |
|---|---|---|
| 0 | 插件骨架：`package.json` + `cordis.patch.yml` + host 静态路由 + client 双 slot + iframe | 1 天 |
| 1 | shim + `POST /api/rpc` + fs 五个方法（走 `node:fs`）+ `GET /api/file` | 2~3 天 |
| 2 | pty 终端 8 成员 → 打通编译 | 2 天 |
| 3 | 产物瘦身、index 注入顺序、错误兜底、端到端验收 | 2 天 |
| 4 | LSP（tinymist over WS） | 3~5 天 |
| | **到"能上线自用"** | **约 1.5~2 周** |
| | 到含智能提示的完整体验 | 再加 1 周 |

前置硬依赖：**`typst` / `tinymist` 二进制本机都没有，不在 PATH**。Texpile 原本用私有 CDN + 8 个 SHA256 自动装（`tinymist/tinymistRelease.ts:2-25`）。建议 v1 先做成"检测到缺失就给一键安装指引"，别照搬私有 CDN。

---

## 七、许可（这条决定能不能"上线"）

仓库整体 **AGPL-3.0**。把构建产物打进插件分发，就是分发衍生作品：

| 场景 | 义务 |
|---|---|
| 只自己/自己团队内部用（不对外交付） | 基本不触发 AGPL 的分发义务 |
| 交付给外部用户 | **必须**提供完整对应源码（含我们改的那几处 patch）、保留 AGPL 声明、**必须改名换图标并注明衍生**（`TRADEMARK.md:21-22` 禁止使用 Texpile 名称与 logo） |

→ 插件名建议 `dsh-texpile-desk`（内部标识），但**面向用户的产品名、图标必须换掉**。另注意 cspell 的 `it`/`pt-BR` 词典是 GPL，别打包（正好我们也要砍词典）。

---

## 八、建议的下一步

1. 我先把 **阶段 0 + 阶段 1 的最小骨架真正写出来并装进 desktop profile**，让 `/texpile-desk/` 能在真实 DSH GUI 里从左上角点开、显示 Texpile 界面。
2. 再按坑位顺序补桥（`bootstrap` → `openFolder` → fs → file → pty），每步都可单独验收。
3. LSP 与 git 面板作为第二批。

需要你确认两件事：
- 产品名与图标用什么（必须避开 Texpile 商标）；
- 是否接受"先只支持单文件夹工作区"（多窗口那一圈可以直接不做）。
