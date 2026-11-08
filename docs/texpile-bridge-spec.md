# Texpile × DSH：renderer 桥接适配器实现规格

> **对象**：把 `texpile/apps/texpile-editor`（Svelte 5 + ProseMirror + CodeMirror 的 SPA）放进 DeepSeek Harness 插件里跑，办法是把 `electron/src/preload.ts` 曾经用 `contextBridge.exposeInMainWorld` 注入到 `window` 的那些全局，**重新实现一遍**（下面统称 shim）。
>
> **只读仓库**：`D:\AIWORK\TYPST PAPER WRITE\texpile`（本次未改动任何文件）。所有引用都是 `文件:行号`；`electron/src/...`=Electron 主进程，`apps/texpile-editor/src/...`=渲染进程，`dsh-harness/packages/...`=DSH 源码 checkout `C:\Users\Fisfzy\dsh-harness`（HEAD 与发行版 0.2.2-rc.1 有差异，凡涉及发行版缺失的能力单独标注）。
>
> **未知标记**：`TBD(verify)` = 我未能在源码里确认到确切 API 名/形态，**不臆造**；`无等价` = DSH 宿主能力里确实没有对应物。
>
> **判定口径**（三级，按"缺了会怎样"分，不按"调用了没有"分）：
> - **A｜启动必需**：首帧前后无条件被读，缺失即启动失败或**核心功能静默失效**（最坏的一种）。
> - **B｜功能必需**：渲染器有 `?.` / `if (!x) return` 守卫，缺了不崩，但该功能整块废掉。
> - **C｜可跳过/stub**：整个功能面砍掉（或返回空值）不影响"编辑 Typst/LaTeX 并编译看 PDF"这条主线。

---

## 0. 结论摘要

1. **不是九个全局，是十个**：`preload.ts:5` 还 `import './preloadSnippets'`，后者在 `preloadSnippets.ts:4` 又挂了 `texpileSnippets`。漏掉它，LaTeX 片段补全和"包文件"面会静默空掉。
2. **`window.texpileNative` 实际有 134 个成员**（对象字面量 `preload.ts:43-367` 里 125 个键 + `preload.ts:229-230` 展开的 `drawBridge`(5) 与 `imageBridge`(4)）；而 `fileSystem.ts:136-236` 的 `TexpileNative` 类型只声明了 **74 个（其中 47 个 `?`）**，再 `& GitBridges`（`scm/gitBridges.ts:15-24`，约 44 个全可选）。**类型比现实窄**，照类型实现会漏掉窗口/菜单/MCP 那一圈。
3. **全量 213 个成员：A 类 22、B 类 19、C 类 172**。A 类里 **8 个是 `texpileTerminal`**——因为 **Texpile 的 LaTeX 编译不是"编译 API"，而是往终端 dock 的 shell 里打一条命令行**（`compilePipeline.svelte.ts:95-103` → `terminalDockState.svelte.ts:19` → `Terminal.svelte:98-103`）。想丢终端 = 丢编译。
4. **`texfile://` 确实是单点**：唯一构造器 `fileSystem.ts:420-422`；但**有 3 个解析点**必须同步改（`fileSystem.ts:524-527`、`editor/visual/fileAccess.ts:41-43`、`fileAccess.ts:46-57`），否则图片/PDF 会"显示不出来但也报不出错"。
5. **最危险的不是缺 API，而是 `mtimeMs`**：编译完成判定完全靠 `fsStat().mtimeMs`（`compileWatchers.ts:29-97`、`compilePipeline.svelte.ts:427-435`），而 DSH 的 `ctx.fs.stat` 返回的 `FsInfo` **只有 `version`/`type`/`size`，没有 mtime**（`packages/fs/fs/src/types.ts:76-83`）。这一项必须走插件侧 `node:fs`，不能用 `ctx.fs`。
6. **推荐路由形状**：`/texpile-desk` 静态前缀 + **1 个 `POST /api/rpc`（1:1 映射 `ipcRenderer.invoke`）+ 1 个 `GET /api/file`（取代 texfile）+ 1 个 SSE `/api/events` + 2 个 WS（`/api/pty`、`/api/lsp`）**，外加 3 条站点根资产路由（`/theme-init.js`、`/themes`、`/favicon.svg`）。共 9 条注册，全部同源、全部自己验 `dsh-auth-*`。

---

## 1. 全局清单（`preload.ts` 端到端清点）

### 1.0 事实校正

| 事实 | 证据 |
|---|---|
| 挂载点共 **10** 个 | `preload.ts:43`(texpileNative)、`:370`(texpileUpdates)、`:405`(texpileTypst)、`:499`(texpileZotero)、`:509`(texpileDoi)、`:517`(texpileTemplates)、`:539`(texpileAgent)、`:550`(texpileAcp)、`:576`(texpileTerminal)；加 `preloadSnippets.ts:4`(texpileSnippets)，由 `preload.ts:5` 引入 |
| `texpileNative` 的 `bootstrap` 是**同步**读出来的 | `preload.ts:35-41`（`ipcRenderer.sendSync('window:bootstrap')`），注释 `:30-33` 说明理由：要在首帧前知道"开哪个目录 + settings" |
| 所有 `fs:*`/`git:*`/`templates:*`/`history:*` 走同一个 `invokeFs` 拆包 | `preloadIpc.ts:4-8`：`{ok, value|error}` → 成功返回 `value`，失败 `throw new Error(error)` |
| 渲染器把 `Error invoking remote method 'x': Error:` 前缀**剥掉**再显示 | `fileSystem.ts:290-299`（`ipc()`）——所以 shim 必须返回**裸**错误文本，别自己再加前缀 |
| 事件订阅统一返回 `() => void` 退订函数 | 例 `preload.ts:108-114`、`:588-594`；`open-path/open-folder/join-session` 三个带缓冲 `preload.ts:10-28` |

### 1.1 `texpileNative`（134 成员）

四个块的成员数相加 = 41（会话/设置/窗口）+ 18（文件系统）+ 18（Draft/绘图/图片/导出）+ 57（Git 族）= **134**；其中 125 个是字面量键，另 9 个来自 `preload.ts:229-230` 的两处展开。

#### 1.1.1 会话 / 设置 / 窗口（41）

| 成员 | 签名（preload） | 判定 | 调用点证据 |
|---|---|---|---|
| `bootstrap` | `{open:{kind:'file'|'folder';path:string}|null; settings:Record<string,unknown>}` | **A** | `openWorkspace.ts:18-20`（`bootOpen()`）、`settings.ts:205` 首帧前读 |
| `openFolder` | `() => Promise<string|null>` | **A** | `fileSystem.ts:251-258`（`isDesktop()` 就看它）、`StartView.svelte:56-71` |
| `pickFolder` | `(title) => Promise<string|null>` | B | `toolDirs.svelte.ts:44`、`cloneFlow.ts:66` |
| `pickFile` | `(title) => Promise<string|null>` | B | `toolDirs.svelte.ts:49` |
| `getSettings` | `() => Promise<Record<string,unknown>>` | **A** | `settings.ts:200-244`（bootstrap 无快照时的回退） |
| `setSettings` | `(partial) => Promise<Settings>` | **A** | `settings.ts:261-288`（每次改设置都写） |
| `replaceSettings` | `(full) => Promise<void>` | B | `settings.ts:227`（仅迁移时） |
| `setZoomFactor` | `(factor:number) => Promise<number>` | C | `shortcuts.ts:23`（`?.`） |
| `windowGlassWorks` | `() => Promise<boolean>` | C | `chrome/windowGlass.svelte.ts:25` |
| `setWindowGlass` | `(on:boolean) => Promise<boolean>` | C | `windowGlass.svelte.ts:21` |
| `setNativeAppearance` | `(choice) => void` | C | `theme.ts:48,97`（`?.`） |
| `showMessageBox` | `(req) => Promise<number|null>` | C | `modals/confirm.svelte.ts:47,60`（无桥走自绘对话框） |
| `popupMenu` | `(req) => Promise<string|null>` | C | `menus/contextMenu.svelte.ts:64,84`（`nativeContextMenus()` = macOS 且有此桥，`platformSurfaces.ts:7-9`） |
| `mcpStatus` / `mcpSetEnabled` / `mcpPublishState` | 见 `preload.ts:70-75` | C | `PrefsAiPanel.svelte:27`、`settings.ts:297-307`、`mcpPublish.ts:107-112` |
| `onMcpRequest` / `mcpRespond` / `onMcpCommand` | `preload.ts:152-168` | C | `mcpCommands.ts:309,366` |
| `onOpenPath` / `onOpenFolder` / `onJoinSession` | `(cb)=>()=>void` | C | `App.svelte:91-127`（三个 `onMount` 全部 `if (!n?.onOpenX) return`） |
| `claimWorkspace` | `(root, kind?) => Promise<{ok, reason?}>` | **A** | `workspaceStartup.ts:58-64`、`openWorkspace.ts:74-81` |
| `releaseWorkspace` | `() => Promise<{ok}>` | **A** | `folderLifecycle.ts:120`、`openWorkspace.ts:79` |
| `newWindow` / `openFolderNewWindow` | `preload.ts:87,128` | C | `fileSystem.ts:281-288`（`?.`）、`App.svelte:134` |
| `toggleDevTools` / `reloadWorkspace` / `startupMainStats` | `preload.ts:89-93` | C | `paletteFileItems.ts:197-211`、`startupDoctor.ts:62-64` |
| `claimStartupTasks` | `() => Promise<boolean>` | C | `App.svelte:81`（`?? true`） |
| `onBeforeClose` / `closeDecision` | `preload.ts:132-140` | C | `workspaceMount.ts:115-127`（`?.`） |
| `windowMinimize/ToggleMaximize/Close/IsMaximized/SetOverlay/onWindowState/cursorScreenPoint/publishMenuState/onMenuAction` | `preload.ts:98-126` | C | `windowOverlay.ts:92-95`（无桥=no-op）、`shortcuts.ts:80`、`slotDrag.svelte.ts:69`、`nativeMenu.ts:209-225` |

> 说明：`windowChrome` 那一整套在**非 macOS 上本来就不需要**——`windowOverlay.ts:94-95` 明确 `if (isMac || !api?.windowSetOverlay) return () => {}`；在浏览器里 `navigator.windowControlsOverlay` 不存在（`:176-187`），`LayoutControls.svelte:19` 也就画自绘按钮。

#### 1.1.2 文件系统（18）

| 成员 | 签名 | 判定 | 调用点证据 |
|---|---|---|---|
| `fsScan` | `(root, exts?) => {root, files: TexFile[]}` | **A** | `fileSystem.ts:301-307`；`openWorkspace.ts:33`（`fill()` 必调） |
| `fsTree` | `(root) => {root, children}` | B | `diskProvider.ts:62` |
| `fsTreeScan` | `(root, exts?) => {root, children, files}` | **A** | `fileSystem.ts:314-316`；`workspaceStartup.ts:76`→`files.refreshTree()` |
| `fsRead` | `(path) => {content, encoding}` | **A** | `fileSystem.ts:382-390`（`encoding` 是 `latin1/utf16/utf8bom…`，见 `SourceEncoding`） |
| `fsProbe` | `(path) => {size,binary}` | B | `fileSystem.ts:400-403`（`probe?` 缺失返回 null，二进制裁定降级） |
| `fsWrite` | `(path, content) => {ok}` | **A** | `fileSystem.ts:405-407`（自动保存） |
| `fsWriteBinary` | `(path, data:ArrayBuffer) => {ok}` | B | `fileSystem.ts:409-411`（拖入图片/粘贴上传） |
| `filePathOf` | `(file:File) => string` | B | `fileSystem.ts:474-476`（`?? ''`；Electron 32 之后 `File.path` 没了，`preload.ts:179-187`） |
| `fsOp` | `({action:'create'|'delete'|'rename'|'copy'|'restore', …}) => {ok}` | **A** | `fileSystem.ts:326-361`；`compilePipeline.svelte.ts:411-423`（`ensureOutputDir` 建 `output/`） |
| `fsTrash` | `({path,root,keep?}) => {backup,recycled,kept?}` | C | `fileSystem.ts:349-356`（回收站 + 撤销备份） |
| `fsPurgeUndo` | `(root) => {ok}` | **A** | `workspaceStartup.ts:69`（开目录即清） |
| `revealItem` | `(path) => {ok}` | C | `fileSystem.ts:369-371`（`?.`）、`workspaceActionSurfaces.ts:196` |
| `fsSearch` | `(root,q,regex,caseSensitive) => {results,truncated,total?}` | B | `fileSystem.ts:434-444`（Find in Files） |
| `fsStat` | `(path) => {exists,mtimeMs,size,isDirectory}` | **A** | `fileSystem.ts:425-431`；`compileWatchers.ts:29-97` 全靠 `mtimeMs` |
| `fsRealRelative` | `(root,rel) => string|null` | B | `fileSystem.ts:392-397`（`?.`+`catch`） |
| `fsFormatLatex` | `(path,text) => {formatted}` | B | `fileSystem.ts:414-416`（latexindent） |
| `onWorkspaceFsChanged` | `(cb:changes[]) => ()=>void` | **A** | `diskProvider.ts:78-80`→`fileService.use()`（`fileService.ts:32`）订阅磁盘变更 |
| `synctex` | `(body) => Record<string,unknown>` | B | `synctex.ts:34`、`draft/locate/*`（PDF↔源码跳转） |

> 遍历语义必须照抄：`walkIgnoreRules.ts:7-13`（`TREE_IGNORE_DIRS={node_modules,_draft}`、`SCAN_IGNORE_DIRS` 另加 `build/dist/out/output`；点开头目录一律跳过）；`fsWalk.ts:31-32`（**深度上限 12**）；`fsWalk.ts:24-29`（默认扩展名 `tex,typ`）；排序 `scanOrder.ts` + `nameCollator.ts`（tree 高亮按字符串精确匹配，顺序错会掉高亮）。

#### 1.1.3 Draft 模式 / 绘图 / 图片 / 导出的保存对话框（18）

| 成员 | 判定 | 证据 |
|---|---|---|
| `draftCompile` / `draftTypeset` / `draftSkeleton` / `draftStop` / `draftTakeover` / `onDraftPreempted` / `draftSavePdf` | C | `fileSystem.ts:197-242`；只在 `compileConfig.current.latex.liveMode` 为真时进入（`compilePipeline.svelte.ts:193-196`） |
| `drawRender` / `drawCetz` / `drawStop` / `drawRestart` / `drawFile`（`drawBridge`，`electron/src/draw/drawPreload.ts:3-9`） | C | `draw/host/engine/desktopTikzEngine.ts:23,36,42`（`?.`，engine 只在有桥时挂） |
| `imageKeepOriginal` / `imageNoteWritten` / `imageOriginalAt` / `imageRestoreOriginal`（`imageBridge`，`images/imagePreload.ts:3-8`） | C | `images/edit/imageEditSession.svelte.ts:65-164`（全 `?.`） |
| `savePdfBytes` / `pickExportTarget` | C | `PDFViewer.svelte:17,189`（`?? {saved:false}`）、`typst/export/exportTarget.ts:20-28` |

#### 1.1.4 Git / GitHub / 本地历史（57）

`preload.ts:249-366` 共 57 个成员（git 32 + 本地历史 9 + GitHub 8 + clone/publish/askpass 8），**全部 `?.` 守卫**，缺桥时统一走 `errMsg`/`NO_BRIDGE`（`scm/git.ts`、`scm/actions/scmAutoCheck.svelte.ts:42-50`）。SCM 面板会显示"没有桥"，而不是崩。故整体判 **C**（保留则工作量最大的一块，子类型分布见 `scm/gitBridges.ts:15-24`：`git.ts` 11 + `gitCombine` 4 + `gitClone` 4 + `gitVersion` 3 + `gitBranches` 2 + `gitTrust` 1 + `scmFetch` 1 + `scmAutoCheck` 1 + `githubSignIn` 8 + `LocalHistoryBridge` 9）。

> 实现路径明确：全部是 `ctx.subprocess.resolveExecutable('git')` + `spawn({argv:['git',…], stdio:{stdin:'ignore',stdout:{maxBytes},stderr:{maxBytes}}})`（`packages/subprocess/subprocess/README.md:43-53`）。真正贵的是 `onGitAskpass` 那一套（凭据交互），建议 v1 直接砍。

### 1.2 `texpileTerminal`（8 成员）— **整体 A 类**

| 成员 | 签名 | 判定 | 证据 |
|---|---|---|---|
| `available` | `() => {ok, error?}` | **A** | `Terminal.svelte:185-197`（失败→`unavailable`，编译在 `compilePipeline.svelte.ts:207` **静默** return） |
| `spawn` | `({id,cwd?,cols?,rows?}) => {ok,shell?,windowsPty?,error?}` | **A** | `Terminal.svelte:111-131` |
| `write` | `(id, data) => void` | **A** | `Terminal.svelte:101,136,242`（编译命令行就是从这里打进去的） |
| `resize` | `(id, cols, rows) => void` | **A** | `Terminal.svelte:243` |
| `kill` | `(id) => void` | **A** | `Terminal.svelte:311`（卸载） |
| `interrupt` | `(id) => Promise<boolean>` | **A** | `Terminal.svelte:150-155`（Compile 按钮变 Stop 时用；无此桥回退 `\x03`） |
| `onData` | `(cb:{id,data}) => ()=>void` | **A** | `Terminal.svelte:245-270`（**编译输出与完成哨兵都在这里**） |
| `onExit` | `(cb:{id,code}) => ()=>void` | **A** | `Terminal.svelte:271-285`（shell 死→把未完成的 tracked run 结算掉） |

**为什么终端是 A 类**：`compilePipeline.svelte.ts:95-103` 把整条编译命令行丢进 dock 的 shell；完成与否靠 `Terminal.svelte:71-87` 往命令行尾追加哨兵（`; echo '__texpile_done_N__'`，按 shell 名分 cmd/pwsh/POSIX 三种写法），再在输出流里扫到哨兵才算结束（`:245-270`），并把 `stripEscapes` 后的 stdout 交给 `finalizeCompile`（`:258-262`）——dvipdfmx 之类只往 stdout 写诊断。**这条链没有 HTTP 替代品，只能实现 PTY。**

### 1.3 `texpileTypst`（26 成员）

| 成员 | 判定 | 调用点 |
|---|---|---|
| `resolve` | B | `lspClient.ts:66-72`、`toolchainProbe.svelte.ts:34` |
| `startLsp` / `send` / `stopLsp` / `onMessage` / `onExit` | B | `lspClient.ts:74-97`（Transport）、`:315-326`（start）、`:595`（stop） |
| `probeToolchain` / `onProbeResult` / `distros` / `dirForms` | B/C | `toolchainProbe.svelte.ts:26-42`、`toolDirs.svelte.ts:26` |
| `tinymistStatus` / `installTinymist` / `cancelTinymistInstall` / `removeTinymist` / `onTinymistProgress` / `onTinymistFinished` | B/C | `tinymistInstall.svelte.ts:21-53` |
| `texBib` / `packageFiles` | B | `workspaceRefChecks.svelte.ts:25`、`typstProject.ts:7` |
| `preparePreview` / `releasePreview` | C | `TypstPreview.svelte:106-112`（无桥即"仅桌面"提示） |
| `previewPageHtml` / `prepareGuestPreview` / `relayOpen` / `relaySend` / `relayClose` / `onRelayEvent` | C | `previewRelay.svelte.ts:131,193`（协作宿主才用） |

### 1.4 `texpileUpdates`（6）— 整体 **C，建议直接不提供**

`check/download/install/onProgress/onDownloaded/onError`（`preload.ts:370-400`）。渲染器在无桥时 `return 'unsupported'`（`updates.ts:99-107`），`App.svelte:84` 只判 `=== 'update'`，`installNow` 是 `void bridge()?.install()`（`:118-120`）。**删掉这个全局是最省的做法**，UI 自动安静。

### 1.5 `texpileZotero`(3) / `texpileDoi`(4) / `texpileTemplates`(12) / `texpileAgent`(4) / `texpileAcp`(10) / `texpileSnippets`(6)

| 全局 | 成员 | 判定 | 证据与 stub 要点 |
|---|---|---|---|
| `texpileZotero` | `probe`/`search`/`exportBib` | C | `insertFromZotero.ts:22`（`!!window.texpileZotero` 决定入口是否出现）、`ZoteroCitationDialog.svelte:54`（`?.`）。**不提供即可**，入口自动隐藏 |
| `texpileDoi` | `lookup`/`search`/`isbn`/`pmid` | C | `citeByDoi.ts:43,52,69` 同样以"桥在不在"开门 |
| `texpileTemplates` | `list/survey/save/update/remove/apply/stage/adopt/discard/universeIndex/universeThumbnail/universeUnpack` | C | `templateBridge.ts:13-17` **`requireTemplatesBridge()` 会 throw**；但列表路径先问 `userTemplatesAvailable()`（`:20-22`），对话框用 `bridgeErrorText` 兜（`:25-28`）。**最便宜的 stub：`{list:async()=>[], survey:async()=>({}), universeIndex:async()=>({ok:false})}`**，别让 `requireTemplatesBridge` 在"从模板新建"路径上裸抛 |
| `texpileAgent` | `detect`/`models`/`run`/`cancel` | C | `selectionRefiner.ts:43`（`?.`） |
| `texpileAcp` | `detect/start/prompt/cancel/answer/setConfig/chats/openChat/close/onEvent` | C | `acpBridge.ts:18`（`?.`）。Agent 面板整块消失 |
| `texpileSnippets` | `readGlobal/ensureGlobal/locations/onGlobalChanged/readPackages/probePackage` | C | `snippetLoader.ts:21-23`（`?.`）。缺了只是全局片段/包探测空，项目内 `.texpile/snippets.json` 仍走 `fileService`（`snippetLoader.ts:25-29`） |

### 1.6 判定统计

| 全局 | 成员数 | A | B | C |
|---|---:|---:|---:|---:|
| texpileNative | 134 | 14 | 7 | 113 |
| texpileTerminal | 8 | 8 | 0 | 0 |
| texpileTypst | 26 | 0 | 12 | 14 |
| texpileUpdates | 6 | 0 | 0 | 6 |
| texpileZotero | 3 | 0 | 0 | 3 |
| texpileDoi | 4 | 0 | 0 | 4 |
| texpileTemplates | 12 | 0 | 0 | 12 |
| texpileAgent | 4 | 0 | 0 | 4 |
| texpileAcp | 10 | 0 | 0 | 10 |
| texpileSnippets | 6 | 0 | 0 | 6 |
| **合计** | **213** | **22** | **19** | **172** |

- **A 类 22 个**：`bootstrap, openFolder, getSettings, setSettings, claimWorkspace, releaseWorkspace, fsScan, fsTreeScan, fsRead, fsWrite, fsStat, fsOp, onWorkspaceFsChanged, fsPurgeUndo` + 终端 8。
- **B 类 19 个**：`fsProbe, fsWriteBinary, filePathOf, fsRealRelative, fsSearch, fsFormatLatex, synctex` + Typst 12。
- 一句话：**要"能开目录、能编辑、能保存、能编译看 PDF"，就得实现 22+19=41 个方法；其余 172 个可以整体不提供。**

---

## 2. 路由契约：`/texpile-desk/api/*`

### 2.1 设计原则

1. **镜像 IPC 语义，不镜像 IPC 数量**。`ipcRenderer.invoke` 有 ~120 条通道，但形状只有一种：`{ok,value|error}`。所以用**一个** `POST /api/rpc`，body 里带"通道名 + 参数数组"，服务端一张 `Map<fn, handler>` 派发。shim 侧 `invoke(fn, ...args)` 直接 `fetch`，`invokeFs` 拆包逻辑原样保留。
2. **三种形态单独出门**：① 只有一种请求/响应 → RPC；② 字节流/Range → `GET /api/file`；③ 双向长连 → WebSocket（`registerUpgrade`，`packages/host/webserver/src/index.ts:51-56`）。
3. **单向下发合并成一条 SSE**。`ipcRenderer.on` 那 20 多条推送通道（fs 变更、探针结果、clone 进度、MCP、窗口状态、菜单动作…）在浏览器里没有理由各占一条连接。
4. **一切同源**：所有路由挂在 DSH 的同一个 `node:http` 上（`packages/host/webserver/README.md:12`），页面 `<img src>`、pdf.js `fetch`、`EventSource`、`WebSocket` 都不跨源，**不再需要 CORS**（也就去掉了 `appProtocols.ts:160` 那行 `Access-Control-Allow-Origin: *`）。

### 2.2 路由总表

| # | 注册 | 方法 | 作用 | 关键约束 |
|---|---|---|---|---|
| 1 | `register({kind:'prefix', path:'/texpile-desk'})` | GET | SPA dist（index.html + `assets/*` + `themes/*`） | 每次 index 响应都**现渲染** `window.__TEXPILE_BOOTSTRAP__`（见 2.9）；`assets/*-[hash].*` 加 `immutable`，其余 `no-cache`（照 `appProtocols.ts:138-143`） |
| 2 | `register({kind:'exact', path:'/theme-init.js'})` | GET | `index.html:9` 用的是**绝对路径** | 见 2.2.1 |
| 3 | `register({kind:'prefix', path:'/themes'})` | GET | `theme.ts:81` 绝对路径 `/themes/<name>.css` | 同上 |
| 4 | `register({kind:'exact', path:'/favicon.svg'})` | GET | `index.html:5` | 同上 |
| 5 | `register({kind:'exact', path:'/texpile-desk/api/rpc'})` | POST | 120 条通道的合一入口 | 4MB body 上限；JSON only |
| 6 | `register({kind:'exact', path:'/texpile-desk/api/file'})` | GET/HEAD | 取代 `texfile://`：`?path=<enc abs>` | ETag=`"mtime-size"`、`Range`(206/416)、304；**必须做 root 围栏** |
| 7 | `register({kind:'exact', path:'/texpile-desk/api/events'})` | GET | SSE：所有单向下发 | `text/event-stream`、`retry: 1000`、`event:<channel>` |
| 8 | `registerUpgrade({path:'/texpile-desk/api/pty'})` | WS | 终端/编译（二进制帧不必，UTF-8 文本即可） | 一帧一个 JSON；`id` 复用 |
| 9 | `registerUpgrade({path:'/texpile-desk/api/lsp'})` | WS | tinymist JSON-RPC | 服务端负责 `Content-Length` 分帧 |

> 为什么不把 2/3/4 合并进 1：`index.html:5,9` 和 `theme.ts:81` 写的是**站点绝对路径**，与 `<base>`/`vite base:'./'`（`vite.config.ts:92`）无关。要么加 3 条路由（零改动），要么改源码（改 `index.html` 与 `theme.ts:81`）。**推荐加路由**：Texpile 是只读上游，少一处 patch 少一处冲突。

#### 2.2.1 静态服务的 MIME / CSP

直接照抄 `appProtocols.ts:14-36` 的 `BUNDLE_MIME`（注意 `text/javascript` 必须精确，`:12-13` 的注释说明了原因：standard scheme 对 module script 有严格 MIME 检查；HTTP 下宽松些，但 worker/wasm 仍按 MIME 走）。CSP 用 `appProtocols.ts:43-62` 改三处：

```
img-src 'self' blob: data:            // 去掉 texfile:
connect-src 'self' blob: data: https: wss: ws:
frame-src http://127.0.0.1:*          // Typst preview 若保留
```
`script-src 'self' 'wasm-unsafe-eval'` 保留（wasm 解析器要它）；**不要**为了 SSE/WS 放宽 `connect-src` —— 同源本来就允许。

### 2.3 `POST /texpile-desk/api/rpc`

```jsonc
// 请求
{ "fn": "fsRead", "args": ["D:\\ws\\main.typ"], "oneway": false }
// 成功
200 { "ok": true, "value": { "content": "…", "encoding": "utf8" } }
// 失败（裸文本，不带 "Error invoking remote method" 前缀）
200 { "ok": false, "error": "ENOENT: no such file or directory" }
// oneway：立即 204，永不返回业务错误
```

- **`oneway:true` 对应 `ipcRenderer.send`** 的那批：`closeDecision`、`setNativeAppearance`、`windowSetOverlay`、`mcpPublishState`、`publishMenuState`、`gitAskpassReply`、`acp:{cancel,answer}`、`cancelTinymistInstall`、`releasePreview`、`relay*`。它们在原实现里本就"丢了也没事"（`preload.ts:73-75`、`:115-117` 的注释明确说下一次推送会纠正）。
- **`204` 与顺序**：不同 `fetch` 之间没有顺序保证。凡是"必须先 write 再 resize"这类有顺序要求的（终端），**一律走 WS 8**，不要走 RPC。`Terminal.svelte:242-243` 正是这种相邻写。
- **错误码策略**：业务失败一律 `200 + ok:false`（渲染器只认这个信封，见 `fileSystem.ts:292-299`）；只有"未认证/越界"才用 401/403，因为那不该被渲染成普通业务错误。
- **白名单**：`fn` 必须是显式表里的键，绝不 `eval`/动态 `import`。表本身建议按 `preload.ts` 的块切文件（fs / git / draft / draw / image / shell / window），每块一个 `Record<string, Handler>`。

### 2.4 `GET /texpile-desk/api/file?path=<encoded>`

语义**逐条对齐** `appProtocols.ts:155-205`：

| 行为 | 原实现 | 新实现 |
|---|---|---|
| 取路径 | `url.searchParams.get('path')`（`:157`） | 同 |
| 围栏 | `insideClaimedRoot(p)`，realpath 双比（`:96-117`、`:166`），额外放行 draft 字体（`isAllowedFontPath`） | 同语义，但"claimed roots"改成**插件自己的 root 注册表**（`claimWorkspace` 的同一张表） |
| MIME | `MIME[ext]`（`:170`） | 同（可从 `appProtocols.ts:14-36` 复用一张表） |
| ETag/304 | `` `"${mtimeMs}-${size}"` ``（`:171,181-183`） | **必须保留**：PDF 每次刷新都重取 |
| Range | `bytes=start-[end]` → 206/416（`:185-200`） | **必须保留**：pdf.js 分块读 |
| 404 | 文件缺失 404、目录 404（`:169`） | 同。**注意**：`fileAccess.ts:46-57` 会先 `stat` 再决定要不要 `<img>`，所以 404 不应该被当成"错误"打日志 |
| 缓存头 | `Cache-Control: no-cache` + 每次重验证 | 同 |

> 一个易漏点：调用方会**在 URL 后面直接拼 `&t=`** 来破缓存（`compilePipeline.svelte.ts:429,472`、`draw/host/card/compiled/compiledPictures.svelte.ts:84`）。所以新 URL **必须保持"只有一个 query 参数 `path`，可继续追加 `&…`"** 的形状——这正是不改 `fileUrl()` 形状、只改前缀的原因（见 §4）。

### 2.5 `WS /texpile-desk/api/pty` — 终端与编译

**关于"编译日志的流式"必须纠正一个常见误解**：Texpile **没有**编译日志流。它的链路是

```
Compile 按钮 → compilePipeline.startCompile → dock.runCommand(cmd + 哨兵)
  → Terminal.write(id, line + '\r')            // pty 输入
  → pty 输出 → onData → xterm 显示 + tracked.chunks 累积   // 原始输出
  → 扫到 '__texpile_done_N__' → finalizeCompile(gen, pdfPath, before, logPath, logBefore)
  → fsStat(.log/.pdf) 比 mtime → fsRead(.log) → 解析 → compileLog store   // 结构化诊断
  并行：CompileWatchers.watchLog/watchPdf 每 1200ms fsStat 轮询兜底
```
证据：`compilePipeline.svelte.ts:249-278`、`Terminal.svelte:245-270`、`compileWatchers.ts:29-97`。

所以 **"流式编译日志" = PTY 数据帧**；**"结构化诊断" = `POST /api/rpc` 里的 `fsStat` + `fsRead` 轮询**。不要另设计一条 `/api/compile/stream`，那会和哨兵机制打架（两条完成信号）。

协议（文本帧，一行一个 JSON）：

```jsonc
// C→S
{ "t":"spawn", "id":"term-ab12", "cwd":"D:\\ws", "cols":120, "rows":30 }
{ "t":"write", "id":"term-ab12", "data":"latexmk -cd …\r" }
{ "t":"resize","id":"term-ab12", "cols":132, "rows":30 }
{ "t":"kill",  "id":"term-ab12" }
{ "t":"interrupt","id":"term-ab12" }
// S→C
{ "t":"spawned","id":"term-ab12","shell":"pwsh","ok":true }
{ "t":"data",  "id":"term-ab12","data":"This is LuaHBTeX…" }
{ "t":"exit",  "id":"term-ab12","code":0 }
{ "t":"error", "id":"term-ab12","error":"node-pty: …" }
```

映射（逐条对齐 `preload.ts:576-603`）：

| preload | DSH |
|---|---|
| `available()` | 无探测 API：`spawnTerminal` 存在即视为可用（`packages/subprocess/subprocess/src/index.ts:162`），首次 spawn 失败回 `{ok:false,error}` |
| `spawn({id,cwd,cols,rows})` | `ctx.subprocess.spawnTerminal({argv:[shell], cwd, rows, cols, terminalType:'xterm-256color', graceMs, shellActivity:false})`（`types.ts:214-233`） |
| `write(id,data)` | `handle.write(data)`（`types.ts:264-268`，**不带隐式换行**，与 Electron 侧一致） |
| `resize(id,cols,rows)` | `handle.resize(cols, rows)`（`types.ts:269-274`） |
| `kill(id)` | `handle.terminate()`（`types.ts:291-296`，幂等） |
| `interrupt(id)` | `handle.signalForeground('SIGINT')`（`types.ts:285-290`；正好是"结束前台作业"的语义，对应 `terminalIpc` 的 `interrupt`） |
| `onData({id,data})` | `handle.output`（`types.ts:260-261`，UTF-8 有序） |
| `onExit({id,code})` | `await handle.done` → `{exitCode, signal}`（`types.ts:116-121,262-263`） |

**shell 选择**：原实现由主进程挑 node-pty 的 default shell（`ipc/terminalIpc.ts:1-19`，并返回 `res.windowsPty` 给 xterm 用）。DSH 侧给 `SubprocessTerminalEnvironment{platform, defaultShell?}`（`types.ts:205-211`），**具体取法 `TBD(verify)`**；务实做法：Windows 用 `powershell.exe`/`pwsh`，POSIX 用 `$SHELL`。**这直接决定哨兵语法**（`Terminal.svelte:75-83` 按 `cmd`/`pwsh`/POSIX 分支），所以 `spawned.shell` 必须回真正的 basename。Windows 上还有个坑：conpty 要回 `\x1b[?61;4c` 设备属性（`Terminal.svelte:121-128`），DSH 的 pty 后端是否也需要 **`TBD(verify)`**。

### 2.6 `WS /texpile-desk/api/lsp`

原实现里**分帧在主进程**：`typstService.ts:133-165`（`Content-Length: N\r\n\r\n{json}`），跨 IPC 的是**裸 JSON 字符串**（`preload.ts:402-404` 注释）。所以新路由必须：

- 上游：`ctx.subprocess.spawn({argv:[tinymist,'lsp'], cwd:root, stdio:{stdin:'pipe', stdout:'pipe', stderr:'pipe'}})`（`packages/subprocess/subprocess/README.md:57-61` 明确 `'pipe'` 就是给 LSP JSON-RPC 用的）；自己写一个 `Content-Length` 解帧器（照 `typstService.ts:143-165`）。
- 下游：WS 文本帧 = 裸 JSON（`{"jsonrpc":"2.0",…}`），与 `lspClient.ts:74-97` 的 `Transport.send/subscribe` 一一对应。
- **每个浏览器 client 一份 server 进程**（原实现按 `webContents.id` 隔离：`ipc/typstIpc.ts:40-70`，`startLsp` 前先 `stopLsp(wcId)`，并在 `sender.once('destroyed')` 时清：`:65`）。DSH 侧按 `clientId` 隔离，WS 关闭 = `stopLsp`。
- `stopLsp` 语义：`handle.terminate()` + 清 `session`；渲染器侧 `endSession()`（`lspClient.ts:587-597`）就不再持有死进程。
- 三个会诊点：`initialize` 要带 `initializationOptions`（`lspClient.ts:107-112` 在发送前注入，shim 不需管）；`tinymist/preview/scrollSource` 通知（`:302-305`）；`publishDiagnostics`（`:573-578`）。

### 2.7 `GET /texpile-desk/api/events`（SSE）

一条长连承载所有单向下发，用 `event:` 命名通道，`data:` 放 JSON：

| SSE `event:` | 源成员 | 载荷 |
|---|---|---|
| `workspace-fs` | `onWorkspaceFsChanged` | `[{type:'added'|'updated'|'deleted', path}]`（合并窗口 ~50ms，照 `fs/coalesceChanges.ts`） |
| `window-state` | `onWindowState` | `{maximized,fullScreen}`（浏览器里恒 `{false,false}`） |
| `menu-action` | `onMenuAction` | 字符串（非 macOS 永远不发） |
| `open-path` / `open-folder` / `join-session` | 同名 | 需要**缓冲重放**：`preload.ts:10-28` 是为了"推送跑在订阅前"，SSE 侧要按 client 缓存最后一条直到订阅 |
| `draft-preempted` | `onDraftPreempted` | `{root}` |
| `git-clone-progress` / `git-askpass` / `git-askpass-closed` | 同名 | 若保留 git |
| `acp-event` | `onEvent` | 若保留 ACP |
| `update-progress` / `update-downloaded` / `update-error` | 若保留更新 | 建议不提供 |
| `toolchain-probe-result` | `onProbeResult` | `ToolProbe`（`toolchainProbe.svelte.ts:25-42`） |
| `tinymist-progress` / `tinymist-finished` | 同名 | 装 tinymist 的进度 |
| `mcp-request` / `mcp-command` | `onMcpRequest` / `onMcpCommand` | **建议不提供**（见 §5） |

shim 侧把 `on*` 实现成 `eventSource.addEventListener(channel, …)`，返回 `removeEventListener`，语义与 `ipcRenderer.on` 的退订函数等价。

### 2.8 认证、并发、生命周期

**认证（必须自己验，插件路由绕过 `/api` 信任栏）**。DSH 已经把这件事做成了可复用方法，不用重写 HMAC：

```ts
const connection = ctx.get('connection')          // packages/client/connection/src/rpc-host.ts:80
const gate = connection?.requestRejection({ headers: req.headers })  // rpc.ts:214
if (gate !== undefined) { res.writeHead(gate); res.end(); return }    // 401 | 403
```
- `requestRejection` 内部就是 `isTrustedApiRequest`（Host/Origin 栏）+ `browserAuth.isAuthenticated`（`rpc-host.ts:104-107`，cookie 校验细节 `browser-auth.ts:287-300`）。
- Cookie 形态（用于排障）：名 `dsh-auth-<b64url(sha256(authority))>`、值 `v1.<b64url(payload)>.<b64url(hmac)>`、`HttpOnly; SameSite=Strict; Path=/`（`browser-auth.ts:106-127`）。**浏览器自动带，shim 不用管**。
- WS 升级同理：在 `registerUpgrade` 的 handler 里先跑一遍 `requestRejection`，不通过就 `socket.destroy()`（webserver 对 upgrade 失败的处理见 `packages/host/webserver/README.md:55`）。
- 若 `ctx.get('connection')` 取不到（TUI/headless 组合无 webServer），**整组路由都不要注册**（`ctx.effect` 里条件化），与官方"可选 webServer 缺失就干净退出"的惯例一致。

**并发与状态**：

| 状态 | 归属 | 说明 |
|---|---|---|
| `clients: Map<clientId, {roots:Set<string>, sse?:ServerResponse, pty:Map<id,PtyHandle>, lsp?:LspHandle, lastPush:{}}>` | 插件进程 | `clientId` 在建 index 响应时种 cookie `texpile-desk-client=<random>`（HttpOnly，Path=/texpile-desk） |
| `claims: Map<root, clientId>` | 插件进程 | `claimWorkspace`/`releaseWorkspace` 的真实实现。语义照 `windowRegistry`：先到先得，后来者 `{ok:false}`（渲染器会自己退回 Start，`workspaceStartup.ts:59-63`） |
| `rootsForFileServing: Set<string>` | 插件进程 | `GET /api/file` 的围栏依据 = 所有活着的 claim（含"单文件模式取父目录"，`appProtocols.ts:100-101` 的 `r.dirname` 逻辑） |
| 写串行化 | 每 path 一条 promise 链 | Texpile 的自动保存可能连发（`buffers/fileWriter.ts`），并发写同一文件会互相截断 |
| 编译互斥 | 每 root 一把锁 | 渲染器已有 `busy` 守卫（`compilePipeline.svelte.ts:141-144,234`），但多标签页会绕过，服务端仍要挡 |

**清理**：`ctx.effect(() => () => { for (const c of clients.values()) { c.sse?.end(); for (const p of c.pty.values()) void p.handle.terminate(); void c.lsp?.handle.terminate() } clients.clear(); claims.clear() }, 'texpile-desk: teardown')`。注意三件事：
1. **PTY 必须 `terminate()` 而非 `kill`**：`terminate()` 等静默（`types.ts:291-296`），否则 latexmk 的子进程会带着 `.aux` 半成品活下来。
2. LSP 空闲回收：渲染器侧已有 `IDLE_GRACE_MS`（`lspClient.ts:617-626`），服务端仍应有兜底（例如 5 分钟无帧即停）。
3. SSE 长连要 `res.on('close')` 时从 `clients` 摘掉，否则 HMR/刷新会堆积死连接。

### 2.9 启动握手：`bootstrap` 的同步性（**必须在路由设计里解决**）

`preload.ts:35-41` 用 `sendSync` 拿到 `{open, settings}`，下游有两处**同步消费**：`openWorkspace.ts:18-20`（`bootOpen()` 在 `main.ts:38` 首帧前调用）、`settings.ts:205`（首帧前读快照）。HTTP 没有同步 `fetch`。三个选项：

| 方案 | 做法 | 评价 |
|---|---|---|
| **A（推荐）** | **服务端渲染注入**：`GET /texpile-desk` 返回 index.html 时，把 `<script>window.__TEXPILE_BOOTSTRAP__={open:{kind:'folder',path:'…'},settings:{…}}</script>` 插到 `<head>`，shim 的 `bootstrap` getter 直接读它 | 零源码 patch，语义与原实现完全一致（首帧前就绪）。`open` 从查询参数/插件配置来（如 `/texpile-desk?folder=D%3A%5Cws`） |
| B | shim 用同步 `XMLHttpRequest` 拉 `/api/rpc(getSettings)` | 可行但被所有现代浏览器告警；只在 A 不可用时兜底 |
| C | patch `main.ts:48-53` 改成 `await` 再 mount | 改上游，且丢掉"首帧前知道开什么"的收益（会闪 Start 屏） |

配套改动（shim 内部，不改上游）：`bootstrap` 从对象属性变成 getter（原实现是属性 `preload.ts:45`），读取 `window.__TEXPILE_BOOTSTRAP__ ?? {open:null,settings:{}}`。

---

## 3. 映射表（A 类 22 + B 类 19）

> 约定：`✅` = 有确切对应且已核对签名；`⚠️` = 有对应但**语义不齐**，要补逻辑；`❌` = DSH 无等价，必须插件自己用 `node:fs`/`node:child_process` 实现（**这是有意的越界，需在评审里明示**）；`TBD(verify)` = 我没确认到 API 名。

### 3.1 A 类

| preload 成员 | DSH 实现 | 说明 / 缺口 |
|---|---|---|
| `bootstrap` | — | 由 index 注入 `window.__TEXPILE_BOOTSTRAP__`（§2.9 A）；不关 DSH 任何 API |
| `openFolder` | `✅ ctx.directoryPicker`（`packages/host/directory-picker*`，浏览器侧对 `ui-directory-picker-browse`）**`TBD(verify)`** 确切服务名与方法 | 没有它 `isDesktop()===false`（`fileSystem.ts:251-253`），后果见 §6 第 2 条。**再退一步**：自己画一个路径输入框，返回字符串即可满足 A 类 |
| `getSettings` | `⚠️ ctx.storageDomain`（`packages/storage/storage/README.md:46-51`）**`TBD(verify)` 方法名** | 保底：插件数据目录写 `settings.json`（`ctx.fs.writeText` 够用） |
| `setSettings` | 同上 | 必须**合并写**（只写 patch 字段），`settings.ts:261-273` 依赖这个语义避免多标签互相覆盖 |
| `claimWorkspace` | — | 纯插件内 `Map`；语义见 §2.8 |
| `releaseWorkspace` | — | 同上 |
| `fsScan` | `⚠️` 插件自实现遍历（`node:fs.readdir`）；`ctx.fs.listDir` 只有**一层**（`fs/README.md:115`） | 必须抄 `walkIgnoreRules.ts:7-13` + `fsWalk.ts:31-32` 深度 12 + `parseExts` 默认 `tex,typ` |
| `fsTreeScan` | 同上（一次遍历同时出树 + 文件表，性能理由见 `fileSystem.ts:313`） | 排序要抄 `scanOrder.ts`/`nameCollator.ts` |
| `fsRead` | `⚠️ ctx.fs.resolve`+`readText`（`fs/fs/src/index.ts:132,205`） | **编码缺口**：`ctx.fs.readText` 对非 UTF-8 直接 `FS_NOT_TEXT`（`fs/README.md:114`），而 Texpile 的 `fsRead` 要回 `{content, encoding}`（`textDecode.ts`）。做法：`ctx.fs.readBytes(target, sig, maxBytes)` 取字节 + 复刻 `textDecode.ts` 的探测 |
| `fsWrite` | `✅ ctx.fs.writeText(target, content, expected?, signal?)`（`:266-272`，原子发布） | 可顺手用 `expected:{version}` 做陈旧写保护 |
| `fsStat` | `❌` **无 mtime**：`FsInfo` 只有 `{version,type,size?}`（`fs/fs/src/types.ts:76-83`） | **必须** `node:fs.promises.stat`。否则 `compileWatchers.ts:34-51` 的 `mtimeMs > before` 与"两次轮询不变"判定全部失效，且 `fileUrl()+ '&t='` 的 cache-bust 失去数字源（`compilePipeline.svelte.ts:429,472`、`shownPdfMtime()` `:501-504`） |
| `fsOp` | `❌` `ctx.fs` **没有 delete/rename/copy**（`fs/README.md:115`） | `node:fs.promises.mkdir/rm/rename/cp`；`create` 也可用 `writeText`（空内容）。**注意**：绕过了文件沙箱，"每次调用前用 `ctx.fs.resolve` 验一遍在 root 内"是唯一补偿 |
| `fsPurgeUndo` | — | 插件自己的备份目录（`node:fs.rm(recursive)`），本来就不该进 `ctx.fs` 的视野 |
| `onWorkspaceFsChanged` | `⚠️ ctx.fs.watch(target, changed, signal)`（`fs/fs/src/index.ts:100`） | 只报"失效"，且目录只覆盖**直接子项**（`fs/README.md:38`）。要补：① 递归（多 target 或 `node:fs.watch({recursive:true})`）；② 用 stat 前后差分算出 `added/updated/deleted`；③ 合并窗口（`fs/coalesceChanges.ts`） |
| `available`(terminal) | `✅` 无须 API | 首次 spawn 失败即 `{ok:false,error}` |
| `spawn`(terminal) | `✅ ctx.subprocess.spawnTerminal(spec)`（`subprocess/subprocess/src/index.ts:162`；spec `types.ts:214-233`） | `terminalType` 填 `xterm-256color`；`graceMs` 按需；`windowsPty` 字段无对应 → shim 回 `null`（`Terminal.svelte:119-128` 会跳过那段 conpty 逻辑） |
| `write` | `✅ handle.write(data)`（`:268`） | |
| `resize` | `✅ handle.resize(cols,rows)`（`:274`） | |
| `kill` | `✅ handle.terminate()`（`:296`） | 幂等，可直接调 |
| `interrupt` | `✅ handle.signalForeground('SIGINT')`（`:290`） | 无前台组时抛/返回 0 → shim 回 `false`（渲染器只用 `if` 判断，`Terminal.svelte:153`） |
| `onData` | `✅ handle.output`（`:261`） | UTF-8 有序；**不要再做 base64**（原名就是字符串） |
| `onExit` | `✅ handle.done`（`:263`） | `SubprocessOutcome{exitCode,signal}`（`:116-121`） |

### 3.2 B 类

| preload | DSH | 说明 |
|---|---|---|
| `fsProbe` | `⚠️` `ctx.fs.readBytes` 读首块 + 复刻 `electron/src/fs/binaryProbe.ts`；`size` 需 `node:fs.stat` | 缺了只是"二进制文件识别"降级（`fileSystem.ts:400-403` 返回 null） |
| `fsWriteBinary` | `❌` `ctx.fs` 契约明说 mutation 只收文本（`fs/README.md:114`） | `node:fs.promises.writeFile` |
| `filePathOf` | `❌` 浏览器无 `webUtils.getPathForFile` | 最便宜：返回 `''`（`fileSystem.ts:475` 的 `?? ''` 已兜住），拖入图片退化为"只能作为新文件保存" |
| `fsRealRelative` | `⚠️` `node:fs.realpath` + `node:path.resolve`（`electron/src/fs/resolveRealRelative.ts` 逻辑） | 用于 `\includegraphics` 名字大小写归一 |
| `fsSearch` | `❌/⚠️` 无搜索原语（`fs/README.md:115`） | 遍历 + `ctx.fs.readText`，或 `ctx.subprocess` 调 `rg`（更快，但要处理无 rg 的机器） |
| `fsFormatLatex` | `✅ ctx.subprocess.resolveExecutable('latexindent')` + `spawn({argv,stdin:{data:text}})` | 原实现即"latexindent 不在 PATH 就抛"（`fileSystem.ts:413-416` 注释），语义一致 |
| `synctex` | `✅ ctx.subprocess.spawn({argv:['synctex','view'|'edit',…]})` | 复刻 `electron/src/fs/synctexCli.ts` |
| `resolve`(typst) | `✅ ctx.subprocess.resolveExecutable('tinymist')` | 原实现有两候选（PATH / 托管副本，`typstService.ts:28-60`），托管副本放插件数据目录即可 |
| `startLsp`/`send`/`stopLsp`/`onMessage`/`onExit` | `✅ spawn(stdio pipe)` + 自建分帧（`typstService.ts:133-165`）+ WS | 见 §2.6。`ctx.lsp` 不可用（发行版 0.2.2-rc.1 无 lsp 包，且只有 4 个导航操作）——**不要指望它** |
| `probeToolchain` | `✅` 对每个工具 `resolveExecutable` + `spawn --version`（`electron/src/toolchain.ts`） | |
| `distros` | `⚠️` 探测 TeX/Typst 发行版（`toolchainCatalog.ts`） | 与本主线关系不大，可回 `[]` |
| `tinymistStatus`/`installTinymist`/`onTinymistProgress`/`onTinymistFinished` | `⚠️` 下载 + 校验 + 解包（`electron/src/tinymist/*`） | 建议先回 `{pinned:'',supported:false,installed:null,step:null}`，让 UI 显示"不支持自动安装"，用户自己装 |
| `packageFiles`/`texBib` | `✅ ctx.fs` 读包缓存 / TeX 树 | 可先回 `null`（`typstProject.ts:7` 已是 `?? null`） |

### 3.3 有 DSH 对应但**明确不该用**的两项

| 项 | 为什么不用 |
|---|---|
| `ctx.fs.readText` 替换 `fsRead` 全部 | 丢编码探测（GBK/UTF-16 的 `.tex` 会直接失败）。**B 类里最容易被低估的一个坑。** |
| `ctx.fs.stat` 替换 `fsStat` | 无 mtime，编译"完成判定 + cache-bust"整体失效（见上） |

---

## 4. `texfile://` 问题

### 4.1 确认：构造点唯一，解析点有三处

| 角色 | 位置 | 内容 |
|---|---|---|
| **唯一构造器** | `apps/texpile-editor/src/lib/workspace/fileSystem.ts:420-422` | `` `texfile://local/?path=${encodeURIComponent(path)}` `` |
| 上游唯一出口 | `diskProvider.ts:67` → `fileService.ts:116-118` → `workspaceProvider.fileUrl`（`workspaceProvider.ts:54`）→ 注入 `editor/visual/fileAccess.ts:9` `setEditorFileAccess`（由 `workspaceIntegrations.svelte.ts:384` 传 `(p)=>fileService.fileUrl(p)`） | 之后所有消费者（`compilePipeline`、`livePaneProps`、`EditorPane`、`workspaceActionSurfaces`、`compiledPictures`）都拿这条 |
| **解析点 1** | `fileSystem.ts:524-527` `pathFromFileUrl` | `^texfile:\/\/local\/?\?path=` |
| **解析点 2** | `editor/visual/fileAccess.ts:41-43` `pathOfFileUrl` | `url.startsWith('texfile:')` + `new URL(url).searchParams` |
| **解析点 3** | `editor/visual/fileAccess.ts:46-57` `fileUrlExists` | 同样判 `startsWith('texfile:')` 后走 `fileService.stat` 而不发请求 |
| 相关但**不用改** | `fileSystem.ts:530-532` `isRemoteSrc` | 正则已含 `\/`，新 URL 以 `/` 开头天然命中 |
| 相关但**不用改** | `guest/sessionProvider`（`collab/sessionProvider.ts:84,109`）、`guestStore.svelte.ts:381-388` | 协作访客走 `blob:` URL，与 texfile 无关 |
| 用 grep 复核 | `texfile://`、`texfile%3A%2F%2F`、`texfile:` 在 `apps/texpile-editor/src` 全量搜索 → 命中仅上述 3 个文件（其余是注释：`fileSystem.ts:2,418`、`diskProvider.ts:32`、`workspaceProvider.ts:53`、`PDFViewer.svelte:2`、`workspaceIntegrations.svelte.ts:382`） | 没有第二个 URL 构造器 |

### 4.2 最小 patch（3 文件 4 处）

> 前提：本仓库只读，下面是**给定 fork** 的改法。前缀直接写死 `/texpile-desk`（与 §2 的路由一致）；若将来换前缀，下面 4 处必须一起改。

**① `apps/texpile-editor/src/lib/workspace/fileSystem.ts:418-422`**（唯一构造器）

```diff
-// URL serving a local file's raw bytes (editor images, the compiled PDF). texfile:// answers
-// with CORS headers so it works from both the packaged app:// origin and the vite dev origin.
-export function fileUrl(path: string): string {
-	return `texfile://local/?path=${encodeURIComponent(path)}`;
-}
+// URL serving a local file's raw bytes (editor images, the compiled PDF). Under the DSH host the
+// bytes come from the desktop plugin's own same-origin route (GET /texpile-desk/api/file), which
+// answers with ETag + Range exactly like the Electron texfile:// handler did.
+const FILE_ROUTE = '/texpile-desk/api/file';
+export function fileUrl(path: string): string {
+	return `${FILE_ROUTE}?path=${encodeURIComponent(path)}`;
+}
```

**② 同文件 `:523-527`**（保留旧形态兼容，便于同一份产物仍能在 Electron 里跑）

```diff
 export function pathFromFileUrl(url: string): string | null {
-	const m = url.match(/^texfile:\/\/local\/?\?path=([^&]+)/);
+	const m = url.match(/^(?:texfile:\/\/local\/?|\/texpile-desk\/api\/file)\?path=([^&]+)/);
 	return m ? decodeURIComponent(m[1]) : null;
 }
```

**③ `apps/texpile-editor/src/lib/editor/visual/fileAccess.ts:41-43`**（解析点 2）

```diff
 export function pathOfFileUrl(url: string): string | null {
-	return url.startsWith('texfile:') ? new URL(url).searchParams.get('path') : null;
+	if (!url.startsWith('texfile:') && !url.startsWith('/texpile-desk/api/file')) return null;
+	return new URL(url, window.location.origin).searchParams.get('path');
 }
```

**④ 同文件 `:45-50`**（解析点 3，`fileUrlExists`）

```diff
-	if (url.startsWith('texfile:')) {
+	if (url.startsWith('texfile:') || url.startsWith('/texpile-desk/api/file')) {
 		const path = pathOfFileUrl(url);
 		const st = path ? await fileService.stat(path) : null;
 		return !!st?.exists && !st.isDirectory;
 	}
```

### 4.3 校验清单（改完必须逐条过）

1. **`&t=` 仍能拼**：`compilePipeline.svelte.ts:429,472`、`compiledPictures.svelte.ts:84` 直接 `url + '&t=' + mtime` → 新 URL 只有一个 `path` 参数，OK。
2. **pdf.js 的 Range 能过**：`GET /api/file` 必须实现 206/416（`appProtocols.ts:185-200` 是模板）。
3. **ETag/304**：PDF 重载频率很高，缺了会明显变慢。
4. **`<img src>` 的 404 不刷控制台**：`fileAccess.ts:46-57` 已先 `stat`，只要别在 404 时返回 HTML 体即可。
5. **缓存头**：`no-cache`（不是 `no-store`），否则 pdf.js 每次全量重下。
6. **围栏**：`GET /api/file` 必须拒绝 claimed roots 之外的路径（对应 `appProtocols.ts:96-117,166`），否则这条路就是**任意文件读取原语**——`appProtocols.ts:40-42` 的注释把这事说得很明白。
7. **`isRemoteSrc`** 无需改，但 `\\includegraphics` 的候选 URL 生成（`graphicsCandidates.ts:53`）会跟着走新前缀，回归测试一下 hover 预览。

---

## 5. Electron-only 表面：缺失/桩化后的行为与最便宜对策

| 表面 | 原实现 | 缺失后**具体表现** | 最便宜的桩 |
|---|---|---|---|
| 窗口按钮/标题栏 overlay | `electron/src/windowChrome.ts:1-14`（非 macOS 无边框 + `titleBarOverlay`；macOS 原生菜单栏）；渲染侧 `chrome/windowOverlay.ts:92-174` | **不崩**：`windowOverlay.ts:94-95` 在非 macOS 或无桥时直接 `return () => {}`；`TitleBar.svelte:41` 的 `desktop=false` 只是不画最小化/最大化按钮；`LayoutControls.svelte:19` 仍画分隔线 | 什么都不做（`?.` 已在位）。可选：让 `windowClose` 调 `window.close()`（`shortcuts.ts:80` 在 macOS 上依赖它） |
| `nativeAppearance` | `electron/src/nativeAppearance.ts:1-9`（只改 `nativeTheme.themeSource`） | 无影响（`theme.ts:48,97` 是 `?.`） | 不提供 |
| 原生菜单 / `publishMenuState` / `onMenuAction` | `windowChrome.ts` 的菜单模板 | **不崩**：`WorkspaceMenuBar.svelte:225` 只在 `isMac && isDesktop()` 才 `attachNativeMenu`；`nativeMenu.ts:209-225` 全是 `?.` | 不提供。注意 `publishMenuState` 仍会被调（`:243`），shim 里做成 no-op 即可 |
| 原生对话框 `showMessageBox` | `ipc/messageBoxOrder.ts` + `preload.ts:66` | **不崩**且更好：`platformSurfaces.ts:11-14` 无桥 → `nativeDialogs()===false` → 走自绘 `ConfirmHost`（`confirm.svelte.ts:60`） | 不提供 |
| 原生上下文菜单 `popupMenu` | `preload.ts:68` | 同上，`nativeContextMenus()` 要求 macOS 且有此桥（`platformSurfaces.ts:7-9`） | 不提供 |
| 自动更新 `texpileUpdates` | `electron/src/updates.ts`、`updatesIpc.ts` | `updates.ts:99-101` → `'unsupported'`；`App.svelte:81-84` 静默跳过；`installNow` no-op | **不提供**（最省） |
| 终端（xterm + node-pty） | `ipc/terminalIpc.ts:1-37`、`Terminal.svelte` | **不是"面板没了"而是"编译没了"**：`WorkspaceView.svelte:172` 置 `termDock.available=false` → `compilePipeline.svelte.ts:207` **静默 return**（无 toast），用户点 Compile 什么都不发生 | **必须实现**（§2.5）。若强行不做：patch `:207` 加一句 toast，至少别静默 |
| ACP Agent 标签页 | `preload.ts:550-573` | `acpBridge.ts:18` 返回 undefined → 面板不出现 | 不提供 |
| `texpileAgent`（Refine） | `preload.ts:539-547` | `selectionRefiner.ts:43` `?.` → Refine 按钮无响应 | 不提供或 no-op |
| `app://bundle` 假设 | `appProtocols.ts:120-153`；渲染侧 `vite.config.ts:92`（`base:'./'`）、`index.html:5,9,13`（**绝对路径**）、`theme.ts:81`（`/themes/<name>.css`） | 用 `file://` 直开 dist 会白屏（ES module + 绝对路径）。在 HTTP 下只要**站点根**能命中那三条绝对路径就没事 | 加 §2.2 的 2/3/4 路由；**不要**改成 `file://` |
| `navigator.userAgent` 桌面假设 | `platform.ts:3-21`（判 mac/win）、`windowOverlay.ts:176-187`（`windowControlsOverlay`）、`draw/editor/.../shortcutText.ts:1` | 无破坏：UA 在桌面 Chromium 与 Electron 一致；`windowControlsOverlay` 在普通标签页为 undefined → `windowButtonsAtEnd()` 返 false | 不处理 |
| 协作（`texpileTypst` 的 preview relay / `onJoinSession`） | `previewRelay.svelte.ts`、`App.svelte:91-103` | 无桥 → 分享/加入入口消失（`workspaceActionSurfaces.ts:356` 要求 `isDesktop() && caps.share`） | 不提供 |
| 单文件模式 / 拖拽路径 | `filePathOf`（`preload.ts:179-187`） | 返回 `''`，拖入图片变成"外部文件" | 返 `''` |

---

## 6. 启动序列风险（按时间顺序，从最可能致命开始）

> 记法：**R=会在首屏就炸/静默废掉；r=会在具体交互时炸**。每条给 `file:line` + 缓解。

| # | 步骤 | 位置 | 风险 | 缓解 |
|---|---|---|---|---|
| 1 | **同步 bootstrap** | `preload.ts:35-41` → `main.ts:38` → `openWorkspace.ts:18-20`；`settings.ts:205` | R：shim 里 `bootstrap` 若是 `Promise`，`bootOpen()` 永远 null → **永远停在开始页**，且不报错 | index 注入 `window.__TEXPILE_BOOTSTRAP__`（§2.9 A）。**这是第一天最可能踩的坑** |
| 2 | **isDesktop() 三重门** | `fileSystem.ts:251-253`（看 `openFolder` 在不在） | R：只要 shim 漏了 `openFolder`，`isDesktop()` 假 → `termDock.available=false`（`WorkspaceView.svelte:172`）→ 编译静默不动（`compilePipeline.svelte.ts:207`）；同时分享/Reveal/新窗口入口全消失（`workspaceActionSurfaces.ts:196,356`、`FileMenu.svelte:120`、`StartView.svelte:148`） | shim 必须**无条件**提供 `openFolder`（哪怕先返回 null） |
| 3 | `loadSettings` | `settings.ts:200-244` | R：无 `bootstrap.settings` 且无 `getSettings` → 落到 `localStorage`（`:214-219`）→ **设置全默认**；`uiLocale` 回落到 `'en'`（默认值 `:162`，应用点 `:240`），中文 UI 直接丢 | 实现 `getSettings`/`setSettings`（A 类） |
| 4 | `mount(App)` 后 StartView | `main.ts:48-52`；`StartView.svelte:56-71` | r：点"打开文件夹"→ `pickFolder()` → `nativeBridge().openFolder()`；无桥返回 null（`:257-258`）→ **点了没反应**（`if (!root) return`，`:60`） | 实现 `openFolder`；无原生选择器就自绘路径输入 |
| 5 | 恢复上次目录 | `openWorkspace.ts:32-46`（`fill`）→ `fileService.scanTexFiles` → `fsScan` | R：`fsScan` 抛错时 `fill().catch(()=>{})`（`:59,84`）→ **目录开了但树是空的**，无任何提示 | 先实现 `fsScan`/`fsTreeScan`（走 `node:fs`）；shim 里对失败**打日志**（`console.error`），否则排查靠猜 |
| 6 | claim + purge | `workspaceStartup.ts:58-71` | r：`claimWorkspace` 缺 → `{ok:true}`（`fileSystem.ts:265`）；`purgeUndoBackups` 缺 → `requireNative()` **throw**（`fileSystem.ts:365`）但外面 `void …catch(()=>{})`（`workspaceStartup.ts:69`）→ 静默 | 实现这两个；`claim` 用 Map，`purge` no-op 也行 |
| 7 | 布局/标签恢复 | `workspaceStartup.ts:72-83`（`tabs.bind`/`layout.restore`/`termDock.restore`） | 无风险（全 localStorage，`storage/layout.ts:1-12`、`storage/workspaces.ts:1-10`） | — |
| 8 | 首个文件读取 | `fileSystem.ts:382-390` → `fsRead` | R：`ctx.fs.readText` 对 GBK/UTF-16 抛 `FS_NOT_TEXT` → 打开文件失败；上层有 `UnreadableFileNote.svelte` 兜（不崩），但**用户的老 `.tex` 全打不开** | `readBytes` + 复刻 `textDecode.ts`（§3 A 类 `fsRead`） |
| 9 | 编辑器挂载 → 图片/公式 | `EditorPane.svelte:424,427` 用 `fileUrl(loadedPath)`；`fileAccess.ts:46-57` | r：`/api/file` 没实现 → 图片空白、PDF 面板空白，**但页面不报错** | 实现 `GET /api/file`（§2.4），并先过 §4.3 的 7 条 |
| 10 | .typ 文件 → LSP | `lspClient.ts:632-649` → `startLsp`（`:315`） | r：`resolve()` 回 null → `typstLspExtension` 返 null（`:638-641`）→ 有语法高亮但**没有补全/诊断**；`TypstPreview.svelte:106-112` 回"仅桌面" | 实现 WS `/api/lsp`（§2.6）；**先只做 completion/diagnostics/hover**，别一次全上 |
| 11 | 目录监视 | `diskProvider.ts:78-80` → `fileService.use`（`fileService.ts:32`） | r：`onWorkspaceFsChanged` 缺 → `?? (()=>{})` → 编辑器**看不见外部改动**（git 切换分支后文件不刷新） | `ctx.fs.watch` 或多 target + stat 差分（§3 A 类） |
| 12 | 编译 | `compilePipeline.svelte.ts:234-278` | R：见 #2；此外 `fsStat` 无 mtime → 收不到"完成"，`busy` 卡住 → **第二次编译被 `busy` 挡掉并弹"编译进行中"**（`:141-144`） | `fsStat` 走 `node:fs.stat`；PTY 实现 §2.5；先只用 `completionMarker` 路径验证一次端到端 |
| 13 | 关窗 | `workspaceMount.ts:115-127` | r：无 `onBeforeClose` → 返回 undefined，关标签页时**未落盘的修改直接丢** | 要么不实现（接受），要么 `beforeunload` 兜一层（浏览器语义，会弹系统提示） |
| 14 | 更新检查 | `App.svelte:75-87` | 无风险：`claimStartupTasks` 缺 → `?? true`，`checkForUpdate` → `'unsupported'` | 不提供 `texpileUpdates` |

**"一天能跑"的最小闭环**（按上表剪枝）：`bootstrap`(注入) + `openFolder`(桩) + `getSettings/setSettings` + `fsScan/fsRead/fsWrite/fsStat/fsOp` + `claim/release` + `GET /api/file` + `POST /api/rpc` + `spawnTerminal` 那 8 个 → **能开目录、能改字、能存盘、能编译出 PDF**。**LSP、git、模板、协作、更新全部不做**。

---

## 附录 A：未决问题清单（`TBD(verify)`）

1. `openFolder` 的宿主选择器：`packages/host/directory-picker*` 的服务名与调用形态（浏览器侧对应 `ui-directory-picker-browse`）。
2. `ctx.storageDomain` 的具体读写方法名（`packages/storage/storage/README.md` 只描述"records through `ctx.storageDomain`"，未给签名）。
3. `ctx.subprocess` 的 shell 选择：`SubprocessTerminalEnvironment{platform,defaultShell}`（`types.ts:205-211`）由谁填、能否指定 `pwsh`；Windows conpty 是否需要设备属性应答（对应 `Terminal.svelte:121-128`）。
4. `spawnTerminal` 是否支持"先 spawn 后立即写"（Texpile 的 `runCommand` 有 `pending` 队列语义，`Terminal.svelte:98-103,132-137`；我们可以在 shim 里自己排队，故非阻塞项）。
5. 发行版 0.2.2-rc.1 与源码 checkout 的 API 差异：`connection` 服务键（`rpc-host.ts:80` `super(ctx,'connection')`）在发行版里是否同名。
6. 插件能否自行 `import 'ws'`（WebSocket 服务端）——若不允许，得手写 upgrade 握手（`node:crypto` 的 `sec-websocket-accept`，约 30 行）。
7. `ctx.fs.watch` 是否会递归下发子目录失效（README 说"direct entries"），决定要不要退回 `node:fs.watch(recursive)`。

## 附录 B：shim 骨架（一次性，约 200 行）

```ts
// texpile-desk/shim.ts —— 由 index.html 在 SPA 之前加载，等价于 electron/src/preload.ts
const RPC = '/texpile-desk/api/rpc';

async function invoke(fn: string, ...args: unknown[]): Promise<any> {
  const res = await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fn, args }), credentials: 'same-origin'
  });
  const r = await res.json() as { ok: boolean; value?: unknown; error?: string };
  if (r.ok) return r.value;                    // invokeFs 的拆包语义（preloadIpc.ts:4-8）
  throw new Error(r.error ?? 'Unknown error'); // 裸文本：渲染器会再剥一次前缀
}
function send(fn: string, ...args: unknown[]): void {
  void fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fn, args, oneway: true }), credentials: 'same-origin' });
}

// —— 单向下发：一条 SSE 扇出成 N 个 onX ——
const bus = new EventSource('/texpile-desk/api/events', { withCredentials: true });
function on<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (e: MessageEvent) => cb(JSON.parse(e.data) as T);
  bus.addEventListener(channel, h as EventListener);
  return () => bus.removeEventListener(channel, h as EventListener);
}

// —— 终端：一条 WS，帧=JSON ——
class Pty {
  #ws!: WebSocket; #q: string[] = []; #data = new Map<string, (d: string) => void>(); #exit = new Map<string, (c: number) => void>();
  connect() {
    this.#ws = new WebSocket(`wss://${location.host}/texpile-desk/api/pty`);
    this.#ws.onopen = () => { for (const f of this.#q.splice(0)) this.#ws.send(f); };
    this.#ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'data') this.#data.get(m.id)?.(m.data);
      else if (m.t === 'exit') this.#exit.get(m.id)?.(m.code);
    };
  }
  send(o: unknown) { const f = JSON.stringify(o); this.#ws?.readyState === 1 ? this.#ws.send(f) : this.#q.push(f); }
}

(window as any).texpileNative = {
  get bootstrap() { return (window as any).__TEXPILE_BOOTSTRAP__ ?? { open: null, settings: {} }; },
  openFolder: () => invoke('dialog:openFolder'),
  getSettings: () => invoke('settings:get'),
  setSettings: (p: any) => invoke('settings:set', p),
  fsScan: (root: string, exts?: string) => invoke('fs:scan', root, exts),
  fsRead: (p: string) => invoke('fs:read', p),
  fsWrite: (p: string, c: string) => invoke('fs:write', p, c),
  fsStat: (p: string) => invoke('fs:stat', p),
  fsOp: (b: any) => invoke('fs:op', b),
  fsTreeScan: (root: string, exts?: string) => invoke('fs:treeScan', root, exts),
  onWorkspaceFsChanged: (cb: any) => on('workspace-fs', cb),
  claimWorkspace: (root: string, kind?: string) => invoke('workspace:claim', root, kind),
  releaseWorkspace: () => invoke('workspace:release'),
  // …其余按 §3 的表逐条补；C 类不写
};
(window as any).texpileTerminal = { /* §2.5 的 8 个成员，全走 Pty */ };
```

> 关键顺序：`/texpile-desk` 的 index 必须先注入 `__TEXPILE_BOOTSTRAP__`，再执行 `shim.js`，最后才是 Vite 的 `assets/index-*.js`。早一步晚一步都会踩 §6 第 1 条的"永远停在开始页"。
