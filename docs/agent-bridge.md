# Texpile × DSH：Agent 集成面与许可分析

分析对象：`D:\AIWORK\TYPST PAPER WRITE\texpile`（只读分析，未修改仓库任何文件）。
所有引用均为 `文件:行号`；`electron/src/...` 指主进程（Electron main），`apps/texpile-editor/src/...` 指渲染进程（Svelte）。

> 说明：本文是**工程分析**，不是法律意见。许可结论请以 Texpile LLC / 上游项目书面答复与律师意见为准。

---

## 结论摘要

1. **MCP 服务器完全内嵌在 Electron 主进程里，唯一传输是 loopback HTTP（127.0.0.1:7317/7318，Streamable HTTP + stateless）。没有任何 stdio transport，也不存在可脱离 App 运行的服务进程**——`server.ts` 的 host 抽象直接以 `BrowserWindow` 为输入（`windowState.ts:10,68`、`mcpIpc.ts:21,24,28`）。所以答案很明确：**不能 headless 使用**；App 不在运行 = 端口无人监听。
2. **没有窗口时**：`get_editor_state` 返回 `{focused:null, workspaces:[]}`；**其余 16 个工具全部返回 `no matching Texpile window`**（`tools.ts:108,136,160,184,209,234,262,291,313,341`、`relay.ts:13`）。Windows/Linux 上关掉最后一个窗口即退出进程（`main.ts:279-281`），macOS 上进程可存活但工具同样全废。
3. **MCP 面是「读状态 + 操纵视图」设计，不是「写文档」设计**：唯一的文档改动是 `suggest_edit`，落成建议（suggestion），且**只接受编辑器里已打开的那个文件**（`server.ts:8-11`、`tools.ts:4-5`、`mcpSuggestEdit.ts:24`）。真正写文件要靠 agent 自己的 fs 工具直接写磁盘（`tools.ts:26-27` INSTRUCTIONS）。
4. **ACP 方向正好相反**：Texpile 是 ACP **客户端**，spawn `codex-acp / claude-agent-acp / opencode acp / copilot --acp / gemini --acp`（`acpAgents.ts:22-28,51-69`），自己只做「权限闸门 + 回合快照 + Revert」（`acpPermissions.ts`、`turnSnapshot.ts`、`ownWrites.ts`）；同时把**同一套 MCP 工具**以 `startPrivate` + Bearer token 注入给它启动的 agent（`server.ts:206-236`、`acpSession.ts:113-116`）。即：**Texpile 驱动 agent 是主设计，agent 驱动 Texpile 是受限副产物**。
5. **许可分层是「仓库级 AGPL-3.0 + 两个包的清单级 MIT/Apache-2.0」**：仅通过 MCP 访问 = 无义务；fork 任意 AGPL 代码进 DSH 插件 = 整插件 AGPL + 商标改名；只用 `packages/mathlive`(MIT) / `packages/typst-syntax-wasm`(Apache-2.0) 是**最干净的一条路**，但这两处只有 manifest 声明、`typst-syntax-wasm` 无 LICENSE 文件，建议先取书面确认。仓库内最「非宽松」的依赖是 cspell 拼写词典（`it`/`pt-BR` 为 GPL-3.0-or-later，`de/es/pt-PT/pl` 为 LGPL-3.0，`ACKNOWLEDGEMENTS.md:13`）。

---

## 1. MCP 服务器：完整托管故事

### 1.1 代码骨架

| 文件 | 职责 |
| --- | --- |
| `electron/src/mcp/server.ts` | HTTP 服务器本体、端口、Origin 校验、endpoint 文件、私有实例（`startPrivate`） |
| `electron/src/mcp/tools.ts` | `buildServer()` + 11 个工具 + INSTRUCTIONS 文本 |
| `electron/src/mcp/commentTools.ts` | 5 个评论工具 |
| `electron/src/mcp/suggestTools.ts` | `suggest_edit` |
| `electron/src/mcp/relay.ts` | 工具 → 渲染进程请求的统一通道（含 `ownAgent` 透传） |
| `electron/src/mcp/bridge.ts` | `ipcRenderer` 方向的 `mcp:request` / `mcp:command` 发送与超时 |
| `electron/src/mcp/windowState.ts` | 主进程侧的窗口状态缓存（渲染进程推、非拉） |
| `electron/src/mcp/toolReply.ts` | 三种回复形状：`ok` / `fail` / `refused` |
| `electron/src/ipc/mcpIpc.ts` | `McpHost` 的真实实现（绑定 `BrowserWindow`）、开关 IPC |
| `electron/src/ipc/deferredIpc.ts` | 启动顺序：`mcpEnabled` 为真时自动 `start()` |

### 1.2 启动路径（谁、何时、在哪）

```ts
// server.ts:118-151  start()
http = createServer((req, res) => { ... });
await new Promise<void>((resolve, reject) => {
    http!.once('error', reject);
    // 127.0.0.1 rather than 0.0.0.0, so this is never reachable off-box
    http!.listen(h.port, '127.0.0.1', resolve);      // :136
});
```

- 端口是**固定**的：`PORT_DEFAULT = 7317`，dev 通道 `PORT_DEFAULT_DEV = 7318`（`server.ts:53-54`）；可在 `settings.json` 写 `mcpPort` 覆盖（`appSettings.ts:47`、`mcpIpc.ts:12-15`）。设计理由写在 `server.ts:44-52`：客户端配置一次要能跨天复用。
- 只有一处调用 `start()`：`mcpIpc.ts:40-45` 的 `mcp:setEnabled` 开关，以及 `deferredIpc.ts:56-64` 的**开机自动启动**：

```ts
// deferredIpc.ts:56-64
const mcpIpc = await import('./mcpIpc.js');
mcpIpc.registerMcpIpc();
mcpServer = await import('../mcp/server.js');
// A client is configured once and expects us to be listening ...
if (readSettings().mcpEnabled) mcpServer.start(mcpIpc.mcpHost()).catch(...)
```

- 默认关闭：`mcpEnabled: false`（`appSettings.ts:41-44`）。开启方式只有 UI 开关（`PrefsAiPanel.svelte:102-112` → `preload.ts:72` → `mcpIpc.ts:40`）。
- 退出时 `shutdownDeferred()` 调 `mcpServer?.stop()`（`deferredIpc.ts:80-86`），并删除 discovery 文件（`server.ts:153-161,173-179`）。

### 1.3 传输：不是 stdio，是 stateless 的 Streamable HTTP

```ts
// server.ts:101-116
const server = buildServer(currentHost);
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); // :103
res.on('close', () => { void transport.close(); void server.close(); });               // :105-108
await server.connect(transport);
await transport.handleRequest(req, res);
```

- 每个请求新建 server + transport，因为“stateless 模式下共享一个 transport 会在 initialize 之后每次调用 500”（`server.ts:94-100` 的注释）。
- 全仓检索 `StdioServerTransport|pipeTransport`：**0 命中**。即**仓库里没有任何 stdio MCP 服务实现**。
- `server.ts:5-6` 的注释提到客户端可通过 `texpile-mcp` bridge 把 stdio 管到该端口，但**本 checkout 内不存在该 bridge 的代码**（全仓仅 `server.ts:5` 一处出现 `texpile-mcp` 字样），discovery 文件 `mcp-endpoint.json`（`{port, pid}`，`mode 0o600`，`server.ts:42,164-171`）也只被写、没有读者。→ 若 DSH 要走 stdio，需要自己实现这个桥（读 endpoint 文件 → 转发）。

### 1.4 访问控制

- 无密码，唯一的闸门是 Origin 白名单（`server.ts:76-92`）：
  ```ts
  function originOk(req) { const origin = req.headers.origin; if (!origin) return true;
      return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin); }
  ```
  理由：真实 MCP 客户端不发送 Origin，浏览器页面会发送（`server.ts:76-87`）。
- 文档也明说：「While the server is on, any program on your computer can connect without a password」（`docs/ai-assistant/mcp.md:20`）。
- 另有 `startPrivate()`：端口 `0`（系统分配）、每窗口一个 32 字节 Bearer token、`timingSafeEqual` 比较、不写 endpoint 文件、不点亮 topbar（`server.ts:206-236`）。这是给 Agent tab 自己启动的 agent 用的（见 §2.5）。

### 1.5 一次工具调用如何到达渲染进程

```
MCP client ──HTTP POST──> main(server.ts) ──buildServer()──> tools.ts handler
                                   │
                                   └─ target(root) → windowFor(root) → BrowserWindow    (tools.ts:90-92, mcpIpc.ts:25-31)
                                          │
                       ┌──────────────────┴───────────────────┐
             fire-and-forget command                  request/response
        sendCommand → win.webContents.send('mcp:command')   askRenderer → 'mcp:request' {id,kind,args}
             (bridge.ts:51-53)                                (bridge.ts:36-49，默认 2000ms 超时→resolve(null))
                       │                                          │
                       ▼                                          ▼
        renderer: texpileNative.onMcpCommand              renderer: onMcpRequest → mcpRespond(id,payload)
        (preload.ts:162-167 → mcpCommands.ts:366-379)             (preload.ts:151-159 → mcpCommands.ts:309-364)
                       │                                          │
                       └──────────► ipcMain.on('mcp:response') → deliverResponse(id,data)  (mcpIpc.ts:48-50)
                                                                  → ipcRenderer.send('mcp:response')  (preload.ts:159)
```

要点：

- **`askRenderer` 超时返回 `null` 而不是抛错**，注释解释「'the editor was too busy to say' 是工具调用的正常答案」（`bridge.ts:31-49`）。默认 2000ms；`get_comments`/`add_comment`/`reanchor` 用 5000ms（`commentTools.ts:44,68,126`），`suggest_edit` 用 10000ms（`suggestTools.ts:34`）。
- **状态是「推」不是「拉」**：渲染进程在 `$effect` 里把窗口状态发给主进程（`mcpPublish.ts:105-113` → `preload.ts:75` → `mcpIpc.ts:51-53` → `windowState.ts:42-44`），因为拉取会撞上 ProseMirror 重建（`windowState.ts:1-9`）。`updatedAt` 暴露出来，便于看出缓存陈旧（`windowState.ts:29-30`）。
- 所有工具的执行都在渲染进程里，且**路径只能落在已打开的 workspace 树内**：`resolveInWorkspace` 只做包含性检查、不碰文件系统的存在性判断（`mcpWorkspacePath.ts:7-18`），`open_file` 的路径甚至从不进入 fs 服务（`tools.ts:161-164` 注释）。

### 1.6 CRITICAL：能否 headless / Electron 未运行时使用？——不能

**结论：不能。宿主与 BrowserWindow 是强绑定的，而且没有第二处宿主实现。**

证据（逐条）：

1) MCP 协议层本身已经很薄，但它的依赖是 Electron 类型与实例：

```ts
// server.ts:21-40  —— McpHost 抽象的全部内容
export type McpHost = {
    userDataDir: string;
    port: number;
    windows(): { webContentsId: number; focused: boolean }[];
    rootFor(wcId: number): string | null;
    /** raw BrowserWindow list for the state snapshot */
    windowObjects(): Parameters<typeof snapshotWindows>[0];   // ← BrowserWindow[]
    windowFor(root?: string): { win: Parameters<typeof snapshotWindows>[0][number]; root: string | null; ownAgent?: boolean } | null;
    onConnectionChange?(client: string | null): void;
};
```

```ts
// windowState.ts:10
import type { BrowserWindow } from 'electron';
// windowState.ts:68-77
export function snapshotWindows(windows: BrowserWindow[], rootFor: (wcId: number) => string | null): WorkspaceSnapshot[]
```

```ts
// mcpIpc.ts:17-36  —— 唯一的 McpHost 实现
export function mcpHost(): mcp.McpHost {
    return {
        userDataDir: app.getPath('userData'),
        port: mcpPort(),
        windows: () => BrowserWindow.getAllWindows().map(...),      // :21
        rootFor: (wcId) => folderOf(wcId),
        windowObjects: () => BrowserWindow.getAllWindows(),         // :24
        windowFor: (root) => {
            const win = root ? windowWithRoot(root) : (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null); // :28
            if (!win) return null;                                  // :29-30
            return { win, root: folderOf(win.webContents.id) };
        },
        onConnectionChange: (client) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('mcp:connection', client); }
    };
}
```

2) 真正的执行端是渲染进程的 `webContents.send`：

```ts
// bridge.ts:36-49
export function askRenderer(win: BrowserWindow, kind: string, args?, timeoutMs = 2000) {
    ...
    win.webContents.send('mcp:request', { id, kind, args: args ?? {} });   // :47
}
// bridge.ts:51-53
export function sendCommand(win: BrowserWindow, cmd: McpCommand): void { win.webContents.send('mcp:command', cmd); }  // :52
```

3) 工具层强制要求一个窗口（`target()` 为 null 即失败）：

```ts
// tools.ts:89-92
/** every tool below needs a window; root picks one when several are open */
function target(root?: string) {
    return currentHost()?.windowFor(root) ?? null;
}
// tools.ts:158-160（open_file 为例，其余工具同构）
const t = target(root);
if (!t) return fail('no matching Texpile window');
```

`fail(...)` 是 `isError: true` 的 MCP 错误回复（`toolReply.ts:8-11`）。`relay.ts:13` 对评论/建议类工具给出同一句。

4) 唯一的例外是 `get_editor_state`：它只读缓存，空窗口时给出 `{focused:null, workspaces:[]}`（`tools.ts:78-86` + `windowState.ts:61-76` 注释“one window, nothing open 与 no windows at all 必须可区分”）。

5) 进程生命周期决定了「App 不在 = 服务不在」：

```ts
// main.ts:279-281
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
```
退出时 `shutdownDeferred()` → `mcpServer?.stop()`（`deferredIpc.ts:80-86`），并 `rmSync(mcp-endpoint.json)`（`server.ts:153-161,173-179`）。

6) 没有旁路：全仓没有 `bin` 入口（见 §6），没有第二个 `start()` 调用点，`start(h: McpHost)` 虽然接受任意对象，但任何“仿造 host”都必须提供带 `webContents.send` 的窗口对象，而真正处理请求的逻辑（`mcpCommands.ts`）只存在于渲染进程 bundle 里，**脱离 Electron 无从执行**。

**因此对 DSH 的直接含义**：MCP 是「附着在用户桌面上那一个 Texpile 实例」的通道，不是可编排的服务端。DSH 必须假设：Texpile 可能没开、可能开了但没窗口、可能开了 3 个窗口（需用 `root` 选对 workspace，`mcpIpc.ts:25-31` 注释解释为何按 root 而不是焦点选窗口）、可能被用户的最小化/大文档阻塞（2s/5s/10s 超时）。

---

## 2. ACP 客户端：Texpile 在驱动别人的 agent

### 2.1 这是什么

Texpile 用 `@agentclientprotocol/sdk` 实现 ACP **client** 侧，spawn 一个外部 agent 作为子进程，用 NDJSON 走它的 stdin/stdout：

```ts
// acpSession.ts:99-106
const stream = acp.ndJsonStream(Writable.toWeb(child.stdin!), Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>);
this.connection = acp
    .client({ name: 'texpile' })                                  // :101  ← 客户端身份
    .onRequest(acp.methods.client.session.requestPermission, (ctx) => this.permissions.ask(ctx.params))
    .onNotification(acp.methods.client.session.update, (ctx) => { ... })
    .connect(stream);
```

握手与建会话：

```ts
// acpSession.ts:108-119
const init = await this.connection.agent.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { session: { compaction: {} } },
    clientInfo: { name: 'texpile', title: 'Texpile', version: this.o.version }
});
const mcp = init.agentCapabilities?.mcpCapabilities?.http ? this.o.mcp : null;
this.mcpServers = mcp ? [{ type: 'http', name: 'texpile', url: mcp.url, headers: [{ name: 'Authorization', value: `Bearer ${mcp.token}` }] }] : [];
const session = await this.connection.agent.request(acp.methods.agent.session.new, { cwd: this.o.root, mcpServers: this.mcpServers });
```

启动哪个程序由设置决定，**窗口不能指定程序**（`acpIpc.ts:1-2` 注释）：

```ts
// acpAgents.ts:22-28
const PRESETS = {
    codex:    { cli: 'codex',    adapter: 'codex-acp.mjs',       cliEnv: 'CODEX_PATH' },
    claude:   { cli: 'claude',   adapter: 'claude-agent-acp.mjs', cliEnv: 'CLAUDE_CODE_EXECUTABLE' },
    opencode: { cli: 'opencode', args: ['acp'] },
    copilot:  { cli: 'copilot',  args: ['--acp'] },
    gemini:   { cli: 'gemini',   args: ['--acp'] }
};
```
（`agentLaunch()` 在 `acpAgents.ts:51-69`；对 codex/claude 用 Electron 自身 `ELECTRON_RUN_AS_NODE=1` 跑随包附带的 adapter。）

**Texpile 不提供文件系统或终端给这个 agent**——注释写得很直白：

```
// acpSession.ts:1-3
// One window's conversation with its agent: the agent's process, the ACP connection over its stdin and
// stdout, and one session in the window's folder. The agent reads and writes the folder itself and runs
// its own commands; Texpile offers it no file system or terminal of its own
```

### 2.2 权限（permissions）

agent 每次要动手就发 `session/requestPermission`，Texpile 挂起并把选项推给窗口，等用户点：

```ts
// acpPermissions.ts:9-33
export class PermissionQueue {
    private pending = new Map<string, (response: RequestPermissionResponse) => void>();
    ask(request) { const id = randomUUID();
        return new Promise((resolve) => { this.pending.set(id, resolve);
            this.emit({ type: 'permission', id, toolCall: request.toolCall, options: request.options }); }); }
    answer(id, optionId) { ... resolve(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } }); }
    cancelAll() { for (const id of [...this.pending.keys()]) this.answer(id, null); }
}
```
`answer` 由 `acpIpc.ts:103-106` ← `preload.ts:559` ← 面板 UI。取消/关窗/agent 退出都会 `cancelAll()`（`acpSession.ts:220-225,246-251,259-265`），保证不会有请求永远挂着。

### 2.3 回合快照（turn snapshots）

不看 agent 的自述，直接对磁盘做前后全量文本快照：

```ts
// turnSnapshot.ts:1-3
// The project's text files as a turn started, so its end can say which files the agent changed and what
// each held before. Read from disk rather than taken from the agent's reports: a report shows a hunk, not
// the whole file, and a file changed by a command the agent ran is never reported at all
```
- 覆盖扩展名集合含 `typ`：`tex ltx sty cls dtx ins bib bst bbx cbx typ md markdown txt csv tsv json yaml yml toml lua py r jl m sh`（`turnSnapshot.ts:9-11`）。
- 预算：单文件 1 MB、总计 40 MB、最多 20000 项，且只收 UTF-8（`turnSnapshot.ts:12-15,60-76`）；`complete:false` 时新增/删除判定会被抑制以免误报（`turnSnapshot.ts:119-135`）。
- 增量：上一回合的快照借出未变文件（按 size+mtime），所以第二回合不必重读整仓（`turnSnapshot.ts:52-78`）。
- 回合结束后 `changesBetween()` 产出 `{path, kind:'modified'|'added'|'deleted', before}`（`acpSession.ts:173`），渲染进程据此渲染 “Changed by {agent}” / Revert（`docs/ai-assistant/agent-panel.md:22-26`）。

### 2.4 ownWrites：把「读者自己的写」从 agent 的改动里摘出去

```ts
// ownWrites.ts:1-3
// Texpile's own saves and file operations, told to whoever has to tell them apart from an agent's: what the reader
// typed, deleted or renamed while a turn ran is not the agent's change, and Revert must not take it back
```
- 采集点全在 `fsIpc.ts`：写文件（`:60` `noteOwnWrite`）、create/rename/delete（`:68,106` `noteOwnFileOp`）。
- 回合中把这些事件按发生顺序记进 `own[]`（`acpSession.ts:144-146`），回合结束后**把 before 快照改写成「Texpile 自己留下的状态」**，于是读者打的字不会被算成 agent 的改动：
```ts
// acpSession.ts:160-172
for (const change of own) {
    ...
    if (change.kind === 'write') { if (after.files.has(rel) || (before.found.has(rel) && !after.found.has(rel))) startFrom(before, rel, change.text); }
    else if (change.kind === 'remove') startWithout(before, rel);
    else if (change.kind === 'add') startAdded(before, after, rel);
    else { ... startMoved(before, rel, to); }
}
```
对应纯函数在 `turnSnapshot.ts:80-117`（`startFrom / startWithout / startMoved / startAdded`）。

### 2.5 两个方向的闭环

```ts
// acpIpc.ts:20-36
/** Texpile's own tools for every agent the tab starts, from the first until the app quits. Not the MCP
 *  server in Preferences: see startPrivate */
privateMcp ??= Promise.all([import('../../mcp/server.js'), import('../../ipc/mcpIpc.js')])
    .then(([server, ipc]) => server.startPrivate(ipc.mcpHost()))
```
```ts
// acpIpc.ts:67-73
const session = new AcpSession({ ...launch, root, version: app.getVersion(),
    mcp: mcp && { url: mcp.url, token: mcp.grant(wc.id) }, emit: (e) => send(wc, e) });
```

于是产生一个**只有该窗口可见**的 MCP 视图：

```ts
// server.ts:189-204  windowScoped()
windows: () => h.windows().filter((w) => w.webContentsId === wcId),
windowFor: () => { const win = own()[0]; return win ? { win, root: h.rootFor(wcId), ownAgent: true } : null; }
```
`ownAgent: true` 一路传到渲染进程，用来把作者署名改成 Agent tab 里运行的那个 agent（`relay.ts:14` → `mcpComments.ts:48-52`：`if (a.ownAgent === true) return runningAgentName(...)`）。

### 2.6 方向判断（对 DSH 的意义）

- **Texpile 的定位是 host**：它驱动 agent（ACP 出站），并给被驱动的 agent 一个受控的「编辑器感官」（MCP 入站，token 化、单窗口、author 已定）。
- 反向（**agent 驱动 Texpile**）被有意做成**弱能力面**：`server.ts:8-11` 明说「The connected agent already has its own file tools and is better at using them; what it cannot get any other way is the editor's state... Its one change to a document is suggest_edit」。
- 所以对 DSH：**指望通过 MCP 写 Typst 稿件是走错门**。要么 DSH 自己写盘（Texpile 的 watcher 会接住外部改动，`fsWatch.ts:36-40` 对 `.texpile` 例外），要么把 DSH 做成 Texpile 的 ACP **agent**（此时 DSH 会拿到 `cwd` + 私有 MCP endpoint + 用户逐条授权的权限模型 —— 但那是「Texpile 启动 DSH」，需要 DSH 侧实现 ACP agent 端）。

---

## 3. `.texpile/` 到底装了什么，格式有没有文档

### 3.1 目录内容

| 路径 | 内容 | 是否进 git |
| --- | --- | --- |
| `.texpile/config.json` | 项目编译/主文件/拼写/检查项配置 | ✅（允许清单内） |
| `.texpile/comments.jsonl` | 追加式评论/建议事件日志 | ✅ |
| `.texpile/snippets.json` | 项目级代码片段 | ✅ |
| `.texpile/packages/*.json` | 项目级「用户包文件」（宏知识补丁） | ✅ |
| `.texpile/figures/` | 绘图/图表缓存的图 | ❌（不在允许清单，`docs/typst/drawings.md:18`、`docs/latex/drawings.md:56`） |
| `.texpile/.gitignore` | 上述允许清单本体，由 App 播种 | ✅ |

允许清单是**白名单**，其余一律忽略：

```
// texpileDir.ts:20
const IGNORE_BODY = '*\n!.gitignore\n!comments.jsonl\n!config.json\n!snippets.json\n!packages/\n!packages/*.json\n';
```
`ensureTexpileIgnore()` 只会在「不存在」或「内容逐字等于历史播种版本」时写入，用户手改过的永不覆盖（`texpileDir.ts:22-28,54-68`）。`texpilePath()` 拒绝非绝对根（把访问者 `session` 这种哨兵根挡掉，`texpileDir.ts:30-41`）。

「哪些文件由 Texpile 托管」的谓词与用途分类在 `managed.ts:8-13,24-33`（Source Control / diff 里的提示文案靠它区分 comments/config/ignore）。

### 3.2 `config.json` 的 schema（**仅存在于代码**）

```ts
// projectConfig.ts:32-46
export type ProjectConfig = {
    v: 1;
    main?: string;                       // root-relative，扩展名即决定 typesetter（.typ→Typst）
    completionMarker?: boolean;
    latex?: { command?, outputs?: {pdf?,log?}, liveMode?: boolean };
    typst?: { command?, outputs?: {pdf?,log?}, preview?: boolean };
    spelling?: { language: SpellLanguage };
    checks?: Record<string, boolean>;
};
```
- 读取逐字段消毒、`v !== 1` 直接视为不可读、坏字段当「未写」而不是回写纠正（`projectConfig.ts:94-130`）；`main` 必须是 root-relative 且 `.tex|.typ`（`:115`，防 `"../../outside"` 走进 `{main}`）。
- **`command` 有信任闸门**：注释解释「克隆仓库即执行任意 shell」的风险，命令必须在本地被接受一次（`projectConfig.ts:9-14`；执行侧 `compilePipeline.svelte.ts:145-152` 说明为什么把闸门放在入口而不是按钮）。
- 写入用 tab 缩进 + 尾换行，且先 `ensureTexpileIgnore`（`projectConfig.ts:132-142`）。

### 3.3 `comments.jsonl` 的格式（**仅存在于代码**）

```ts
// comments/log.ts:15
export const LOG_VERSION = 1;
// comments/log.ts:25-50
export type CommentEvent =
    | { v, at, by, t: 'open', id, file, body, anchor, restore? }
    | { v, at, by, t: 'reply', id, thread, body }
    | { v, at, by, t: 'resolve', thread, resolved, decision? }
    | { v, at, by, t: 'delete', thread }
    | { v, at, by, t: 'edit', message, body }
    | { v, at, by, t: 'delete-message', message }
    | { v, at, by, t: 'move', from, to }
    | { v, at, by, t: 'anchor', thread, anchor, file?, restore? }
    | { v, at, by, t: 'place', thread, detached?, hidden? };
```
- 为什么不是 JSON 数组：**要能被 git 按行合并**（`comments/log.ts:3-11`）。
- 解析是「跳过不可读行」而非抛错（`comments/log.ts:82-102`）；`serializeLog` 一行一 JSON（`:104-106`）；`foldLog` 折叠成线程并按打开顺序（`:108+`）。
- `place` 事件是「观察」而非「决定」，只在答案变化时写（`comments/log.ts:42-50`）。
- 存储位置与可见性：文件树看不到（`skipDir` 跳过点目录），但 watcher 特意豁免 `.texpile` 以便 `git pull` 带回的日志能热加载（`store.svelte.ts:1-11`）。

### 3.4 文档覆盖情况（这是缺口）

**有的**：
- MCP 功能页 `docs/ai-assistant/mcp.md`（开关、端口、Show Instructions、无密码提示、改端口）。
- MCP 工具全表 `docs/ai-assistant/mcp-tools.md`（17 个工具 + `by/prefix/suffix/line` 语义 + `suggest_edit` 的拒绝条件）。
- Agent tab 使用页 `docs/ai-assistant/agent-panel.md`（含 Revert 语义、“Revert 覆盖 ≤1MB 文本文件、直到关闭窗口”）。
- 总览 `docs/ai-assistant/README.md`（各 agent 支持矩阵、“Texpile includes no AI”）。
- 隐私清单 `docs/reference/privacy.md:26-36`（MCP 行明确写「A connected assistant can read your open files, cursor position, unsaved changes, errors and comments」）。
- 营销站只有一行：`landing/src/lib/features.ts` 的 MCP 卡片 + `landing/messages/en.json` `feature_mcp_*`。`landing/` 不是文档源，文档正文在 `docs/`（`landing/src/lib/docs/*.server.ts` 负责渲染 markdown）。

**没有的**：
- **没有任何页面描述 `config.json` 的字段**（docs 里只有 `spell-check.md:32` 一句“存在 `.texpile/config.json`”，`docs/projects/README.md:21` 一句“保存选择/构建设置/评论”）。
- **没有任何页面描述 `comments.jsonl` 的行格式**（`docs/comments/README.md:22`、`suggesting.md:14` 只讲“在隐藏文件夹里/要提交”）。
- 结论：**外部工具（含 DSH 插件）若想读写这两个文件，只能读源码**（`projectConfig.ts:32-46`、`comments/log.ts:25-50`）。这也解释了 MCP INSTRUCTIONS 里为什么反复警告「Never write comments.jsonl yourself」（`tools.ts:53-54`）。

---

## 4. Agent-facing Typst 工作流的缺口（基于 tools.ts 的 17 个工具）

工具清单：`get_editor_state`、`get_unsaved`、`get_diagnostics`、`open_file`、`show_diff`、`set_view_mode`、`synctex_to_line`、`set_main_file`、`compile`、`get_compile_config`、`set_output_paths`、`get_comments`、`add_comment`、`reply_to_comment`、`resolve_comment`、`reanchor_comment`、`suggest_edit`。

以下按「没有人类盯屏幕」这一前提列出，每条都给证据。

### 4.1 无头能力：0
见 §1.6。任何真正干活的工具都需要 `BrowserWindow`（`tools.ts:90-92`）。无人值守 = 无法编译、无法读诊断。

### 4.2 没有「读文件」类工具（也没有批量读）
- 设计如此：agent 自带 fs 工具（`server.ts:8-11`、`tools.ts:26-27`）。
- MCP 只能给出**编辑器特有的增量信息**：`get_unsaved` 返回活动文件 + 其它脏 buffer（`mcpCommands.ts:75-91`）。
- 缺：`read_files(glob)`、目录树、全仓搜索、行区间读。一个大稿件的“通读一遍”只能靠外部 fs 工具，而它读不到未保存 buffer → 必须先 `get_unsaved` 再对齐（这正是 INSTRUCTIONS `tools.ts:29-31` 要求的行为，属于「靠提示词弥补工具缺失」）。

### 4.3 没有结构 / 大纲 / 语义查询工具
- 编辑器**已经有** Typst 大纲实现（基于自研 wasm parser，不靠 tinymist）：
  ```ts
  // apps/texpile-editor/src/lib/languages/typst/outline.ts:13-25
  export function typstOutline(tree: Tree, src: string): TocItem[] { /* 遍历 Heading 节点，读 HeadingMarker 深度 */ }
  // outline.ts:45-47
  export async function typstSourceOutline(src: string): Promise<TocItem[]> { return typstOutline(await typstTreeOf(src), src); }
  ```
  还有 Visual 侧大纲插件（`languages/typst/visual/plugins/outline/*`）与 `projectIntel` 里的 `typstOutlines`（`stores/projectIntel.ts:82,114`）。
- **但它没有任何 MCP 出口**：`get_editor_state` 只给 `mainFile/activeFile/viewMode/tabs/cursor/selection/livePreview`（`windowState.ts:19-37`）。→ agent 无法问“这稿子有几节、标题是什么、第 3 节在哪一行、有多少图/表/公式/`<label>`、引用关系如何”。
- 也没有 `typst query` 类能力（查 `<label>`、`ref` 解析结果、页码映射）。

### 4.4 Typst 的诊断/编译语义在 MCP 层被 LaTeX 假设污染（最实质的 bug 面）
- `get_diagnostics` 只读 `compileLog`，而注释自己承认 **live 模式不写 .log**：
  ```ts
  // mcpCommands.ts:110-114
  // Live mode does NOT write this: its incremental engine keeps its own diagnostics and never
  // touches a .log. So what is here is whatever the last SHELL compile left behind - or, if there
  // hasn't been one, the .log found sitting in the folder when it was opened, which can be
  // arbitrarily old.
  ```
  Typst 在 Texpile 里的默认路径正是「Preview 代替 compile」（`docs/typst/compiling.md:8`）。此时 Typst 的诊断来自 preview → tinymist，落在渲染进程的 `liveDiags`（`workspaceCompileState.svelte.ts:77` `d.typstPreview().clearLiveDiags()`），**从不进入 `compileLog`**，因此 `get_diagnostics` 对 Typst 默认模式几乎必然返回空或陈旧数据。
- `endSignal` 只有 `shell-exit` / `log-quiet` 两种（`mcpCommands.ts:105-109`），对「预览引擎在跑」没有第三种语义。
- `get_editor_state.livePreview` 读的是 **LaTeX 车道**：
  ```ts
  // mcpPublish.ts:94
  livePreview: compileConfig.current.latex.liveMode,
  // mcpCommands.ts:241（get_compile_config）
  live: compileConfig.current.latex.liveMode
  // mcpCommands.ts:333（compile 分支）
  const live = compileConfig.current.latex.liveMode;
  ```
  而 Typst 自己的开关是 `compileConfig.current.typst.preview`（`projectConfigSync.svelte.ts:41-50`，默认 `preview: true`；专用 helper `latexLiveMode()` 在 `:64-66` 会按格式 gate，但 MCP 三处都没用它）。执行侧确实按格式分流：
  ```ts
  // compilePipeline.svelte.ts:190-205
  // Live mode IS the incremental lualatex pipeline, so it cannot serve a Typst project...
  if (mode === 'normal' && compileConfig.current.latex.liveMode && !isTypstCommand(cmd)) { ... }
  if (mode === 'normal' && compileConfig.current.typst.preview && isTypstCommand(cmd)) { this.deps.openTypstPreview(); ... }
  ```
  → **对一个默认配置的 Typst 项目，`get_editor_state` 会说 `livePreview:false`，`compile` 会回 `mode:'terminal'` 并让 agent「轮询 get_diagnostics 等 shell 编译结束」，而实际上根本没有 shell 编译在跑**。这是 Typst agent 会被系统性误导的点。

### 4.5 没有 Typst 导出（PDF/PNG/SVG/HTML）
- 能力存在：`EXPORT_FORMATS = ['pdf','png','svg','html']`（`languages/typst/export/exportOptions.ts:14`），`exportCommandFor()`/`runTypstExport()` 一整套（`exportCommand.ts:56`、`runTypstExport.ts:32`）。
- 但落地必须走**原生对话框**：
  ```ts
  // exportTargetIpc.ts:18-34
  handleFsE('shell:pickExportTarget', async (e, body) => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined!;
      ... dialog.showSaveDialog(win, ...) / dialog.showOpenDialog(win, ...)
  ```
  → 无人值守无法导出；“把成稿给我”这件事 MCP 做不到。

### 4.6 没有页级/几何信息
- 页数只在 `diagnosticsPayload` 的 `status.pages` 里，且来自 LaTeX `.log` 解析（`mcpCommands.ts:121-136`）。Typst 无 .log → **无页数、无页面尺寸、无“表格是否溢出”的判断依据**。
- 无「渲染某一页为图片」的工具（PDF pane / preview 都是渲染进程 UI 状态）。

### 4.7 `compile` 是「发射后不管」，且没有配套的停止/等待
- 返回即 `started:true`，`tools.ts:273-288` 明确“reply is NOT a result”，只能轮询。
- 没有 `stop_compile` / `wait_for_compile` / 进度订阅：UI 有 `stopCompile()`（`compilePipeline.svelte.ts:75-78`）但未暴露到 MCP。

### 4.8 唯一的写入口很窄，且对 Typst 语义照顾不足
```ts
// mcpSuggestEdit.ts:24
if (!loaded || relativeTo(root, loaded) !== rel) return fail('suggestions go into the open file; open this one with open_file first');
// mcpSuggestEdit.ts:18
if (collabHost.active) return fail('suggestions are off while this window hosts a shared session');
```
- 一次只能改一个已打开文件的一处引文（quote 必须**逐字**命中，`mcpSuggestEdit.ts:29-32`，且 `found !== quote` 时直接拒绝，不做模糊替换），建议靠人接受（`get_comments` 里 `suggestion` 字段，`commentTools.ts:34-36`）。
- 校验只覆盖 LaTeX 语义：引文 key 存在性、`\label` 丢失（`agentEditProblem(...)`，`mcpSuggestEdit.ts:33-39`）。→ 对 Typst 的 `@cite`/`<label>`/`#ref` 没有对应守卫，而对「改写一句就 detach 其评论线程」的警告只是提示词（`tools.ts:49-58`）。
- `suggest_edit` 无法批处理（没有 `suggest_edits` 数组版），一个 20 万字的稿子每一句都要一次往返（且每次 10s 超时上限，`suggestTools.ts:34`）。

### 4.9 其它缺失
- **无 undo/回滚**：git、local history、`revertChange` 都在 UI 侧（`agentChanges.ts:26`），MCP 无出口 → agent 自己的破坏性操作没得退。
- **无多人协同感知**：`get_unsaved` 的 `others` 来自 `collabHost.unsavedFiles()`（`mcpCommands.ts:85-88`），但协同是否在托管/被托管、锁、冲突，没有专门工具（只在 `suggest_edit` 里硬失败）。
- **单文件窗口会拒绝所有项目级工具**：`PROJECT_REQUESTS = {'set_output_paths','main_file','compile','show_diff'}` + diff（`mcpCommands.ts:302-315`，`LONE_FILE` 文案 `:305`）。
- **`root` 是唯一的多窗口选择器**，且没有「列出可操作 workspace 是哪一个」之外的能力（`get_editor_state` 给 `root/focused`，`windowState.ts:33-37`）。
- **提示词与 Typst 现实不一致**：INSTRUCTIONS 开篇「Texpile is a local, offline LaTeX editor」（`tools.ts:21`），示例路径写 `.tex`（`tools.ts:153`、`commentTools.ts:59`），只在 `set_main_file`/`synctex_to_line` 的描述里提到 `.typ`（`tools.ts:246-251,225-226`）→ 客户端模型会默认按 LaTeX 行事。

### 4.10 一句话总结
现有 MCP 面 = **「编辑器遥测 + 视图方向盘 + 评审意见簿 + 单点建议」**。它刻意把「写文件、编译、读源码」留给 agent 自己的工具。对「无需人盯屏的 Typst 论文写作 agent」而言，缺口集中在四件事：**(1) 不能无头运行；(2) 没有 Typst 结构/大纲/语义查询；(3) Typst 的诊断与导出通道不存在（现有 diagnostics 语义绑定 shell compile）；(4) 写入只能极小粒度地征求人类同意，无法批量。**

---

## 5. LICENSE：三种用法的义务

### 5.1 事实

| 对象 | 许可 | 证据 |
| --- | --- | --- |
| 仓库根 `LICENSE` | **AGPL-3.0** 全文（661 行） | `LICENSE:1-2` |
| 安装包随附许可 | 同一份 AGPL 文本 | `electron-builder.yml:202` `license: build/license.txt`；`build/license.txt:1` |
| 根 `package.json` | **无 `license` 字段**（`private: true`） | `package.json:1-10` |
| `apps/texpile-editor` | **无 `license` 字段**（`private: true`） | `apps/texpile-editor/package.json:1-4` |
| `packages/mathlive` | **MIT** | `packages/mathlive/package.json:6`；`packages/mathlive/LICENSE.txt:1`（"Copyright (c) 2017 - present Arno Gourdol"） |
| `packages/typst-syntax-wasm` | **Apache-2.0**（清单声明） | `packages/typst-syntax-wasm/package.json:7`；`Cargo.toml:5`；**但目录内无 LICENSE 文件** |
| 商标 | 单独政策，**不随 AGPL 授权** | `TRADEMARK.md:6-8` |
| 营销站 `landing/` | 无 `license` 字段 | `landing/package.json:1-4` |

第三方（`ACKNOWLEDGEMENTS.md:3-13`）：MathLive(MIT, 定制 fork)、LaTeX Workshop(MIT, 数据)、pdf.js(Apache-2.0)、Typst(Apache-2.0, 符号表)、tinymist(Apache-2.0)、VS Code(MIT, 终端)、Unicode UCD(Unicode License v3)、Detexify(MIT)。

`packages/typst-syntax-wasm` 的关键事实：**不 fork Typst**，`typst-syntax = "0.15"` 直接来自 crates.io（`Cargo.toml:12-19`、`lib.rs:5-7`），产出已提交的 `pkg/texpile_typst_syntax_wasm_bg.wasm`（273 KB）。作者另行声明「Inspired by kxxt/codemirror-lang-typst (Apache-2.0)」（`lib.rs:16-18`）。

### 5.2 (a) DSH 通过 MCP 与 Texpile 对话

**义务：几乎没有（对 Texpile 的代码而言为零）。**
- AGPL 的传染性绑定在「修改/衍生 + 传播（convey）」上；通过 HTTP 调 17 个工具，属于**进程间协议交互**，不构成衍生作品。DSH 只需自己的许可。
- AGPL §13（网络交互须提供 Corresponding Source）的义务落在**传播 Texpile 的那一方**，即 Texpile 官方或分叉者；DSH 若只是客户端，**不承担**。
- 商标面是允许的：`TRADEMARK.md:15` 明确“你可以无需询问地陈述你的项目与 Texpile 协作/互通”，因此 “DSH 支持连接 Texpile” 这类描述合规；但不能暗示背书（`TRADEMARK.md:19-20`）。
- 工程注意（非许可）：
  - 服务默认关闭（`appSettings.ts:44`），需用户手动开启；文档层面 DSH 应给出同样的引导（`docs/ai-assistant/mcp.md:13-18`）。
  - 端口固定 7317/7318，冲突时 App **不会**换端口而是报错（`server.ts:138-147`），所以 DSH 必须要能读 endpoint 文件或让用户配置（`docs/ai-assistant/mcp.md:22-24`）。
  - 无鉴权、仅 Origin 白名单（`server.ts:76-92`）：本机任何进程都能连——DSH 无需处理凭证，但也不该把该端点当“可信沙箱”。
  - 同一时刻可能多窗口：用 `root` 而非焦点选择（`mcpIpc.ts:25-31`）。

### 5.3 (b) 把 Texpile 代码 vendored / fork 进 DSH 插件

**义务：AGPL-3.0 会覆盖你的插件。** 具体：

1. **许可与源码**：你分发的插件（作为衍生/合并作品）须整体以 AGPL-3.0（或兼容）授权，并向接收者提供完整 Corresponding Source（含你的修改）。`private: true` 只表示不发布到 npm，不改变 AGPL 义务（`package.json:4`）。
2. **保留声明**：保留版权与许可文本；标注修改（AGPL §5）。
3. **§13 网络条款**：若该插件以 SaaS/托管形式让远程用户通过网络使用，须向这些用户提供源码获取方式（LICENSE 末尾的 “How to Apply” 段也重复了这一点）。
4. **商标（这条最容易踩）**：
   - `TRADEMARK.md:21-22`：“Distribute a modified version of Texpile under the Texpile name or logo” 需书面许可；“Forks are welcome under the AGPL; give yours its own name and icon, and note that it is derived from Texpile.”
   - 即：**改了就换名换图标 + 注明衍生自 Texpile**，不要用 `Texpile`/近似名做产品名、域名、应用商店条目（`TRADEMARK.md:23-24`）。
   - 品牌资产在 `branding/`（`TRADEMARK.md:3-5`），不能一并搬走。
5. **实务建议**：
   - 若必须闭源，唯一正路是**单独授权**（`TRADEMARK.md:26-28` 与 `package.json:8` 给了 support@texpile.com）；仓库里**没有** CLA、也没有 dual-license 声明，所以只能谈。
   - 想降低传染面：把 Texpile 保持为**独立进程/独立安装**（走 (a)），DSH 侧只写适配层；这在工程上也更省事（见 §1.6：MCP 本来就离不开 Electron 进程）。
   - 注意「哪些文件算 Texpile 代码」不能按目录猜：`projectConfig.ts`、`comments/log.ts`、`mcp/*.ts`、`texpileDir.ts` 全是 AGPL；只有 §5.4 那两个包另有声明。

### 5.4 (c) 只复用 `packages/typst-syntax-wasm` 或 `packages/mathlive`

**这是最干净的一条路，两个包各自的清单声明了宽松许可**（Apache-2.0 / MIT），不是 AGPL。

- **`packages/mathlive`（MIT）**
  - 义务：保留版权与许可声明（`LICENSE.txt` 全文随产物分发即可），无源码公开要求、可闭源、可商用、可再许可。
  - 注意它是 **MathLive 0.110.0 的定制 fork**（`packages/mathlive/package.json:5`）：你复用的是「MIT 原文 + Texpile 的修改」，两者同为 MIT，合规成本相同；但它只是「让 MathLive 读写 Typst 数学」的补丁（`description` 字段），依赖 `texpile-typst-syntax-wasm`（`:45`）。
- **`packages/typst-syntax-wasm`（Apache-2.0）**
  - 义务：保留许可与版权声明；**标注你做的修改**（Apache-2.0 §4(b)）；如上游有 NOTICE 需随附（此处无 NOTICE 文件）；**不含商标授权**（Apache-2.0 §6），所以别用 Texpile 名号。
  - 传染性：与 DSH 的许可兼容（Apache-2.0 可被并入闭源产品，只需满足上述告知义务）。
  - 上游链条干净：`typst-syntax` 0.15（Apache-2.0，crates.io 未打补丁，`Cargo.toml:12-19`）+ `wasm-bindgen`；提交进仓库的 `.wasm` 是它的二进制产物，一并按 Apache-2.0 处理即可。
- **两个必须点明的模糊处**（这是本文最需要“确认”的地方）：
  1. 仓库根只有 AGPL 全文（`LICENSE:1-2`），**两个子包都没有自己的 LICENSE 文件**（`mathlive` 有 `LICENSE.txt`，`typst-syntax-wasm` 没有），依据只有 `package.json`/`Cargo.toml` 的 `license` 字段。若按“仓库级单一许可”解释，AGPL 会覆盖整个 workspace。
  2. `private: true` + 无发布记录，说明这两个包是内部件，作者未必想过被外部复用。
  → **建议动作**：复用前向 support@texpile.com 取一句书面确认（“packages/typst-syntax-wasm 以 Apache-2.0、packages/mathlive 以 MIT 对外提供”），并把该确认与 commit hash 一起归档。成本极低，收益是把“解释风险”归零。
- 边界提示：如果 DSH 想要的不只是 wasm 解析器，而是 `outline.ts`（Typst 大纲逻辑）、`mcpCommands.ts`（工具语义）、`projectConfig.ts`（config 解析），**这些都在 AGPL 侧**，不能因为“挨着 typst-syntax-wasm”就顺手拿走。

### 5.5 非宽松依赖与 vendored 代码体检

- **`vendor/`**：只有 `README.md` 与 `tinymist.json`；**二进制不入库**，运行时从 `dl.texpile.com/vendor/<tool>/<version>/` 下载并校验 SHA-256（`vendor/README.md:1-11`）。tinymist 上游 Apache-2.0，发布时随附其许可（`vendor/README.md:10`）。→ 不构成 AGPL 传染源。
- **Lua**：`electron/lua/` 下 6 个文件（`draw-loop.lua`、`package-probe.lua`、`page-extract.lua`、`texd-loop.lua`、`tikzcap.lua`、`walker.lua`）。逐个看头注释，全部是 Texpile 自研（“the figure engine's loop…”、“Writes every SHIPPED PAGE's walker records…”、“The warm daemon's request loop…”），**没有第三方版权头**。→ 不存在 vendored copyleft Lua。
- **唯一明确的非宽松项：拼写词典** —— `ACKNOWLEDGEMENTS.md:13`：
  > German, Spanish, European Portuguese and Polish **LGPL-3.0**; Italian and Brazilian Portuguese **GPL-3.0 or later**; French and Dutch MIT. They are converted to CSpell's binary format at build time, and each ships with its license as `spell/<language>.LICENSE.txt`.
  - 这是全仓最强的 copyleft。若 DSH 的 fork 一并打包这些词典数据，**至少**要保持 `spell/<lang>.LICENSE.txt` 随附、并把词典数据与自身代码在分发上保持可分离（LGPL 的惯常做法）。
  - 工程规避：DSH 插件不打包词典，或只装 MIT 的 fr/nl，或用用户自备词典。
- **其它 vendored 资产**（`ACKNOWLEDGEMENTS.md:5-12`）全是 MIT / Apache-2.0 / Unicode License v3，且各自带许可文件：
  `apps/texpile-editor/src/lib/terminal/VSCODE-LICENSE.txt`、`.../typst/symbols/UNICODE-LICENSE.txt`、`.../latex/symbols/DETEXIFY-LICENSE.txt`、`.../latex/intellisense/data/VENDORED-LICENSES.md`。
- **范围声明**：以上基于仓库内声明与随附许可文件；**未审计 `node_modules`**（本 checkout 未安装依赖），若 DSH 直接复用 `apps/texpile-editor` 的依赖清单，需要另跑一次许可证扫描（`apps/texpile-editor/package.json:61-111` 里有 `pdfjs-dist`、`harper.js`、`prosemirror-*`、`yjs` 等，均为常见宽松许可，但未逐一验证）。

### 5.6 三句话版

| 做法 | AGPL 是否覆盖你的产物 | 你要做的事 |
| --- | --- | --- |
| (a) 走 MCP | 否 | 无需 Texpile 许可；可事实性声明“支持 Texpile”；处理好开关/端口/多窗口 |
| (b) vendor/fork 代码 | **是** | 整插件 AGPL + 提供源码（含 §13）+ 保留声明 + **改名换图标并注明衍生**，否则需商业授权 |
| (c) 只用两个包 | 否（MIT / Apache-2.0） | 保留版权与许可文本；Apache 侧标注修改；不用其商标；**建议先取书面确认** |

---

## 6. 仓库里有没有 headless / CLI / daemon 模式？

**结论：没有面向外部的 headless/CLI/daemon 模式。** 逐项排查：

| 排查点 | 结果 | 证据 |
| --- | --- | --- |
| `bin` 入口 | **全部为空**（5 个 package.json 均无 `bin`） | 实测 `bin= license= private=True` 等；`package.json:1-11`、`apps/texpile-editor/package.json`、`packages/*`、`landing/package.json` |
| stdio MCP 服务 | 无（`StdioServerTransport`/`pipeTransport` 0 命中） | 全仓 grep |
| `--headless` / `--cli` / daemon 标志 | 无（`headless` 仅出现在测试文档） | `apps/texpile-editor/tests/live/README.md:4`（Playwright/headless Chromium 测试） |
| CLI 参数 | 仅「打开文件/文件夹/加入共享会话」，且**仍会创建窗口** | `main.ts:120-145`（`fileFromArgv`/`folderFromArgv`/`linkFromArgv`）、`:198-229` |
| 单实例 | 有锁；第二次启动把路径路由给已有实例 | `main.ts:179-196` |
| `scripts/` | 仅构建/打包 | `scripts/build-electron.mjs`、`after-pack.cjs`、`set-version.mjs`、`make-icns.py` |
| `tools/` | 仅一个 Cloudflare Worker（下载重定向统计），与编辑器无关 | `tools/dl-worker/{wrangler.toml,src/index.ts}`（`:187` 处 302 到 `dl.texpile.com`） |
| `electron/src/helper/` | **不是** CLI，而是 Electron `utilityProcess` 子进程，跑 git/watch | `helperProcess.ts:26-29` `utilityProcess.fork(helperWorker.js)`；`helperCall` 经 `postMessage` |
| `electron/src/draft/draftDaemon.ts` | **不是**外部 daemon，而是 App 内的「常驻 lualatex」暖进程（stdin/stdout 一次一块） | `draftDaemon.ts:1-4` |
| 退出语义 | Windows/Linux：最后一个窗口关闭即退出（MCP 一并停止）；macOS：进程可存活但无窗口 | `main.ts:279-281`；`deferredIpc.ts:80-86` |

补充事实：`electron/src/ipc/deferredIpc.ts` 把 MCP 服务器放在**启动队列最后一步**（`:56-64`，注释「nothing in the UI waits on it」），并且不是所有启动路径都会跑到它——`main.ts:271-272` 是「`did-finish-load` 后立即」或「3s 后」兜底，所以**刚启动的几秒内端口可能还没开**，客户端会看到 connection refused。这对 DSH 的探活逻辑是必须处理的现实。

---

## 附录：给 DSH 的落地建议（基于以上事实）

1. **不要指望 headless**：DSH 的 Typst 工作流若需要「编译 → 读诊断 → 导出」，必须自带 `typst compile`（CLI）能力或自带 tinymist；Texpile 只在人开着它时提供编辑器状态。二者可以并用：**DSH 负责编译/写文件/导出，Texpile 负责人看的那份实时预览与建议评审**。
2. **把 MCP 当「上下文增强」而不是「执行面」**：`get_editor_state`（+ `get_unsaved`）能让 DSH 知道用户正在看哪一行、有没有未保存改动，避免写出与 buffer 冲突的修改（`tools.ts:29-31`）。
3. **Typst 项目要绕开 `compile`/`get_diagnostics` 的 LaTeX 假设**（§4.4）：优先用 DSH 自己的 `typst compile` 读 stderr，而不是依赖 `get_diagnostics`。
4. **写入策略**：机械改动直接写盘（Texpile watcher 会接住，`fsWatch.ts:36-40`），需要作者过目的措辞改动走 `suggest_edit`（但注意单文件/单引文/需打开/协同中禁用四条限制）。
5. **许可上优先 (a) 与 (c)**；(b) 只在愿意整插件 AGPL 或拿到商业授权时考虑；无论哪条，`it`/`pt-BR` 的 GPL 词典不要一起打包。

---

### 引用索引（核心）

- MCP 托管：`electron/src/mcp/server.ts:21-40, 53-54, 76-92, 101-116, 118-151, 153-179, 189-204, 206-236`
- MCP 工具：`electron/src/mcp/tools.ts:20-59, 61-92, 94-347, 349-350`；`commentTools.ts:17-128`；`suggestTools.ts:7-36`；`relay.ts:10-19`；`toolReply.ts:4-16`
- IPC 桥：`electron/src/mcp/bridge.ts:36-53`；`electron/src/ipc/mcpIpc.ts:12-53`；`electron/src/preload.ts:70-75, 151-167`；`apps/texpile-editor/src/lib/workspace/mcpCommands.ts:307-379`
- 窗口状态：`electron/src/mcp/windowState.ts:10, 19-37, 42-77`；`apps/texpile-editor/src/lib/workspace/mcpPublish.ts:72-113`
- 启动/退出：`electron/src/ipc/deferredIpc.ts:56-64, 80-86`；`electron/src/main.ts:179-196, 198-229, 271-272, 279-290`
- ACP：`electron/src/ai/acp/acpSession.ts:1-3, 88-135, 137-182, 184-257`；`acpIpc.ts:20-36, 53-129`；`acpAgents.ts:22-69`；`acpPermissions.ts:9-33`；`ownWrites.ts:1-39`；`turnSnapshot.ts:1-135`；`electron/src/ipc/fsIpc.ts:13, 60, 68, 106`
- `.texpile`：`apps/texpile-editor/src/lib/workspace/texpileDir.ts:20-68`；`projectConfig.ts:9-14, 32-46, 94-142`；`comments/log.ts:15-106`；`comments/managed.ts:8-33`；`comments/store.svelte.ts:1-11, 74-77`；`electron/src/fs/fsWatch.ts:36-40`
- Typst 结构/导出：`apps/texpile-editor/src/lib/languages/typst/outline.ts:13-47`；`.../typst/export/exportOptions.ts:14`；`.../typst/export/exportCommand.ts:56`；`electron/src/ipc/exportTargetIpc.ts:18-34`
- Typst 编译/诊断：`apps/texpile-editor/src/lib/workspace/compilePipeline.svelte.ts:114, 145-152, 190-205, 291-295`；`.../workspace/mcpCommands.ts:99-137, 217-243, 328-352`；`.../workspace/projectConfigSync.svelte.ts:41-50, 64-66`；`.../workspace/typstCommand.ts:1-27`
- 许可/第三方：`LICENSE:1-2`；`TRADEMARK.md:3-28`；`ACKNOWLEDGEMENTS.md:3-13`；`packages/mathlive/package.json:5-6`；`packages/mathlive/LICENSE.txt:1`；`packages/typst-syntax-wasm/{package.json:7, Cargo.toml:5-19, src/lib.rs:1-21}`；`package.json:1-11`；`electron-builder.yml:202`；`vendor/README.md:1-21`；`electron/lua/*.lua`（6 个，自研）
- 文档：`docs/ai-assistant/{README,agent-panel,mcp,mcp-tools}.md`；`docs/reference/privacy.md:26-36`；`docs/typst/compiling.md:6-18`；`docs/projects/README.md:21`；`docs/spell-check.md:32`；`landing/src/lib/features.ts` + `landing/messages/en.json`（`feature_mcp_*`）
