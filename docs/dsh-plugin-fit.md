# DSH 插件适配性评估：把 Texpile 的 Typst 论文编辑能力搬进 DeepSeek Harness

> 范围：本报告只回答 **DSH 侧**（插件解剖 / 客户端 UI / 宿主能力 / 已有先例 / 可行性判定）。
> Texpile 侧的代码结构与许可证结论见同目录 `reports/typst-editor.md`、`reports/agent-bridge.md`，本报告不重复。
> 版本基线：DSH **0.2.2-rc.1**（`resources/app.asar` → `dsh/package.json` `version`）；源码对照 **0.2.0-rc.2**（`C:\Users\Fisfzy\dsh-harness`，HEAD `639ed01`）。
> 全部结论均来自实测文件，证据路径在每节末尾列出。

---

## 结论摘要

- **DSH 插件的唯一权威清单是 `package.json` 的 `dsh` 字段**；`dsh-plugin.json` / `dsh.plugin.json` 在 0.2.2-rc.1 里**已经是死格式**（对 213 MB asar 做二进制全量扫描，两个字符串出现次数均为 **0**），但 `ego-browser`、`dsh-better-sidebar` 仍在仓库里带着它们，容易误判。
- **“主区整页 + 右侧栏 tab + 左侧栏入口 + 设置分区”四件套都是官方公开扩展点**，且已有两个跑通的先例（本机 `dsh-paper-desk` 与 `dsh-tylina` 都是这么挂的）。React 可选，任意前端框架自带运行时都能塞进 client bundle；**官方明确反对用 iframe 装宿主页面**（丢主题 token / locale），但技术上可行。
- **宿主能力齐备度：文件系统、子进程（含 stdio pipe 与 pty）、HTTP/SSE/WS 路由、会话派生状态、持久化、权限判定全都有**；唯一缺口是 **LSP**：源码 checkout 里有 `ctx.lsp` seam（4 个语义操作），**但 0.2.2-rc.1 发行包里根本没有 lsp 包**（asar 内 `lsp` 字样只出现 1 次，且属无关依赖）。所以 tinymist 只能由插件自己 `spawn` + 自己分帧。
- **先例的教训极有价值**：`dsh-tylina` 因为客户端写死 0.1 的 `ctx.sessions.open`，在 0.2.x 上点一下就抛 `Uncaught TypeError`，面板永不打开（且许可证 UNLICENSED，不可分发）；`dsh-paper-desk` 证明了 **PDF→源码定位必须靠 SyncTeX**，Typst 侧只能降级成“只渲 PDF”——这正是 Texpile 要补的核心价值。
- **总判定：没有“不可行”的能力项**。真正贵的只有两件：①**可视化（WYSIWYG）编辑器**（Texpile 侧 12.8k 行 + 36k 行依赖闭包，且必须重写成浏览器半片里的 SPA）= **困难**；②**tinymist IntelliSense**（无宿主 LSP seam，要自建 LSP 客户端与传输）= **中等**。其余 5 项（PDF 面板、编译编排、agent 工具、源码编辑器、注释/建议）都能在 **容易~中等** 区间落地，且有可直接照抄的样板代码。

---

## 0. 证据基线与版本事实

| 项 | 值 | 证据 |
|---|---|---|
| 发行版 DSH | `0.2.2-rc.1` | `npx @electron/asar extract-file app.asar dsh\package.json` → `"version": "0.2.2-rc.1"` |
| 发行版包数 | 25,418 条条目 | `npx @electron/asar list` 输出行数 |
| 源码 checkout | `C:\Users\Fisfzy\dsh-harness`，HEAD `639ed01`（0.2.0-rc.2） | `git log -1` |
| 当前 GUI profile | `web`（`profiles/web/package.json` 里 20+ 个 `link:` 外部插件 + `dsh.profile.bundles` 15 行） | `C:\Users\Fisfzy\.dsh\profiles\web\package.json` |
| 另一路注册口 | 用户级 `$DSH_HOME/cordis.patch.yml` 的 `- insert:` 行（支持 `file:///.../lib/index.js` 裸路径） | `C:\Users\Fisfzy\.dsh\cordis.patch.yml` |

> 结论：DSH 有**两层**插件注入面（profile bundles + 用户级 patch），两者最终都落到 Cordis Loader 的 entry 行上。

---

## 1. 插件解剖（PLUGIN ANATOMY）

### 1.1 清单格式：唯一权威是 `package.json` 的 `dsh` 字段

官方 agent 技能 `cordis-plugin-development` 是 0.2.x 的权威写作指南，**全文没有提到 `dsh-plugin.json` 或 `dsh.plugin.json`**，只描述 `package.json`：

```json
{
  "name": "@local/my-plugin",
  "version": "1.0.0",
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js",
               "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "icon": "icon.svg",
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml", "platforms": ["win32"] },
    "client": { "platform": "web", "immediately": true,
                "inject": ["@deepseek-ai/dsh-client-ui-conversation"],
                "external": ["some-runtime-dep"] }
  },
  "engines": { "node": ">=22", "dsh": ">=0.2.1-rc.5 <0.3.0" }
}
```

字段语义（`dsh-package-manifest/README.md`）：

| 字段 | 含义 | 强制? |
|---|---|---|
| `dsh.bundle.patch` | 一个路径，或**有序数组**；作为**一个** bundle 层按序应用 | 想有宿主半片就必须有 |
| `dsh.bundle.platforms` | 非空 Node 平台名列表，如 `["darwin"]`；省略=全平台 | 可选，launcher/plugin-manager 会在装配前拦 |
| `dsh.client.platform` | 目前只支持 `"web"` | 有浏览器半片时必须 |
| `dsh.client.external` | 精确的非基线模块请求（白名单） | 可选 |
| `dsh.manifestVersion` | 清单格式版本，当前为 `1` | 可选；**当前 installer/loader 并不校验它**（README 明说） |
| `engines.dsh` | 声明兼容的 DSH 版本区间 | 可选；**同样不校验** |
| `icon` / `exports["./icon"]` / `locale/*.json` 的 `meta.title`/`meta.description` | 插件面板的显示元数据与图标（SVG/PNG/JPEG/WebP ≤256 KiB，必须在包内） | 想上架就必须 |

**实测（关键）**：对 213 MB 的 asar 做全量字节扫描：

```
dsh-plugin.json   命中 0 次
dsh.plugin.json   命中 0 次
manifestVersion   命中 6 次（仅类型声明/文档文本）
```

而 `@deepseek-ai/dsh-plugin-detail`（读清单做展示的那个包）的 `lib/*.js` 里对这两个文件名也是 **0 命中**。所以：**ego-browser 的 `dsh-plugin.json`（`manifestVersion: 0.15`、`facets.host.entry`、`apiVersion: v1alpha1`、`contributes`、`permissions`、`compat.hosts`）与 `dsh-better-sidebar` 的 `dsh.plugin.json`（`id/main/contributes/client.main`）都是 0.1.x 时代遗留，现在只是死文件**。它们能“工作”纯粹因为同目录的 `package.json` 里同时写了正确的 `dsh` 块。

证据：
- `C:\Users\Fisfzy\dsh-harness\...`（同内容在 asar 内）`dsh-agent-preset\skills\cordis-plugin-development\references\host-plugin.md:7-55`
- 同目录 `templates\decoration\package.json`
- `@deepseek-ai/dsh-package-manifest/README.md:30-58, 96`
- `C:\Users\Fisfzy\.dsh\.external-plugins\ego-browser\dsh-plugin.json`（1-274，完整旧 schema）
- `C:\Users\Fisfzy\.dsh\.external-plugins\ego-browser\package.json:23-37`（真正生效的 `dsh` 块）
- `C:\Users\Fisfzy\.dsh\.external-plugins\dsh-better-sidebar\dsh.plugin.json` + `package.json`（两份并存）

### 1.2 插件如何注册进宿主

三条路，最终都是 Cordis Loader 的 entry：

**(a) profile bundle 列表**（`dsh plugin add` 写入）

```jsonc
// C:\Users\Fisfzy\.dsh\profiles\tylina-probe\package.json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-tylina"] } }
```
每个 bundle 再拿自己的 `cordis.patch.yml` 插行：

```yaml
- insert:
    - id: tylina
      name: 'dsh-tylina'
```

**(b) 用户级 patch**（`$DSH_HOME/cordis.patch.yml`）—— 可以写裸包名，也可以写 `file:///C:/.../lib/index.js`：

```yaml
- insert:
    - id: dsh-session-health
      name: "file:///C:/Users/Fisfzy/.dsh/.external-plugins/dsh-session-health/lib/index.js"
```

**(c) `plugin_manager install_bundle`**（agent 工具）—— 官方唯一推荐的安装路径，会替你做包安装 + bundle 选择，**不要手写 profile 文件、不要在 profile 目录跑 pnpm**（SKILL.md:10）。

**装配契约（踩过坑，务必遵守）**：patch 行里的 `name` **必须等于 `package.json` 的 `name`**。`ego-browser` 的 `cordis.patch.yml:9-19` 明确记录：早先用 junction 别名 `@dsh-external/ego-browser` 注册时，0.1.2 的 client-modules 扫描把入口判为“不是 client 行”，**宿主工具全好用、观看面板静默消失**。

### 1.3 Host 侧导出形态与 `ctx` 面

`host-plugin.md:57-64` 规定两种形态，**不可混用**：

```js
// 形态 1：函数
export function apply(ctx, config) {}
export const inject = ['tools']       // 可选
export const Config = Schema          // 可选（Schemastery），激活时校验行内 config

// 形态 2：服务类（default export）
export default class MyService { ... }
```

**所有资源必须在 `apply` 内用 `ctx.effect`/`ctx.on` 注册并返回清理函数** —— 这是 HMR 与卸载正确性的唯一保证（practices.md:8）。

`apply` 里能用什么（从两个真实插件实测统计）：

| 用法 | ego-browser（`src/*.ts`，30+ 工具 + 面板） | paper-desk（`src/host/index.ts`） |
|---|---|---|
| `export const inject` | `['tools','subprocess']` | `['webServer']` |
| 服务取用 | `ctx.get('webServer')`（可选，TUI/headless 没有就干净退出） | `ctx.webServer`（必需） |
| 工具 | `ctx.tools.register(...)` | `registerPaperTools(ctx, deps)` |
| 路由 | `ctx.webServer.register({kind:'exact', path, handler})` | `ctx.webServer.register({kind:'prefix', path:'/paper-desk', handler})` |
| 副作用 | `ctx.effect(() => dispose, 'label')` | 同 |
| 其它 | `ctx.config / ctx.settings / ctx.logger / ctx.fiber / ctx.reflect / ctx.inject / ctx.provider` | `ctx.effect / ctx.logger / ctx.provide('paperDeskEngine', …)` |

**配置自持久化**不能用“读 profile 的 `cordis.patch.yml` 再改写”的方式（host-plugin.md:66-77），要走 `ctx.get('configEditor').edit(entry, fn)`；密钥走 `ctx.credentials`。

### 1.4 一个插件可以贡献什么（含“怎么做”）

| 贡献物 | 扩展点 | 证据 |
|---|---|---|
| 模型工具 | `ctx.tools.register()` / `defineTool`；MCP 工具也走同一注册（`mcp__<server>__<tool>`） | `dsh-toolkit/src/index.ts`、`extension-cookbook.md:7-9,124` |
| 工具策略钩子 | `tools/pre-execute`（可 `deny`/`ask`）、`tools/execute`、`tools/post-execute`、`tools/result`、`ctx.tools.guard()/restrict()` | `extension-cookbook.md:11-33` |
| HTTP 路由 / WS | `ctx.webServer.register({kind, path, handler})`、`registerUpgrade(route)`（WebSocket）、`registerFallback`（全局唯一） | `@deepseek-ai/dsh-host-webserver/README.md:59-67` |
| 浏览器 UI | `package.json.dsh.client` + `exports["./client"]` + `ctx.slots.register/inject` | `ui-plugin.md:3-11`、`dsh-client-modules/README.md` |
| 主区整页 | root-scoped **keyed** slot `main` + `ctx.layout.selectPanel(id)` | `slots.md:135`、`ui-layout/README.md:36` |
| 左侧栏入口 | `sidebar.panellist`（list），**id 必须等于 main 的 key** | `paper-desk/src/client/index.tsx:154-158` |
| 右侧栏 tab | `ctx.sidebarRightTabs.register({id,kind,…})` + `slots.register({name:'sidebar.right.pane.tab', key:id})` | `ego-browser/src/client/index.ts:3488-3568` |
| 设置页 | `settings.section`（Web）/ `contributes["x-dsh-tui"]` 的 `SettingsSection`（TUI） | `paper-desk/src/client/index.tsx:164-166`、`ego-browser/dsh-plugin.json:32-262` |
| Skill | 依赖 `@deepseek-ai/dsh-skill-filesystem` 提供 SKILL.md 目录（tylina 由此带来 19 个 `typst-*` + 1 个 `tylina` 技能） | `dsh-tylina/package.json` `dependencies` |
| MCP server | **纯配置 bundle**：patch 里插 `@deepseek-ai/dsh-mcp-client`，给 `serverName/transport/url` 或 `command/args` | `references/mcp-bundle.md` |
| 服务给别的插件用 | `ctx.provide(name, value)` / 服务类导出 | `paper-desk/src/host/index.ts:166-172` |
| 会话派生状态 | `ctx.sessionProjections`（纯函数 `apply(state,event)`）+ `wire.view` 下发给客户端 | `practices.md:26-27,38` |
| 系统提示词 | `ctx.systemPrompt.section()`、`agent.inject()` | `practices.md:18` |

### 1.5 两个最小/最大样板对比

- **最小（只有工具，零依赖）**：`dsh-toolkit` —— `src/index.ts` 只做 `export const inject = ['tools']` + `apply(ctx)` 循环调用子插件；每个子包自己的 `cordis.patch.yml` 只有三行。**这就是“给 agent 加工具”的最低成本形态。**
- **最大（工具 + 路由 + SSE + 右侧栏 tab + TUI 面板 + 客户端 bundle + worker 进程）**：`ego-browser` —— `tsdown.config.ts` 一次产出 3 个产物：`lib/index.js`（Node ESM host）、`lib/client.js`（浏览器 CJS）、`bin/ego-cast-worker.mjs`（独立 worker 进程）。

---

## 2. 客户端 UI（CLIENT UI）

### 2.1 客户端 bundle 契约

一个浏览器半片 = **一个 CJS 文件**，内容必须包在 ModuleLoader 工厂里：

```js
window.__ModuleLoader__.load({ id: 'dsh-ego-browser', factory: (require) => { /* … */ return module.exports } });
```

- `id` **必须等于 `package.json` 的 `name`**（`tsdown.config.ts:13-19` 用大段注释记录了这个坑）。
- 执行 bundle **只注册工厂**；一切副作用（含 CSS 注入）都必须在 factory 闭包里，靠 `ctx.effect` 清理。
- React 由宿主模块表提供（`require('react')`），**不许装第二份 React / CDN / UMD**。
- 非基线依赖写进 `dsh.client.external`，否则合成期直接拒绝（缺失供应者、自引用、同步环都会被拒）。
- 构建工具：`tsdown`（ego-browser）或 esbuild（paper-desk `scripts/build.mjs`，只用 `banner/footer` 包一层）。**宿主只服务已构建产物**，`lib/client.js` 不存在会明确报错（client-modules README:57-59）。

### 2.2 资产管理：`/plugins` 路由 + 一个只认图片的资产口

- 宿主把每个 `dsh.client` 声明变成一个 `/plugins/<pkg>/client.js?rev=<rev>` 响应；多个行合成 combo URL（每段 ≤3 KiB），HMR 换成 one-resource URL。
- **包资产**：`exports["./assets/*"]` → `/plugins/<pkg>/assets/<path>?rev=<12位sha1>`，构建期把 `import`/CSS `url()` 编译成 `require.asset(...)`。**只允许 `.svg/.png/.webp/.jpg/.jpeg`**，其它后缀 404；SVG 额外带 `content-security-policy: script-src 'none'`。
- 因此 **wasm / 字体 / PDF.js worker / cmaps 这类资产不能走 `/plugins`**，必须自己挂 webServer 路由（paper-desk 就是这么做的，见 2.6）。

### 2.3 主区整页（全页 / 主区 UI）

slot 树里 `main` 是 **root-scoped keyed slot**，`conversation` 是被 Conversation 保留的 key：

```tsx
ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Workbench))
ctx.slots.inject('sidebar.panellist', () =>
  ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => '论文台' }, PanelIcon))
```

**两条硬约束**（paper-desk 用注释写成“★”）：
1. `main` 的 `key` 与 `sidebar.panellist` 的 `id` **必须相同**，否则点侧栏不会切主区（DSH 用 `activePanelId` 当 `entryKey`）。
2. 二者必须**成对**注册。

程序化切换：`ctx.layout.selectPanel(id)`（`null` 回 Conversation，**不改当前 Session**）；`selectPanel` 会先查 `main` 注册表，key 不存在直接抛错。

### 2.4 右侧栏 tab（两段式注册）

```ts
// ① 静态 tab 类型（无运行时钩子）
const disposeType = tabs.register({
  id: 'dsh-ego-browser:watch',          // 唯一，天然用包名
  kind: 'ego-browser:watch',
  priority: 'extension',                 // extension > builtin > fallback
  keepMounted: true,
  title: () => wt('title'),
  guide: [{ id: 'ego-watch', order: 90, title: () => wt('title'), icon: EgoWatchIcon }],
})
// ② body 注册到 keyed slot，key === 定义 id
ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-ego-browser:watch',
                     inject: () => ({ ctx }) }, Body)
```

- `body` 通过框架注入的 `useTabInfo()` 拿 `{ sidebar, panel, tab }`；`tab.visible/actions/signal/navigation`。
- 想“接管某个文件类型”就写 `patterns`（`dsh-resource://` 的 glob，如 `*.md`）+ `canOpen`；只做 page 型 tab（文件树、工作台）就**不写 patterns**，用 `openTab(kind)` 打开。
- 打开方式：`ctx.sidebarRight.openResource(address, opts)` / `openTab(kind, opts)`；`:目的地` 还有 `destination: 'sidebar' | 'float'`。
- 还有两个次要座位：`sidebar.right.tab.guide`（chain，替换 guide 页 body）、`sidebar.right.tab.menu.item`（list，给 tab 右键菜单加项）。
- **服务可能还没就绪**：正确写法是 `ctx.inject(['sidebarRightTabs'], cb)` 等它，并用 `ctx.get` 兜底、没有就安静跳过（paper-desk `index.tsx:89-145` 就是这个模式，注释写“绝不让整个客户端插件挂掉”）。

### 2.5 能不能塞 Svelte/React SPA + 文件树 + 编辑器？—— 能，且已有先例

- **框架自由**：只有 `react` 与 `@deepseek-ai/dsh-client-*` 是外部基线；其它一切（Svelte 运行时、CodeMirror、ProseMirror、pdf.js）都打进你自己的 client bundle。paper-desk 已经把 `pdfjs-dist` 5.x 打进 bundle（`VIEWER.md:8-16`）。
- **文件树 + 编辑器已有成品**：`dsh-better-sidebar@0.21.1` 本身就是“文件树 + 编辑器 + 变更 + 任务 + 侧边对话”一栏，并且**主动暴露服务给别的插件注册侧栏页面与文件预览器**（`dsh.plugin.json.description`、`package.json` 导出 `./client/service`、`./client/api`）。要做“Typst 文件树 + 编辑器”，可以复用它作为壳，也可以像 paper-desk 一样自建。
- **CSS 注入**：在 `apply` 里 `document.head.appendChild(<style>)` 并在 dispose 时移除（paper-desk `index.tsx:74-87`、ego-browser 同法）。**没有全局 CSP 阻挡 style/script**，颜色统一走 `--dsw-alias-*` token 才能跟随明暗主题。

### 2.6 真实约束（照抄会踩的坑）

| 约束 | 具体表现 | 出处 |
|---|---|---|
| **不要用 iframe 装宿主页面** | `practices.md` 明令：iframe 文档收不到宿主主题 token、明暗切换、`ctx.locale` | `references/practices.md:33` |
| 不要 import 宿主 Client 包 | `require('@deepseek-ai/dsh-client-ui-primitives')` 被禁止；组件抛错会让整个 slot entry 变空白（console: `slot entry crashed in '<slot>'`） | `practices.md:35` |
| 一个 entry 一个 CJS 文件 | `require.async` 只支持 tsdown 切出来的包内 chunk；entry 之间不能同步 `require` 相对路径 | client-modules README:77 |
| 改 `package.json` 不生效 | 清单只在 Loader entry 启动/重启时读一次 | client-modules README:149 |
| HMR 的粒度 | 客户端 bundle 按 `mtime/ctime/size` 算 revision 热替换；**替换已安装的宿主包需要重启条目**；源码 checkout 里还要 `pnpm run dev:web` 才会重建 client 产物 | client-modules README:85,142；`references/host-plugin.md:83` |
| 资产只认图片 | wasm/字体/worker 必须自挂 prefix 路由 + 正确 content-type | client-modules README:39 |
| 插件路由**绕过**宿主 `/api` 信任栅栏 | 精确路径先于 `/api` 前缀匹配 → 自己必须校验 `dsh-auth-<key>` cookie，否则等于对公网裸奔 | `ego-browser/src/cast-server.ts:391-411` |

---

## 3. 编辑器需要的宿主能力盘点

| 能力 | DSH 有吗 | 宿主服务 / API | 关键限制 |
|---|---|---|---|
| 文件读写 / 列表 / watch | ✅ | `ctx.fs`（`resolve/readText/readBytes/list/watch/writeText/editText/patchText/deleteFile/moveFile`，`FsTarget` + 可选 version guard） | **没有 copy、没有递归目录操作**；literal edit/patch/move 只吃 UTF-8；无 I/O 超时 |
| 子进程（编译 typst） | ✅ | `ctx.subprocess.spawn({argv,cwd,stdio,graceMs})`、`resolveExecutable`、`terminate/waitForExit`、`spawnTerminal`（PTY） | 服务本身不给默认值：argv 不 shell 解析，child 环境会**剥掉凭据与 `DSH_*`** |
| 子进程（tinymist LSP over stdio） | ✅ | `stdio: { stdout:'pipe', stdin:'pipe' }`，文档原话就是给“JSON-RPC for the LSP host”用的 | 分帧（`Content-Length`）、生命周期、超时全部**调用方自负** |
| 宿主级 LSP seam | ⚠️ 源码有 / 发行版**没有** | 源码 `packages/lsp/{lsp,lsp-stdio,tool-lsp}` → `ctx.lsp` | ①0.2.2-rc.1 asar 内 **0 个 lsp 包**；②即便有，只有 4 个操作（definition/references/implementation/hover），**没有 completion / diagnostics / codeAction**，且明确“不暴露协议逃生口” |
| 流式推给浏览器 | ✅ | ①自挂 `webServer` 路由 + SSE（ego-browser `/api/ego/stream`）或 `registerUpgrade` 走 WebSocket；②`wire.view` 把 Host 投影预先算好下发 | typert（宿主类型化 RPC）虽存在，但需要 codegen，且本机启动日志显示 `typert-loader` 曾因 codec 缺 `create()` 直接**启动失败** —— 不宜作为第一条依赖 |
| 每会话状态 | ✅ | `ctx.sessionProjections`（纯 `apply`，`stateOf()`，`view()` 同引用抑制发布）；客户端侧 localStorage（sidebar-right 的 store）；`ctx.storage`/`ctx.storageDomain` | **会话日志是唯一真相**；插件**不能新增 session event type**（未知类型只有在 envelope 带 `ignorable: true` 时才可读，而 live `Session.append()` 设不了这个标记） |
| 权限 / 沙箱 | 部分 | 工具调用走 `tools/pre-execute` + `ctx.sandbox` + 审批；**插件 host 代码本身是受信 Node 代码**（`plugin_manager` 安装即信任边界） | 所以“插件能否 spawn typst”不成问题；成问题的是“插件是否应该在无审批下改写用户论文”——需要自己设计写入门禁 |
| 浏览器端算力 | ✅ | WASM 完全可行（pdf.js worker、typst-syntax-wasm 都行） | wasm 资产要自挂路由（见 2.6） |

**结论**：一个 Typst 论文编辑器需要的宿主能力，DSH 缺的只有“现成的 LSP 通道”，而这条通道的上游（stdio pipe 子进程）已经完备，属于**自己写 200~400 行 LSP 客户端**的工作量，不是架构障碍。

---

## 4. 已有先例（PRIOR ART）

### 4a. `dsh-tylina` —— 完整形态的 Typst 编辑器，但在 0.2.x 上**废了**

**它是什么**（`C:\Users\Fisfzy\.dsh\profiles\web\node_modules\dsh-tylina\`，`0.15.2`）：

| 项 | 事实 |
|---|---|
| 包形态 | npm 上的 **bundle-wasm** 版；`dist/index.js` **1.16 MB**（host 半片）、`dist/client.js` **519 KB**（浏览器半片） |
| 宿主半片 | 注册 `/tylina/*` 路由（上一轮实测 `/tylina/`、`/tylina/project` 返回 **401**，不存在的路径 404 → 路由确实挂上了）、27 个 `tylina_*` 工具、19 个 `typst-*` 技能（依赖 `@deepseek-ai/dsh-skill-filesystem`）、一个 MCP 侧（打包里有 `@modelcontextprotocol/{core,server,node}`、`hono`、`ws`） |
| **编译在哪跑** | **不在宿主**：README 原话 “Typst compilation runs in WASM Workers in your browser”；`tylina-web-assets/web/assets/` 里同时有 `tylina_tinymist_bg-*.wasm`（**tinymist 编译成 WASM**）、`ort-wasm-*.wasm`（onnxruntime）、`tesseract` OCR 全量 wasm |
| **怎么包 Typst** | 不是 spawn 外部 tinymist，而是把 **tinymist 塞进浏览器**。宿主 bundle 里能读到 tinymist 的配置键（`tinymist.compileStatus`、`tinymist.formatterMode=typstyle`、`tinymist.triggerSuggest`、`tinymist.supportExtendedCodeAction`…），`licenses/tinymist.txt` 也在 |
| 编辑器 UI | 自带一套**编译好的 SPA**（`web/index.html`、`embed.html`、`presenter.html`、`tylina-embed.js`），由 client bundle 创建 `aside#tylina-dsh-editor-panel` + iframe 承载 —— **正是官方劝阻的 iframe 路线** |
| 许可证 | `"license": "UNLICENSED"`，仓库无 LICENSE 文件 → **不可分发** |

**agent 面工具（27 个，直接抄名字就能对齐能力面）**：

```
tylina_document_outline   tylina_editor_context      tylina_evaluate_document  tylina_export_document
tylina_import_document    tylina_import_image        tylina_inspect_package    tylina_inspect_template
tylina_list_packages      tylina_list_templates      tylina_materialize_template
tylina_presenter          tylina_read_skill_resource tylina_render_overview    tylina_render_page
tylina_render_summary     tylina_save_workspace      tylina_search_images      tylina_semantic_targets
tylina_set_main_file      tylina_set_view            tylina_validate_document  tylina_view_state
tylina_workspace_info     tylina_template__*（模板派生的动态工具）
```

**为什么 0.2.x 上打不开（实测根因，非推测）**：

```
Uncaught TypeError: ctx.sessions.open is not a function
```

- 复现环境：源码 checkout 的 0.2.0-rc.2 探针实例（`127.0.0.1:3099`，profile `tylina-probe`）。
- 现象：点侧栏 Tylina 按钮 → 抛异常 → `aside.tylina-dsh-panel` 始终 `hidden`、宽 0、`iframes: []`。
- 原因：0.2 重写了**客户端**会话服务 API。`ctx.sessions.refresh()` 还在（所以不更早报错），但 `open()/list()/current/ids` **全部消失**，换成了 `retain / create / fork / search / binding / scope`。字符串级核对 0.2.2 的 `dsh-api-session-controller/lib/client.js`：`open(id)` 定义数量 **0**，所以桌面版表现一致。
- 连锁后果：**工具是绑定编辑器连接的**（工具注册“session scoped 且由唯一编辑器独占”），UI 打不开 → 文档工具全废 → 整个插件只剩技能可用。
- 旁证：同一时段 `tylina-probe` 的启动日志还显示 `tylina` 处于 `Plugins waiting for services`（缺 `skills, sessionController, sessions`）。

**对我们的意义**：这是**唯一一个把“Typst 编辑器塞进 DSH 客户端”完整跑通过的产品**，它的形状（宿主路由 + 工具 + 技能 + iframe SPA）就是可行性的上界证明；它的死法也是最好的警告：**别把客户端私有 API 当契约**。

### 4b. `D:\AIWORK\DSH-PAPERWIRTER` 的 `dsh-paper-desk` —— LaTeX 论文修回工作台，Typst 只降级到“渲 PDF”

**它是什么**（`package.json`）：`dsh-paper-desk@0.1.0`，**同一个包同时出宿主半片和浏览器半片**：

```jsonc
"main": "./lib/host/index.js",
"exports": { ".": "./lib/host/index.js", "./client": "./dist/client.js" },
"dsh": { "bundle": { "patch": "./cordis.patch.yml" },
         "client": { "platform": "web",
                     "inject": ["@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-sidebar-right"] } },
"engines": { "dsh": ">=0.2.1-rc.5 <0.3.0" }
```

**宿主侧**：`inject: ['webServer']`，唯一贡献是一条前缀路由 ——

```ts
ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/paper-desk', handler }),
          'paper-desk: /paper-desk routes')
```

外加：自建 SSE 事件总线（`compile/log`、`revision/applied`）、`ctx.provide('paperDeskEngine')`、以及 **13 个模型工具**（`paper_open_project`、`paper_project_status`、`paper_read_source`、`paper_locate`、`paper_compile`、`paper_apply_revision`、`paper_revision_history`、`paper_read_pdf_text`、`paper_library_search/item/citation_key/bibtex/import_bibtex`）。**模型与 UI 同权，全部走 Engine 的唯一写入口。**

**浏览器侧**：主区 keyed page `paper-desk` + `sidebar.panellist` + 两个 `sidebarRightTabs`（「论文审阅」「文献阅读」）+ `settings.section`，样式全走 `--dsw-alias-*`。

**跑通了什么（有真实浏览器验收记录）**：

> 在 PDF 上划选一句话 → 定位到 `main.tex:13–14` → 自然语言指令 → SSE 流式候选 → diff → 应用 → **xelatex 编译（10 页）** → PDF 热刷新（**保持滚动位置**）→ 修订历史可回滚 → 通道 B（让助手改）走 `paper_apply_revision`。
> 验收证据：文件 sha256 前后对比、`.paperdesk/backups/main-<ISO>.tex`、历史 `{actor:"user", startLine:13, endLine:14, compileOk:true}`；`npm test` **294 tests / 292 pass / 2 skipped**。

**难在哪（这是本报告最有价值的“撞墙清单”）**：

1. **PDF→源码映射只能靠 SyncTeX**，而这只有 xelatex 有。Typst 侧因此被显式降级：
   ```ts
   // src/host/engine/index.ts:395-397
   if (project.kind === 'typst') return this.compileTypst(project, opts)   // 单条命令、无事务回滚
   // src/host/engine/locate.ts:122-124
   if (project.kind === 'typst') throw new Error('这是 Typst 项目（.typ）：目前…')
   ```
   UI 上直接写「Typst 项目：当前只渲染 PDF」。**这就是 Texpile 要补的核心价值位**。
2. **坐标系陷阱（实测，不是推导）**：pdf.js 给你的是 user space（原点左下、y 向上），synctex 要的是 PDF space（原点左上、y 向下）。用 `synctex edit` 反查验证过：page1 `y=141→line 12`，未翻转会命中最底部。全仓只允许一处做这件事（`src/client/pdf/geometry.ts` 的 `viewportPointToPdfPoint()`）。
3. **pdf.js 的静态资产要自己发**：`GET /paper-desk/static/pdf/pdf.worker.min.mjs`（**必须 `content-type: text/javascript`**）、`cmaps/*`（中文 PDF 必需）、`standard_fonts/*`；PDF 本体 `GET /paper-desk/project/pdf?rev=<mtimeMs>` 用 rev 破缓存。
4. **编译日志要流式**：kernel 按行缓冲、跨 chunk 半行拼回、≤2000 字符/行、~20 行/秒限流、每遍推 `---- pass N/M ----` marker，回调异常一律吞掉。
5. **DSH 会话注入的形状是个地雷**：给 `followup/inject` 传 `{role:'user',source,content}` 会把 session 日志写坏（重开报 `session event at seq 138 lacks an identified message`，整条会话打不开）；契约是 **`{ content, source }`，不能带 `role`**。
6. 另有 PDF 热刷新跳末页、外部改动不刷新等 4 个 bug，均在 `E2E-ACCEPTANCE.md` 记录成因与修法。

**对我们的意义**：编译编排 / 事务写入 / 回滚 / SSE 日志 / PDF 面板 / 主区+右栏布局 / agent 工具，这一整套**已经有人在 DSH 里做完并验收过**，可直接移植；唯一不能移植的恰好是 Typst 最想要的那块（PDF→源码精确定位）。

### 4c. 其它可借用件

| 插件 | 可借什么 |
|---|---|
| `dsh-better-sidebar@0.21.1` | 现成的文件树 + 编辑器 + 变更面板，并**对外暴露服务**让别的插件注册侧栏 tab 与文件预览器 |
| `ego-browser@0.9.11` | 最完整的“宿主路由 + SSE 推帧 + 右侧栏 tab + 自建 worker 进程 + 认证栅栏”样板（`cast-server.ts` 819 行） |
| `dsh-toolkit` | 最小工具插件的工程范式（子包 + 各自 patch + 原子回滚注册） |

---

## 5. 判定表（VERDICT）

| # | Texpile 能力 | 判定 | 具体阻碍 / 落地路径 |
|---|---|---|---|
| 1 | **可视化（WYSIWYG）Typst 编辑器** | **困难** | 容器没问题（`main` keyed slot 装整页），难在**必须重写**：Texpile 的 Typst 可视化层 12.8k 行、4 跳依赖闭包 540 文件/36k 行，且根植于 ProseMirror + Svelte 工具栏 + Electron IPC；宿主不允许 iframe（丢主题/locale），官方要求“插件 UI 就是宿主 UI”。可行路径 = 保留 ProseMirror 内核，把 `$lib/editor/visual` 那 8.1k 行一级依赖 + FileWriter 换成 `ctx.fs`/自建路由。 |
| 2 | **tinymist IntelliSense（补全/诊断/hover）** | **中等** | 无宿主 LSP seam 可蹭（**0.2.2-rc.1 发行包 0 个 lsp 包**；源码里的 `ctx.lsp` 也只有 4 个导航操作、无 completion/diagnostics）。必须自己：`ctx.subprocess.spawn({argv:['tinymist','lsp'], stdio:{stdin:'pipe',stdout:'pipe'}})` + `Content-Length` 分帧 + 一条 `registerUpgrade` 的 WebSocket（或 SSE+POST）把 JSON-RPC 转给浏览器 + 客户端接 CodeMirror `lsp-client` 的 Transport。风险点全在进程生命周期回收与背压。 |
| 3 | **实时预览** | **中等** | 两条路：**(A) 推荐** —— 宿主侧 `typst compile` 出 PDF → 静态路由 + 前端 pdf.js 热刷新（`?rev=mtime`，保滚动/缩放），paper-desk 已完整验证；**(B) 不建议** —— 照抄 Texpile 的“抓 tinymist 内置预览页 + 字符串替换 websocket 地址 + loopback 重发 + iframe”，依赖 tinymist 私有字段与 5 处页面 JS 字面量，版本一升就碎，且撞 iframe 禁令。 |
| 4 | **PDF 面板（渲染 / 翻页 / 文字层）** | **容易** | `pdfjs-dist` 打进 client bundle；宿主挂一条 prefix 路由发 worker/cmaps/standard_fonts（**content-type 必须是 text/javascript**）与 PDF 本体。唯一注意点：`/plugins` 资产口只收图片，wasm/字体必须走自己的路由。 |
| 5 | **注释 / 建议（comments & suggestions）** | **中等** | DSH **没有原生批注数据模型**：插件不能新增 session event type（会被会话重开校验拒绝）。所以必须自建：项目内状态文件（如 `.paperdesk/` 模式）+ 自建路由 + 自建浮层 UI；锚点用字符偏移或 Typst label 自己做（Typst 无 SyncTeX，拿不到 PDF→源的官方映射）。UI 侧不难，难在锚点健壮性与“外部改动后如何重定位”。 |
| 6 | **编译编排（队列 / 事务 / 回滚 / 日志）** | **容易** | `ctx.subprocess` 或直接 `spawn('typst', ['compile','--root',root,main,pdf])` 都行（paper-desk `engine/index.ts:344-393` 就是可用脚本）；进程内队列 + 跨进程锁 + tmp/marker/rename 事务发布 + 编译日志 SSE + 失败回滚，整套代码已在 paper-desk 里跑过 294 个测试。Typst 侧更简单（无两遍收敛、无 aux）。 |
| 7 | **agent 工具（读写/编译/定位/导出）** | **容易** | `ctx.tools.register()` / `defineTool` 是标准动作。可直接照 `tylina_*`（27 个）与 `paper_*`（13 个）两张能力表裁出 `typst_*` 工具集；官方还要求“UI 动作与工具共用一个 Host 方法”（`user-actions.md`），正好和 Engine 唯一写入口的设计一致。 |
| 8 | **把 Texpile 的 Electron 渲染层**整体搬进 DSH | **不可行**（作为“搬运”，非“重写”） | 依赖 Electron `ipcRenderer`/`BrowserWindow`/`webContents.send`、tinymist 预览页的私有 DOM 字段、自制 loopback 反代。DSH 是 Web 页面 + Node 宿主，没有这两端等价的桥。凡是要复用的部分，都得重写成“宿主服务 + client bundle”。 |

**总体判断**：`容易/中等` 的 5 项（3/4/6/7 等）可以在 **2~4 周**内做出一个“Typst 论文工作台 v1”：主区整页 + 右侧 PDF/审阅 tab + typst 编译流 + `typst_*` agent 工具。`困难` 的 2 项（可视化编辑器、tinymist 智能提示）是后续 1~2 个月量级，且应该**先做 tinymist（中等）再做 WYSIWYG（困难）**，因为前者能立刻把“agent 能不能看懂/改对 Typst”这件事闭环。

---

## 6. 建议的最小可行实现顺序（基于以上证据）

1. **v0（1 周）**：`package.json` + `cordis.patch.yml` + `inject:['webServer']`，挂 `/typst-desk/*` 前缀路由，`spawn('typst', ['compile', ...])`，出 PDF；右侧栏一个 tab 用 pdf.js 显示（**照抄 paper-desk 的 VIEWER 契约**）。此时零 agent 能力，但能验证“Typst 在 DSH 里能编译能看”。
2. **v1（1~2 周）**：加 `typst_*` 工具（read_source / compile / apply_revision / outline / export），写入走“唯一写入口 + 备份 + 回读校验 + 编译失败回滚”的事务模型；主区 `main` 整页 + `sidebar.panellist` 入口；SSE 推编译日志。
3. **v2（2~3 周）**：tinymist —— `ctx.subprocess` stdio pipe + WebSocket 桥 + CodeMirror lsp-client；先只做 completion/diagnostics/hover。
4. **v3（1~2 月）**：WYSIWYG —— 以 `typst-syntax-wasm`（267 KB，无 DOM/WASI 依赖）为唯一语法真相，重写可视化层；**不要**去搬 Texpile 的 `$lib/editor/visual` 闭包。

---

## 附录：本报告引用的关键路径

**DSH 官方文档（源码 checkout，`C:\Users\Fisfzy\dsh-harness`）**
- `docs\subsystems\slots.md`（slot 树、cardinality、`main`/`rightbar` 层级）
- `docs\subsystems\sidebar-right.md`、`docs\subsystems\lsp.md`、`docs\subsystems\typert.md`、`docs\subsystems\client-modules.md`
- `docs\cookbook\extension-cookbook.md`（feature → mechanism 全表）
- asar 内 `dsh\node_modules\@deepseek-ai\dsh-agent-preset\skills\cordis-plugin-development\`：`SKILL.md`、`references\{host-plugin,ui-plugin,practices,user-actions,verification,mcp-bundle}.md`、`templates\decoration\*`

**包 README（asar 内，已抽到 `%TEMP%\dshex\`）**
- `@deepseek-ai\dsh-package-manifest\README.md`
- `@deepseek-ai\dsh-client-modules\README.md`
- `@deepseek-ai\dsh-client-ui-layout\README.md`、`dsh-client-ui-sidebar-right\README.md`
- `@deepseek-ai\dsh-host-webserver\README.md`、`dsh-subprocess\README.md`、`dsh-fs\README.md`

**外部插件**
- `C:\Users\Fisfzy\.dsh\.external-plugins\ego-browser\`：`package.json`、`cordis.patch.yml`、`tsdown.config.ts`、`src\cast-server.ts:360-506`、`src\client\index.ts:3488-3589`
- `C:\Users\Fisfzy\.dsh\.external-plugins\dsh-toolkit\`：`src\index.ts`、`package.json`、`packages\dsh-tool-calculator\{package.json,cordis.patch.yml}`
- `C:\Users\Fisfzy\.dsh\.external-plugins\dsh-better-sidebar\`：`dsh.plugin.json`、`package.json`

**dsh-tylina**
- `C:\Users\Fisfzy\.dsh\profiles\web\node_modules\dsh-tylina\{package.json,README.md,cordis.patch.yml,dist\index.js,dist\client.js}`
- `C:\Users\Fisfzy\.dsh\profiles\web\node_modules\tylina-web-assets\{package.json, web\assets\tylina_tinymist_bg-*.wasm}`
- 观察 profile：`C:\Users\Fisfzy\.dsh\profiles\tylina-probe\{package.json,cordis.yml}`
- 启动失败日志：`C:\Users\Fisfzy\.dsh\logs\startup-2026-11-07T00-36-53.199Z-b9b45948-…log`（`tylina` 在 `Plugins waiting for services: skills, sessionController, sessions`）

**paper-desk**
- `D:\AIWORK\DSH-PAPERWIRTER\package.json`、`cordis.patch.yml`
- `src\host\index.ts`（注册全貌）、`src\host\engine\index.ts:344-397`、`src\host\engine\locate.ts:122-124`、`src\host\engine\artifacts.ts:33-34`
- `src\client\index.tsx`（main + panellist + 两个 sidebarRightTabs + settings.section）
- `docs\{ENGINE,VIEWER,E2E-ACCEPTANCE,M0-verify,M3-verify,M6-verify}.md`
