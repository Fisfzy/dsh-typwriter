# Texpile 的 Typst 编辑栈：复用性评估（面向 DSH 宿主）

分析对象：`D:\AIWORK\TYPST PAPER WRITE\texpile`（只读分析，未修改仓库）。
范围：仅 Typst 编辑栈（语法/源码编辑器/可视化编辑器/LSP/实时预览/导出）。

## 结论摘要

- **可搬运的部分是"半边"**：`packages/typst-syntax-wasm`（Rust + wasm-pack，**273,547 字节** wasm，只导入 1 个 `__wbindgen_throw`，无 DOM/WASI 依赖）是整条 Typst 编辑栈唯一的语法事实来源，源码高亮、折叠、公式树、大纲、**以及可视化编辑器的导入器**都复用它，可近乎原样做成 npm/wasm 包。
- **LSP 侧是"协议级"实现，天然可移植**：Electron main 只是 `spawn('tinymist', ['lsp'])` + 自行实现 `Content-Length` 分帧，再经 IPC 转发裸 JSON 字符串；渲染端用 `@codemirror/lsp-client` 的 `Transport` 接口。换成 Node 宿主只需替换 transport，**spawn/分帧代码本身零 Electron 依赖**（`typstService.ts` 仅因 `startupStats` 计时器间接 import 了 `electron`）。
- **实时预览是最大的一块"Electron + 私有协议"耦合**：预览不是自研渲染，而是把 tinymist 内置预览页取回来、做**字符串替换**（websocket 地址）与**注入**（主题、postMessage bridge），再由 Electron 用 **loopback HTTP** 重发（因为 tinymist 的 data plane 校验 `Origin`），最后 iframe 显示。它依赖 tinymist 页面的私有字段（`c.documents`、`v.impl.currentScaleRatio`）和页面 JS 里的 5 处字面量补丁，**版本一升就可能碎**。
- **可视化编辑器是一次"整层移植"而非"复制文件"**：Typst 专属部分约 **12.8k 行**（`languages/typst/visual`），但它的 4 跳依赖闭包实测 **540 个文件 / 36,041 行**，其中一级依赖 122 个模块里 **93 个在 `$lib/editor/visual`（8,144 行）**，还牵出 `languages/latex`（40 文件）、spellcheck、draw、collab 等；写回靠 `PM doc → serializer → 源文本 → DocumentBuffer → FileWriter(IPC)` 这条通用管线。
- **对"面向 agent 的工作流"（DSH 主场景）真正不可替代的是：`tinymist` 可执行文件 + 标准 LSP + `tinymist compile/export*` 命令**。可视化 WYSIWYG、iframe 预览面板、协作 relay、Svelte 工具栏都可以不要；要的话，代价分别是"重写"和"重建传输"。

---

## 1. Typst 编辑是如何实现的

### 1.1 语法解析与建模：`packages/typst-syntax-wasm`

**它是什么**：把 crates.io 上**未打补丁**的 `typst-syntax` 0.15（Typst 官方解析器，非 fork）编译成 wasm，再把语法树以 **Lezer `Tree.build` 的扁平 buffer 格式**一次性交给 JS。

- Rust 侧 `src/lib.rs`（172 行）：`#[wasm_bindgen] pub struct TypstSyntax { source: Source, names: Vec<String> }`，构造用 `Source::detached(text)`（注释明确：不解析 import，因为编译器是另一个进程）— `lib.rs:39-56`。
- 树导出：每个节点 4 个 u32 `[typeId, from, to, size]`，子节点在前、父节点在后，偏移**由 Rust 侧转成 UTF-16 code unit**（CodeMirror 口径）— `lib.rs:87-113`、`lib.rs:145-172`。
- 节点类型 ID 是**自己分配的**、与 `SyntaxKind` 判别值解耦，且**只增不减**（表增长为超集，旧 id 语义不变）— `lib.rs:95-104`、`lib.rs:121-131`。`kind_name` 用 `Debug` 输出（`lib.rs:29-36`），避开 `SyntaxKind::name()` 的人类可读文案。
- 增量重解析靠 `Source::edit` / `Source::replace`（`lib.rs:62-75`），JS 侧因此不需要自己的 change tracking。

**公开 API**（`pkg/texpile_typst_syntax_wasm.d.ts`）：

```text
new TypstSyntax(text)
edit(fromByte, toByte, with)   // 字节偏移
set_text(text)                 // 内部 diff 成一次编辑
text_len() -> usize
node_names() -> string         // 换行分隔，id = index+1
top_name() -> string
buffer() -> Uint32Array        // Lezer Tree.build 缓冲
free() / [Symbol.dispose]()
```

**JS 包装层**（`src/index.ts`，129 行）：`class TypstParser extends Parser`

- `parseText()` 每次把**整篇文本**交给 `set_text`（`index.ts:83-104`）——"结构性不可能失步"；Lezer 的 `TreeFragment` 被**故意忽略**（`index.ts:106-109`），复用只在 Typst 自己的 reparser 里发生。
- `NodeSet` 随 wasm 的名字表**单调扩张**；slot 0 放 top type（否则 `languageDataAt` 拿不到 `commentTokens`，Mod-/ 失效）— `index.ts:47-64`。
- `forCode()`：给"代码上下文"（`#` 后的参数）加一个 `#` 前缀再解析，再整体减掉前缀偏移（`index.ts:70-73`、`95-96`）。
- 附带能力：`highlight.ts`（83 行，vendored 自 codemirror-lang-typst 的 tag 表，`highlight.ts:11-83`）、`fold.ts`（折 CodeBlock/ContentBlock/Args/Raw/Heading，`fold.ts:44-58`）、`mathTree.ts`（把一棵 `Math` 子树转成普通 JS 树给 MathLive 公式编辑器用，`mathTree.ts:16-55`）。

**体积**（实测）：

| 项 | 值 |
|---|---|
| `pkg/texpile_typst_syntax_wasm_bg.wasm` | **273,547 字节（267 KB）** |
| 手写 TS（index/highlight/fold/mathTree） | 332 行 |
| Rust `lib.rs` | 172 行 |
| `pkg/` 胶水 | `_bg.js` 8,199 B + 入口 278 B + d.ts 1,574 B |

**构建故事**：`wasm-pack build --release --no-pack --target=bundler --out-dir=pkg`（`package.json:12`），`Cargo.toml` 设 `opt-level="s"`、`lto=true`、`codegen-units=1`、`strip=true`，并给 wasm-opt 开 `--enable-bulk-memory --enable-nontrapping-float-to-int`（`Cargo.toml:24-38`）。**关键工程决策：`pkg/` 被提交进仓库**，脚本刻意不叫 `build`，所以干净 checkout 不需要 Rust 工具链（`package.json:11` 注释、`scripts/postbuild.mjs`）。

**能否在普通 browser/Node 跑**（这是本报告最"硬"的可移植性证据）：

- 实测 wasm 模块**只有 1 个 import**：`{"module":"./texpile_typst_syntax_wasm_bg.js","name":"__wbg___wbindgen_throw_..."}`；15 个 export（`memory`、`typstsyntax_*`、`__wbindgen_export*`）。**没有 env/WASI/DOM/定时器依赖**。
- 唯一障碍是 `target=bundler` 的胶水写法：`import * as wasm from "./…_bg.wasm"`（`pkg/texpile_typst_syntax_wasm.js:2`），需要 Vite/webpack 的 wasm 插件（本仓库用 `vite-plugin-wasm`，见 `packages/typst-syntax-wasm/vitest.config.ts:2-13`），或 Node 下自建 3 行 loader（`WebAssembly.instantiate` + `__wbg_set_wasm`）。
- 结论：**(a) 类，几乎零改动**；只需把入口从"bundler 直连 .wasm"换成"可注入的 fetch/readFile"，或改 `--target=web`。

### 1.2 Typst 源码编辑器

- 语言支持：`languages/typst/source/typstLanguage.ts`（83 行）把 wasm parser 包成 CodeMirror 的 `Language`/`LanguageSupport`，`typstHighlight` + `typstFold` + `languageDataProp` 三段拼装（`typstLanguage.ts:49-63`），并定义 `commentTokens //` 与 `closeBrackets ['(','[','{','"','$']`（`typstLanguage.ts:44-47`）。
- 宿主：**通用** `lib/editor/source/SourceEditor.svelte`（423 行）+ `sourceEditorSetup.ts`（255 行）；`.typ` 只是 `applySourceLanguage()` 的一个分支，且**动态 import**（wasm 约 310KB 不拖慢首屏）— `sourceEditorSetup.ts:244-248`。
- 挂 LSP：`lib/editor/source/typstLspBinding.ts`（102 行）在 mount 后异步地 `reconfigure` 一个 Compartment（`typstLspBinding.ts:31-74`），"tinymist 缺失不能延迟编辑器出现"。
- 源码模式快捷键是**纯函数计算**的编辑（`source/sourceExtensions.ts:19-38` → `sourceInsert.ts`），与可视化模式对齐肌 memory。

### 1.3 Typst 可视化（WYSIWYG）编辑器

**不是**"富文本渲染 PDF"，而是**自有的 ProseMirror schema + 双向转换层**：

1. **Schema**：`visual/schema.ts`（129 行）从共享 `basePMSchema` 挑节点/标记字面量，再做 Typst 专属 override：新增 `typ_env`（`#theorem[...]` 这类调用容器，带 `args/label/bodyLead/typIndent/typBodyArg` 属性，`schema.ts:69-103`）、给所有 block 加 `typGap`（原文是单换行还是空行，`schema.ts:110-119`）、给 `doc` 加 `typFile`（BOM/CRLF，`schema.ts:61`）。**"schema 不同即文档不可混"**：Typst 文档物理上不可能含 LaTeX 环境节点（`schema.ts:1-14` 注释）。
2. **导入（源 → PM）**：`visual/convert/converter.ts`（247 行）直接遍历 **wasm 解析出的 CST**（`const parser = new TypstParser()`，`converter.ts:30-34`），把可识别结构变成富节点，**其余一切按原文切片变成 raw island**（`converter.ts:1-11` 的"最大保真契约"）。代码模式（`#let/#show/#import/函数调用`）**整块是 raw island**——可视化只编辑 markup 结构，代码留给源码模式。Typst 的树在 markup 层是**平的**（段落靠显式 `Parbreak`，`Hash` 是代码表达式的兄弟节点），所以块分组在转换器里"合成"（`converter.ts:8-11`）。
3. **导出（PM → 源）**：`visual/serialize/serializer.ts`（339 行）"每个节点类型一个返回字符串的 handler"，块间空行由 `blockGap`（看下一个块记录的 `typGap`）决定（`serializer.ts:1-16`、`85-91`）；配套 `typstInline.ts`（308 行）、`typstEscapes.ts`（73 行）、`envSerializer.ts`（112 行）、`table/save/tableSerializer.ts`（249 行）。
4. **源映射**：序列化时同步产出 `SourceMap`（`sourceSpans`/`parseOrigins`），使 caret 跟随、反向跳转、按块增量 patch 成为可能（`roundtrip.ts:28-33`、`roundtrip.ts:49-60`）。
5. **插件栈**：`typstEditorSetup.ts`（312 行）装配 ~50 个 ProseMirror 插件（输入规则 `= / ``` / - / + / 1.`、表格列拖拽 `columnResizing`、flat-list、MathLive、图片、评论、拼写、块手柄、协同光标…，`typstEditorSetup.ts:171-290`），node view 见 `:292-311`。Typst 专属插件目录 `visual/plugins/**` 有 **165 个文件 / 4,821 行**，`visual/core/**` 64 文件 / 3,323 行（读 `#set`/`#show`/定义/作用域）。
6. **UI**：`TypstEditorView.svelte`（313 行）是"第三个兄弟"（LaTeX `EditorView` / `MarkdownEditorView` 之外），`$props()` 接 30+ 个属于 Texpile 应用层的入参（评论、建议、引用、ShowInOutput…）— `TypstEditorView.svelte:38-106`。

### 1.4 其它 Typst 数据/辅助（不是编辑器内核，但被依赖）

- `symbols/typstSymbolTable.ts` **2,674 行**纯数据（符号插入面板）；`symbols` 全目录 3,220 行。
- `knowledge/`（19 个 `.ts` + `data/std.json` **79 KB** + `data/packages/` 283 个 JSON）是 Typst 标准库/包的本地知识库，用于参数提示、作用域推断，**不是**编译所需。
- `syntax/`（154 行）在编辑器之外复用 wasm parser 做大纲、引用、include 扫描（`syntax/typstTrees.ts:11-40`）。

---

## 2. LSP / IntelliSense（tinymist）是怎么接的

### 2.1 二进制从哪来

- **不打包**：先找 PATH（用户自己在 Preferences 里加的目录会进 PATH），再找托管副本 `userData/tinymist/tinymist(.exe)`；**PATH 优先**，避免覆盖用户自选版本（`electron/src/typstService.ts:103-126`）。
- 版本由 `tinymist --version` 解析出两个号：tinymist 自身版本 + **内嵌 Typst 版本**（真正编译文档的那个）（`typstService.ts:61-101`）。
- 托管安装：pinned `TINYMIST_VERSION = '0.15.8'`，从 `https://dl.texpile.com/vendor/tinymist/0.15.8/` 下载，**8 个 target 的 SHA256 硬编码**（`electron/src/tinymist/tinymistRelease.ts:2-25`），下载→校验→解包→替换，替换前先停掉所有用旧二进制的 LSP（`tinymistIpc.ts:68-70`、`tinymistInstall.ts:38-60`）。

### 2.2 进程模型与跨边界协议

**进程**：Electron main 里 `spawn(command, ['lsp'], { stdio: ['pipe','pipe','pipe'] })` — 每窗口一个语言服务器（"每个窗口有自己的工程根"）（`typstService.ts:179-229`、`typstIpc.ts:1-9`）。stderr 单独转发（tinymist 往那儿写日志，混进 stdout 会破坏分帧）。

**分帧在主进程**：`class LspFramer` 自己解析 `Content-Length`（`typstService.ts:132-166`），因为**渲染端只说裸 JSON 字符串**——"framing and de-framing both live here so the renderer never has to think about the byte stream"。

**跨边界的三条通道**（`electron/src/preload.ts:405-494`，全部 `contextBridge`）：

| 通道 | 方向 | 载荷 |
|---|---|---|
| `typst:lsp:start` (invoke) | R→M | `root: string \| null` → `{ok, info}` |
| `typst:lsp:send` (send) | R→M | **裸 JSON 字符串**（一条 LSP 消息） |
| `typst:lsp:message` (on) | M→R | **裸 JSON 字符串** |
| `typst:lsp:exit` (on) | M→R | code（`null` = 我方主动停） |
| `typst:resolve` / `typst:packageFiles` | R→M | 二进制信息 / `@preview` 包文件内容 |
| `typst:tinymist:status|install|remove|cancel|progress|finished` | 双向 | 安装流程 |
| `typst:preview:prepare|release|pageHtml|prepareGuest` | R→M | 预览页准备（见 §3） |
| `typst:relay:open|send|close|event` | 双向 | 预览 websocket 中继（协作） |

**渲染端**：`languages/typst/intellisense/lspClient.ts`（649 行）只认 **`@codemirror/lsp-client`**：

- `createTransport()` 把 bridge 的 `send/onMessage` 包成 `Transport`（`lspClient.ts:74-97`）——注释明确："intellisense 是对**协议**的集成，换一个 Typst server 只改这里"。
- 一个 `LSPClient` per workspace root，`TypstWorkspace` 替换默认 workspace，好让**没有 CodeMirror view 的可视化编辑器**也能保持文档打开（`lspClient.ts:293-313`、`intellisense/typstWorkspace.ts:1-27`）。
- 设置：`initializationOptions` 手工塞进 `initialize` 请求（库没有这个口），`didChangeConfiguration` 每次推**全量**（tinymist 不 merge，漏掉的 key 会回落默认）— `lspClient.ts:99-112`、`197-222`。`formatterMode: 'typstyle'`、`lint: {enabled, when:'onType'}`、导出用的 `outputPath`。

**实际用到的 LSP 交互**（可作为 DSH 的最小实现清单）：

- 标准：`initialize`、`textDocument/didOpen|didChange|didClose`、`textDocument/completion`、`hover`、`signatureHelp`、`definition`、`formatting`、`rename`、`publishDiagnostics`。
- tinymist 自定义命令（`workspace/executeCommand`）：`tinymist.pinMain`（把主文件钉成入口，否则 tinymist 编译"最后被碰的那个文件"，`lspClient.ts:233-243`）、`tinymist.doStartPreview`、`tinymist.scrollPreview`（`panelScrollTo`）、`tinymist.doKillPreview`（`previewCommands.ts:94-126`、`35-79`）、`tinymist.exportPdf|exportPng|exportSvg|exportHtml`（`export/exportCommand.ts:18-23`）。
- 服务端推送：`tinymist/preview/scrollSource`（预览点击→源码）、`window/showDocument`（**服务端发起的 request**，在 transport 层抢先应答，否则服务端悬挂，`lspClient.ts:499-524`）。

### 2.3 能否在非 Electron 的 Node 宿主里跑？

**几乎原样**。证据：

- `typstService.ts` 的 imports 只有 `node:child_process`、`node:fs`、`node:path` 与本地模块（`typstService.ts:7-12`）；`resolveTinymist/probeTinymist/startLsp/frame` 全无 Electron API。
- 仅有的间接耦合：`startupStats`（计时）内部 `import { ipcMain } from 'electron'`（`startupStats.ts:7`），以及 `shellEnvReady()`（纯 Node，探测登录 shell 的 PATH）。换宿主时把 `timeSpan/timeSync` 换成 noop 即可。
- 渲染端 `Transport` 接口是 `@codemirror/lsp-client` 的公开契约，**已经证明可换**：协作 guest 版就用另一个 transport（"LSP 的 server 是宿主"）— `intellisense/guest/sessionTransport.ts:1-21`。

**结论：(b) 类**——只需把 IPC 换成 stdio/WS/MessagePort，业务代码不动。真正必须带的是 **tinymist 二进制本身**（~30MB 下载量级、需按平台分发、`--version` 探测、Typst 版本随之绑定）。

---

## 3. 实时预览 / PDF 渲染

### 3.1 两条完全不同的路线

**A. 批处理编译 → PDF**：`tinymist compile --root . {main} out/x.pdf 2> out/x.log`（`workspace/typstCommand.ts:144-148`），走通用 shell 管线（与 LaTeX 引擎同一条），然后由 **pdfjs-dist** 渲染（`lib/pdf-view/pdf-viewer/*`，`PdfRenderer.svelte` 337 行）。Typst 没有 `.log` 文件，所以命令把 stderr **重定向成日志**，好让既有 log-watch/settle/publish 路径原样复用（`typstCommand.ts:1-11`）。

**B. 实时预览（Preview 模式）**：**tinymist 自己的 viewer 页面**，不是自研渲染。

- 启动：`workspace/executeCommand` → `tinymist.doStartPreview`，参数 `['--task-id', …,'--data-plane-host','127.0.0.1:0','--partial-rendering','true','--no-open', file]`，回包 `staticServerAddr` / `dataPlanePort`（`preview/previewCommands.ts:94-126`）。**故意不用 `tinymist preview` 子进程**：那个只读磁盘文件；走 LSP 才有内存中的文档（`preview/README.md:25-31`、`previewCommands.ts:81-92`）。
- **页面图像在哪产生**：在 **tinymist 注入页自己的 wasm renderer 里**（页面自包含、约 1.6MB，SVG），Texpile **没有任何 Typst 渲染 wasm 依赖**——`apps/texpile-editor/package.json` 里没有 `@myriaddreamin/*`（实测 grep 只命中 README），这坐实了"页面即渲染器"。
- 页面准备：`electron/src/typstPreviewPage.ts`（404 行）
  - 把页面里 `new URL("/", window.location.href)` 或字面量 `ws://127.0.0.1:23625` **替换**成实际 data plane；两者都不在就 **抛错**（"宁可明确失败，也不要空白面板"）— `typstPreviewPage.ts:42-43`、`384-396`。
  - 注入主题变量 + 一个 **postMessage bridge**，通过页面**自己的键盘处理**做缩放（dispatch `ctrl+=`），并读取 `c.documents[last].impl.currentScaleRatio` 等**私有字段** — `typstPreviewPage.ts:56-97`、`141-151`。
  - 还包装 `window.WebSocket` 以嗅探 `jump`/`cursor` 二进制帧、抑制 follow 的涟漪动画 — `typstPreviewPage.ts:103-138`、`164-188`。
  - 对页面 JS 做 **5 处字面量替换**改 PDF 间距（`typstPreviewLook.ts:7-28`）——全部是"字符串恰好还在"才生效的脆弱耦合。
- 重发：**必须用 loopback HTTP**，不能用自定义 scheme：tinymist 的 data plane 校验 `Origin`，只接受自己、`vscode-webview://`、`http://127.0.0.1`/`localhost`；否则 websocket 1006（`electron/src/ipc/typstPreviewIpc.ts:8-14`，注释里点名 tinymist 的 `tool/preview/http.rs`）。因此 main 起一个 `127.0.0.1:0` 的 http server，**每窗口一页**，并给 host/guest 两套 CSP（`typstPreviewIpc.ts:31-45`、`47-74`、`107-135`）。
- 显示：`preview/TypstPreview.svelte`（354 行）里就是一个 `<iframe src={frameUrl}>`，外加工具栏（缩放/跟随/反色/导出）与"为什么空白"的诊断卡片（`TypstPreview.svelte:313-328`、`169-198`）。生命周期/跟随/点击跳转在 `preview/previewController.svelte.ts`（434 行）。

### 3.2 数据面（私有 websocket 协议）

- 帧格式 `<kind-ascii>,<payload-bytes>`：`new`（整篇）/ `diff-v1`（增量），由页面里的 viewer 合并成 SVG。文档说明见 `preview/README.md:15-24`（**注意：该 README 描述的 `protocol.ts`/`session.ts` 已不存在，代码已改为 iframe 方案，文档滞后**）。
- 反向：页面点击 → data plane → tinymist 解析 → LSP `window/showDocument` / `tinymist/preview/scrollSource` → 编辑器；源码→预览跳转用 `tinymist.scrollPreview`（`panelScrollTo`）。**列（column）是必需的**：tinymist 只解析"结束于光标的叶子是文本"的位置，column 0 永远不解析（`previewController.svelte.ts:167-188`）。
- 协作场景已经把这套帧**搬出 Electron**：guest 端用 `PreviewStream` 重组成块、检测 gap（`lib/collab/protocol.ts:294-330`），内核 socket 由 main 侧 `typstPreviewRelay.ts`（100 行）转发（"renderer 打包后不能自己开：Origin 会是 `app://bundle`"，`typstPreviewRelay.ts:1-12`）。

### 3.3 对 DSH 的含义

- **不需要**页面：一个 agent 面向的流程要"看页面"，正确做法是 `tinymist exportPng`（`{0p}` 逐页模板，`exportCommand.ts:60-81`）或 `tinymist compile` + pdfjs/poppler。
- 若要"真·实时预览"，必须把 tinymist 的页面取回来再服务，且接受**跨版本脆弱**；或者按 `preview/README.md` 描述的旧方案自己写 websocket 客户端 + wasm renderer（那需要 `@myriaddreamin/typst.ts` + `typst-ts-renderer` 1.22MB wasm，且与 tinymist 的矢量格式版本绑定）——**仓库里已经删掉了这条路**。

---

## 4. 可视化编辑器 ↔ 源码的桥接，以及写回磁盘

### 4.1 桥接模型

不是"把源文本当富文本解析"，而是**三件套 + 源映射**：

```
.typ 文本 ──wasm TypstParser──▶ Lezer/CST ──typstToProseMirror──▶ PM doc (+origins/sourceMap)
   ▲                                                                      │
   └──── serializeToTypstDetailed (blockAssembly + blockGap) ◀────────────┘
```

- 入口/出口：`visual/roundtrip.ts:14-34`（`parseTypstFile` → `ParsedLatexFile` 形状**复用 LaTeX 的**：`preamble=''`, `postamble=''`, `hadDocumentEnv=false`），`:49-60`（`serializeTypstFileDetailed`，保护尾部字节、保留 BOM、CRLF）。
- 解析在主线程：**Typst 不开 worker**（"wasm 已经为 CodeMirror 加载了"），只保留节点数上限 100,000 与 800KB 的文件上限 — `workspace/visualParse.svelte.ts:106-128`、`:19-24`。
- 双向增量：源码编辑 → 可视化的 `patchVisualFromSource` 用**块级 diff** 一次性 patch 进 PM（保留 undo 一步）— `workspace/edits/visualSourcePatch.ts:28-55`；LSP 侧由 `TypstDocumentStream` 把可视化编辑器序列化出的文本持续喂给 tinymist（否则服务器读磁盘、预览落后一个 autosave）— `intellisense/typstDocumentStream.ts:21-46`。

### 4.2 写回 `.typ`

- PM doc → `serializeTypstFileDetailed` 得到 `texSource`：`workspace/documentBuffer.svelte.ts:211-220`（`kind === 'typ'` 分支）。
- 保存前**回环校验**：把将要写的内容重新解析，若与当前 doc 不一致，则把"改过的块整块写出"（`verifiedSerialize`），保证"磁盘上的源码能读回同样的文档"— `documentBuffer.svelte.ts:229-255`。
- 真正落盘走**通用** `lib/buffers/fileWriter.ts`（131 行）/`diskSync.ts`，最终经 preload 的 fs IPC（与 `.tex`/`.md` 同一条路）。Typst 没有专属写盘逻辑——这是好消息（写盘不是 Typst 的耦合点）。

### 4.3 一个移植必须带走的东西（实测依赖）

`languages/typst/visual` = **289 文件 / 12,811 行**（`.ts` 11,521 + `.svelte` 1,174 + `.css` 116；仅 7 个 `.svelte.ts` runes 文件）。

- 一级 `$lib` 依赖：**122 个模块 / 10,892 行**，其中 **93 个属于 `$lib/editor/visual` / 8,144 行**。
- 4 跳transitive 闭包（实测，仍非完整）：**540 个文件 / 36,041 行**，分布：`languages/typst` 289、`editor/visual` 119、`lib` 顶层 54、**`languages/latex` 40**（共享代码，例如表格/块装配/工具函数）、`editor/spellcheck` 8、`editor/source` 7、`draw` 3、`collab` 1 …

也就是说：**Typst 可视化编辑器的"真实体量"不是 12.8k 行，而是 ≥36k 行且横跨 LaTeX 代码**。这不是复制目录能解决的，需要"连通用编辑器层一起搬"或"重写一层薄的宿主适配"。

另外两个隐藏依赖：
- **MathLive**：`packages/mathlive`（192 文件 / 63,294 行，仓库内 fork），Typst 公式编辑通过 `$lib/editor/visual/extensions/mathlivebridge` 使用它。
- **Svelte 5 runes**：`typst/visual` 里 7 个 `.svelte.ts` + 15 个 `.svelte`；配件（工具栏、设置面板、node view）是 Svelte 组件，DSH 若要复用必须保留 Svelte 运行时或重写 UI。

---

## 5. 可移植性判定表

分类：
**(a)** 近乎原样可做成 npm/wasm 包｜**(b)** 只需把 Electron IPC 换成宿主中立传输｜**(c)** 与 Electron/Svelte 深度耦合、实质重写｜**(d)** agent 面向流程不需要。

| # | Typst 子系统 | 分类 | 体量（实测） | 关键耦合 / 证据 | 移植判断 |
|---|---|---|---|---|---|
| 1 | `packages/typst-syntax-wasm`（parser + highlight + fold + mathTree） | **a** | Rust 172 行 + TS 332 行 + **267KB wasm** | 无 DOM/WASI（wasm 仅 1 个 import）；唯一摩擦是 `target=bundler` 的 `import '.wasm'`（`pkg/*.js:2`） | 直接发布为包；提供 node/browser 两种 loader 即可，1 人日量级 |
| 2 | Typst 源码语言支持（CodeMirror `Language` 封装） | **a** | `source/` 693 行 | 只依赖 `@codemirror/*` + 上面的 wasm 包 | 复制 + 改 import 路径；宿主已有 CodeMirror 即可用 |
| 3 | Typst 源码编辑器宿主/UI（SourceEditor、工具栏、插入命令） | **b/c** | `lib/editor/source` 760 行 + `source/` 工具 693 行 | 与 `$lib/settings`、`workspaceStore`、Svelte 组件、fs IPC 绑定（`sourceEditorSetup.ts:244-248`） | DSH 若已有自己的编辑器，这里基本重写；插入命令（`sourceInsert.ts` 纯函数）可单独搬 |
| 4 | LSP 客户端（`lspClient.ts` + `typstWorkspace.ts` + 诊断/重命名/格式化） | **b** | `intellisense/` 2,205 行（host 部分 ≈1,700；guest relay 4 文件 495 行） | `Transport` 抽象（`lspClient.ts:74-97`）；依赖 `@codemirror/lsp-client`、`@codemirror/state`；少量 app store（`settings`/`mainFile`） | 换 transport + 去掉 Svelte `box/observe` 即可复用；**值当搬**（诊断/明细语义都是现成的） |
| 5 | tinymist 进程管理（resolve / probe / spawn / LSP 分帧） | **b** | `typstService.ts` 230 行（Electron 相关文件合计 **1,496 行**） | 仅 `node:child_process`；间接 `startupStats`→`electron`（`startupStats.ts:7`） | 几乎照搬；删掉计时器与 `app.getPath('userData')` 依赖 |
| 6 | tinymist 下载/校验/安装 | **b/d** | `tinymist/` 5 文件 352 行 + `tinymistIpc.ts` 115 行 | 硬编码 8 个 SHA256 与私有 CDN（`tinymistRelease.ts:2-25`）、`net.fetch`、`userData` | 换成"要求用户自己装/自建分发"更划算 |
| 7 | **实时预览：页面准备 + loopback 重发（main 侧）** | **c** | `typstPreviewPage.ts` 404 + `typstPreviewIpc.ts` 192 + `Look` 29 + `Relay` 100 | 字符串替换 tinymist 页面（`typstPreviewPage.ts:384-396`）、注入私有字段访问（`:141-151`）、5 处 JS 字面量补丁（`typstPreviewLook.ts:7-28`）、`Origin` 规则迫使 loopback HTTP（`typstPreviewIpc.ts:8-14`）、`WebContents` 事件 | 逻辑可读但要重写（Node http server + 同样的替换），且**随 tinymist 升级会碎**；agent 场景优先 `exportPng` |
| 8 | **实时预览：渲染端面板（iframe + bridge + 工具栏）** | **c** | `preview/` 1,371 行（TypstPreview 354 / Remote 356 / controller 434 / commands 141）+ `lib/preview` 1,711 行共享 | Svelte 5 runes、`postMessage` 驱动、主题变量读取、隐私字段 `v.impl.currentScaleRatio` | 换宿主基本重写；iframe+loopback 组合在 Web 宿主里可行，但必须重做服务端 |
| 9 | 可视化编辑器：schema + 导入器 + 序列化器 + 源映射 | **c** | `visual/` **12,811 行**（convert 1,067 / serialize 1,035 / core 3,323 / plugins 4,821 / extensions 1,123 / toolbar 323 / 顶层） | 依赖闭包 **540 文件 / 36,041 行**，含 `$lib/editor/visual` 119 文件与 `languages/latex` 40 文件；`basePMSchema`、`sourceSpans`、`parseOrigins`、`blockAssembly`、`padTables`… | 只有在 DSH 也有那套 PM 通用层时才"搬得动"；否则是**重写级**投入（数周~人月） |
| 10 | 可视化编辑器：插件/UI（表格、环境卡、引用 chip、符号、MathLive 公式） | **c** | 插件 165 文件 / 4,821 行 + Svelte 组件 | Svelte 5 runes、`$lib/draw`、MathLive fork（63k 行）、`$lib/editor/spellcheck` | 与 #9 同命运；数学编辑可改用 MathLive 的独立包，但仍需桥接 |
| 11 | 通用视觉编辑层 `$lib/editor/visual` | **c** | 目录 333 文件 / 100,675 行，其中**实际代码约 27,000 行**（`.ts` 21,940 + `.svelte` 5,061）；`.txt` 72,943 行是断字模式数据 `linebreak/patterns/*.pat.txt` | Svelte 组件 + PM + 应用 stores 交织 | 想复用得整体保留 Svelte 与 PM 视图层 |
| 12 | 导出（PDF/PNG/SVG/HTML） | **b** | `export/` 841 行 | 纯逻辑（`exportCommand.ts` 拼参数），执行是 `workspace/executeCommand`（`runTypstExport.ts:49-52`） | **强烈建议搬**：agent 出片只需这一条链 |
| 13 | Typst 批处理编译命令拼装 | **b** | `workspace/typstCommand.ts` 169 行（纯字符串逻辑） | 无（只有 `joinPath`） | 直接可搬 |
| 14 | PDF 渲染（pdfjs 视图层） | **b/d** | `lib/pdf-view` 多文件（PdfRenderer 337 / PdfViewer 169 …） | `pdfjs-dist`，与 LaTeX 共用 | 已有成熟替代（pdf.js 直接用），不必搬 |
| 15 | 协作：LSP relay、预览 relay、guest 页面 | **d** | guest LSP 495 行 + `previewRelay.svelte.ts` + `typstPreviewRelay.ts` 100 行 | 需要整套会话/加密/权限层 | agent 流程不需要 |
| 16 | 符号表 / knowledge 数据 / 大纲 / 引用扫描 | **a/d** | symbols 3,220 行（表 2,674 行）+ knowledge 19 ts / 1,461 行 + std.json 79KB + 283 JSON | 纯数据 + wasm tree 遍历 | 想给 agent 提供"符号/参数提示"可单独搬 |
| 17 | MathLive（Typst 公式编辑） | **c/d** | `packages/mathlive` 192 文件 / **63,294 行** | 仓库内 fork | agent 不需要；人工编辑才需要 |

---

## 6. 给 DSH 的三条落地路线（按投入排序）

**路线 1（推荐，1–2 人日 / 最少代码）**：只要"能改能编译能出片"
1. 装/分发 `tinymist`（0.15.x），用 `node:child_process` spawn `tinymist lsp`；
2. 直接复用 `#4 + #5`（`lspClient` 换 stdio transport，去掉 Svelte runes）；
3. 出片用 `#13 + #12`（`tinymist compile` 或 `tinymist.exportPng/Svg/Pdf`），页面图直接用导出的 PNG/SVG；
4. 语法高亮/折叠用 `#1`（换 loader 即可）。
   *产出：诊断、跳转、重命名、格式化、PDF/PNG、按需预览图——覆盖 agent 全部硬需求。*

**路线 2（1–2 周）**：再加"能在 DSH 里人工编辑 Typst"
- 加 `#2`（CodeMirror 语言）+ 自写薄 UI；不要碰可视化编辑器。

**路线 3（数周~人月，不建议跨宿主复制）**：要 WYSIWYG
- 必须连 `$lib/editor/visual`（≈27k 行代码）、MathLive（63k 行）、`languages/latex` 共享件一起搬，或**在 DSH 内重做一层 PM 通用宿主**；Typst 专属可复用的其实只有 `schema.ts` / `convert/**` / `serialize/**`（约 2.1k 行）这三个"纯转换"目录。

---

## 7. 结论要点（可直接引用的判断）

1. **Texpile 的 Typst 栈是"tinymist 驱动 + 自研语法/视觉层"**：语法唯一事实源是 `typst-syntax` 的 wasm 构建；编译/LSP/预览/导出都外包给 tinymist 二进制。
2. **最干净的可复用资产**：`typst-syntax-wasm`（267KB、无宿主依赖、`pkg/` 已入库免 Rust）与 `export/`+`typstCommand.ts` 的纯逻辑。
3. **LSP 侧是协议级实现，不是 Electron 专属**：`spawn + Content-Length 分帧 + 裸 JSON 过桥`，渲染端 `Transport` 已经有两个实现（IPC / 会话），说明接口边界是真实的。
4. **预览是最大的技术债**：靠替换 tinymist 页面字符串与访问其私有字段工作（`typstPreviewPage.ts:141-151`、`typstPreviewLook.ts:7-28`），**升级 tinymist 即可能失效**；且 `Origin` 校验迫使 loopback HTTP 重发（`typstPreviewIpc.ts:8-14`）。
5. **可视化编辑器的真实成本被低估**：Typst 专属 12.8k 行，但依赖闭包 540 文件 / 36k 行，且与 LaTeX 共用代码；写回磁盘本身不耦合（走通用 FileWriter）。
6. **文档已漂移**：`languages/typst/preview/README.md` 仍描述 `protocol.ts`/`session.ts` 与 `@myriaddreamin` 渲染 wasm，实际实现已改为"iframe tinymist 页面"，且 `package.json` 里已无该依赖——任何移植评估都要以代码为准。

---

## 附：关键证据索引

| 主题 | 位置 |
|---|---|
| wasm 解析器 Rust API / 树缓冲 | `packages/typst-syntax-wasm/src/lib.rs:39-56`、`:87-113`、`:145-172` |
| Lezer Parser 包装、增量、`forCode` | `packages/typst-syntax-wasm/src/index.ts:33-64`、`:70-73`、`:83-128` |
| 构建脚本 / 提交产物 / wasm-opt | `packages/typst-syntax-wasm/package.json:11-12`、`Cargo.toml:24-38`、`scripts/postbuild.mjs` |
| 源码语言封装 | `apps/texpile-editor/src/lib/languages/typst/source/typstLanguage.ts:16-63` |
| 源码编辑器路由 | `apps/texpile-editor/src/lib/editor/source/sourceEditorSetup.ts:241-252` |
| LSP 客户端 / transport / 命令 | `.../typst/intellisense/lspClient.ts:74-97`、`:205-222`、`:233-243`、`:499-524`、`:632-649` |
| LSP 进程 / 分帧 | `electron/src/typstService.ts:112-126`、`:132-166`、`:179-229` |
| LSP IPC 通道 | `electron/src/ipc/typstIpc.ts:36-74`、`electron/src/preload.ts:402-494` |
| tinymist 版本/校验/安装 | `electron/src/tinymist/tinymistRelease.ts:2-25`、`tinymistInstall.ts:38-60` |
| 预览启动/跟随/杀掉 | `.../typst/preview/previewCommands.ts:35-126`、`previewController.svelte.ts:100-125`、`:336-358` |
| 预览页面改写与注入 | `electron/src/typstPreviewPage.ts:42-43`、`:56-97`、`:141-151`、`:384-403` |
| loopback 重发与 CSP | `electron/src/ipc/typstPreviewIpc.ts:8-14`、`:31-45`、`:107-135` |
| iframe 面板 | `.../typst/preview/TypstPreview.svelte:313-328` |
| 视觉 schema / 转换 / 序列化 | `.../typst/visual/schema.ts:15-44`、`:69-129`；`convert/converter.ts:1-34`；`serialize/serializer.ts:1-16`、`:85-91` |
| 可视化的源/文档往返 | `.../typst/visual/roundtrip.ts:14-34`、`:49-60`；`workspace/documentBuffer.svelte.ts:211-255`；`workspace/edits/visualSourcePatch.ts:28-55` |
| 插件栈 / node view | `.../typst/visual/typstEditorSetup.ts:103-120`、`:171-311` |
| 导出命令映射 | `.../typst/export/exportCommand.ts:18-58`、`runTypstExport.ts:32-61` |
| 编译命令拼装 | `apps/texpile-editor/src/lib/workspace/typstCommand.ts:144-148` |
| 协作预览帧重组 | `apps/texpile-editor/src/lib/collab/protocol.ts:294-330` |
| 预览架构文档（已滞后） | `.../typst/preview/README.md:1-76` |
