# 第五轮：右侧独立代理面板（已测试通过）+ workspace / profile 取舍分析

日期：2026-11-08

## 一、右侧独立代理面板（完成并实测）

代理不再从底部 dock 打开，改为**编辑器右侧的独立面板**（第 4 列，宽 420px，带标题栏与关闭按钮）。

### 实测证据
1. 布局菜单点「代理对话」→ 面板出现：
   - `aside[aria-label="代理对话"]` 存在
   - `getComputedStyle(...).gridColumnStart === "4"`
   - `width === "420px"`
2. 面板内完整对话（真实发送）：
   ```
   DeepSeek Harness        chapter02-theory.typ
   只回复两个字：收到        ← 用户消息（自动带上当前文件）
   收到                     ← DSH 回复
   ```
   面板里有 `textarea[aria-label="问 DeepSeek Harness"]` + 「发送」按钮，说明附件/上下文也走通了。

截图：`reports/proof-agent-side-pane.png`

### 改动
| 文件 | 改动 |
|---|---|
| `lib/ai/agentPanel/ui/AgentPane.svelte` | 新增：`<aside>` 右侧面板，标题栏（图标+名称+关闭）+ `AgentPanel`；`grid-column: 4; grid-row: 2` |
| `lib/workspace/paneLayout.svelte.ts` | 新增 `agentPaneOpen` / `agentPaneWidth` / `setAgentPane()` |
| `views/workspace/WorkspaceMain.svelte` | 主网格 `minmax(0,1fr) auto auto` → 加一列；渲染 `AgentPane`；PDF 关闭时的竖线由第 3 列移到第 2 列；预览工具栏的代理事件改为 `layout.setAgentPane(true)` |
| `views/workspace/titlebar/LayoutMenu.svelte` | 「代理对话」改为切换右侧面板，勾选态跟随 `agentPaneOpen` |

### 已知限制
- 面板**固定 420px，不能拖拽**（PDF 面板那套拖拽/键盘调宽/几何持久化没复制过来）。
- 与 PDF 预览**可同时打开**（各占一列）；窗口很窄时会挤压编辑器——没有做 `EDITOR_RESERVE` 那类保护。

---

## 二、workspace 与 profile：先把事实说准

**我上一轮说"profile 决定 session/list 的范围"，这是错的。** 查了实际磁盘布局后纠正：

```
C:\Users\Fisfzy\.dsh\sessions\
  --C-Users-Fisfzy-Desktop-~7855~58EB~8BFE~9898PD~8D44~6599-~6BD5~4E1A~8BBA~6587~521D~7A3F--\
  --C-Users-Fisfzy--\
  --C-Windows-System32--\
  … 共 29 个目录，按 **cwd（工作区路径）** 编码命名
```

而 profile 目录里只有装配文件，没有会话数据：
```
profiles\acp\      → node_modules / cordis.yml / cordis.patch.yml / package.json
profiles\desktop\  → 同上 + .plugin-manager
```

**结论：会话是按「工作区 cwd」分组的，全局共享，与 profile 无关。**

## 三、两者到底差在哪

| 维度 | 专用 **workspace 目录** | 专用 **profile** |
|---|---|---|
| 管的是什么 | 代理的 `cwd`，即它能看到/改哪些文件 | 装配：加载哪些 bundle、套哪些 patch |
| 会话隔离 | **是**——DSH 按 cwd 落盘，天然分组 | **否**——会话不分 profile |
| 能不能改论文 | 能，但只能改这个目录里的 | 与 workspace 无关 |
| 启动开销 | 无额外开销 | 每个 ACP 进程都要装配一遍；bundle 越多越慢 |
| 失败面 | 无 | 每加一层 patch 就多一处可能装不上 |
| 维护成本 | 只需建一个目录 | 多一套 package.json + patch + pnpm 依赖 |
| 用户可见 | "我的论文都在这个文件夹里" | 基本不可见（除非出问题） |

### 一个必须知道的现实
`dsh --profile acp` 目前**继承了用户级 `~/.dsh/cordis.patch.yml`**，每次启动都会出现：
```
dsh: warning: 4 entries did not activate
marisa-panel / dsh-focus-chat / dsh-input-history / dsh-ui-progress: failed to import
```
- 这 4 个失败项每次会话启动都白跑一遍；
- 更严重的是 `dsh --profile headless` 直接被它们**拖到起不来**（`plugin tree failed to load`）——我本来想用它做润色，因此改用临时 ACP 会话。
- 所以：**profile 的价值不是隔离会话，而是能把装配固定下来、并在该 profile 的 patch 里把这 4 项禁掉。**

## 四、推荐（按你的三个标准）

| 你的标准 | workspace 目录 | profile |
|---|---|---|
| 性能损耗最小 | ✅ 零额外开销 | ⚠️ 每次启动多装配一层 |
| 最不容易出 BUG | ✅ 不引入新装配 | ⚠️ 每加 patch 多一处失败面（已有 4 项实证） |
| 对用户最友好 | ✅ 一个文件夹装所有论文，直觉 | ⚠️ 用户看不见，出问题还难查 |

**所以：主用 workspace 目录，profile 作为第二步的可选加固。**

具体建议：

**第一步（先做，简单、直接见效）**
设 `settings.acpWorkspace` 为一个**论文总目录**，例如：
```
D:\AIWORK\TYPST PAPERS\        ← 代理工作区（= DSH 的 cwd）
   ├─ 毕业论文初稿\
   └─ 小论文-01\
```
- 代理能看到所有论文，会话也天然都归到这一个 cwd 下 → 「统一管理」成立；
- 打开某篇论文时，编辑器仍可用 `activeRoot`，只有代理的 cwd 用总目录；
- 插件设置里加一个「代理工作区」输入框即可（`settings.acpWorkspace` 的读取逻辑已写好）。

**第二步（可选，为稳定而非为隔离）**
新建 `~/.dsh/profiles/typwriter\`：
- `package.json` 的 bundles 只要 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-acp-app`；
- 该 profile 的 `cordis.patch.yml` 里把 `dsh-model-follow`、`marisa-panel`、`dsh-focus-chat`、`dsh-input-history`、`dsh-ui-progress` 显式禁用；
- 我们插件里 `argsFor` 改 `['--profile','typwriter']`。
收益：启动更快、日志干净、不再有 4 项失败；顺便能验证 headless 是否也因此可用（那样润色可以更轻）。

> 注意：profile 不会让会话列表变干净。想让会话不混在一起，靠的是工作区目录，不是 profile。

## 四·补 澄清两个误解（附实测数字）

### 误解一：「用 workspace 可能装载不了插件」——不会
插件从 **profile** 装载，与 workspace **完全无关**。
- **profile** 决定：装哪些插件、套哪些配置 → 决定"能不能装载插件"
- **workspace（cwd）** 决定：代理能看/改哪个文件夹、会话落在哪个目录 → 决定"改哪篇论文、会话怎么分组"

两者是**正交**的。现在 `dsh --profile acp` 的插件装载一直正常（只是有 4 项 import 失败的历史问题，
那是**当前 profile 的既有毛病**，换成 workspace 不会让它变好或变坏）。

### 误解二：「用 profile 会造成大量性能损耗」——相反，profile 才是唯一影响启动耗时的东西，而且精简它只会更快

实测 `dsh --profile acp`（当前这个继承了几十个插件的 profile）：

| 阶段 | 用时 |
|---|---|
| 进程起来、能收输入 | **342 ms** |
| `initialize` 回应 | **6,798 ms** |
| `session/new` 完成（可以开始对话） | **8,833 ms** |

也就是说**开一次对话约 9 秒**。它只发生在**每次会话开始**，不是每条消息
（我们的 `AcpHost` 现在会复用活动会话——这正是上一轮修并发 `start()` 的收益）。

这 9 秒里大部分是**装配与插件导入**。所以：
- 现状**确实**慢，值得治；
- 但治法是**精简 profile**（只留 `dsh-base` + `dsh-acp-app`），把 4 个失败项禁掉 → **更快**，不是更慢；
- 与 workspace 无关。

### 结论修正（更准确的说法）
| 目的 | 该动谁 |
|---|---|
| 会话统一管理 / 代理能看到所有论文 | **workspace 目录** |
| 启动更快、日志干净、少失败项 | **profile 精简** |
| 能不能装插件 | **profile**（workspace 管不着） |

两条都做，各治各的病；不存在"二选一"。

### 另一个更划算的优化（与上面两条独立）
面板点开时要等 9 秒才可用。可以**空闲预热**：打开论文时就后台起 ACP 进程并完成
`initialize` + `session/new`，面板点开即用。用户感知从 9 秒降到约 0。

## 五、下一步

1. 插件设置里加「代理工作区」输入框，落到 `settings.acpWorkspace`；默认空 = 用当前论文目录。
2. 打开会话历史（`history: true` + `chats()/openChat()` 已实现，只需放开）。
3. 可选：profile 加固。
4. 可选：代理面板加拖拽调宽（复用 `paneResize` 那套）。
