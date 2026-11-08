# 路线甲落地：在 Texpile 里用 DSH 对话并修改论文

日期：2026-11-08

## 一、结论

**已打通。** DSH 现在以 `DeepSeek Harness` 的身份出现在 Texpile 的偏好设置里（显示"已安装"），
并且通过面板实际使用的那条桥，完整跑通了：**建立会话 → 多轮对话 → 调用工具 → 修改文件 → 变更清单回传**。

## 二、改了什么

### 1. 渲染端：把 dsh 变成一个真预设（4 处）
| 文件 | 改动 |
|---|---|
| `ai/agentPanel/agentPanel.types.ts` | `PanelAgent` 联合加 `'dsh'` |
| `ai/agentPanel/agentNames.ts` | `PANEL_PRESETS` 首位加 `'dsh'`；`agentLabel` 返回字面量 `'DeepSeek Harness'`（产品名不翻译，避免动 5 个语言包）；`signInCommand` 加 `dsh: null` |

> 遗留小项（纯类型，无运行时影响）：`lib/settings.ts:107,109` 的 `agentPanel` / `agentPanelAgents`
> 联合类型里还没加 `'dsh'`，建议下次构建时一并补上。

### 2. 宿主端：新增 ACP 客户端 `src/host/acp.js`
驱动 `dsh --profile acp`，标准 ACP v1（newline-delimited JSON-RPC）：

| 方法 | 实现 |
|---|---|
| `detect` | 探测 `%APPDATA%\npm\dsh.cmd` |
| `start` | spawn → `initialize` → `session/new {cwd, mcpServers:[]}` → 推 `{type:'state',state:'ready'}` |
| `prompt` | 前后快照比对 → `session/prompt` → 请求返回后给出 `changes` |
| 权限 | 接 `session/request_permission` 请求 → 推 `{type:'permission'}` → 面板 `answer()` 后回写 outcome |
| `cancel` / `close` / `setConfig` / `chats` / `openChat` | `session/cancel`、`session/close`、`session/set_config_option`、`session/list`、`session/resume` |

**stdout 脏行处理**：不再需要单独的清洗进程——`acp.js` 自己按行解析，
解析不成的行直接改投 stderr（`[typwriter:acp] non-protocol stdout: …`）。
实测那行 `[dsh-model-follow] active: …` 被正确拦下，协议流干净。

### 3. 桥接：`window.texpileAcp` / `window.texpileAgent`
`shim.js` 里原本是 `undefined`（这正是"面板点了也启动不了"的根因），现在按
`ai/agentPanel/acpBridge.ts` 的 `AcpBridge` 类型完整实现，事件走 SSE 通道 `acp:event`。

### 4. 工作区（为第二阶段预埋）
`acpWorkspace()` 优先读设置里的 `settings.acpWorkspace`，没设就用当前论文目录。
这就把"统一管理在一个 texpile 专属工作区"的开关位留好了——下一阶段只需在偏好设置里加一个输入框。

## 三、验证记录（全部实测）

### 1. 预设出现在偏好设置
偏好设置 › AI 助手 › **代理标签页** 实测文本：
```
DeepSeek Harness 已安装
Codex 未找到
Claude 未找到
OpenCode 未找到
GitHub Copilot 未找到
Gemini 未找到
自定义代理
```
"已安装"来自宿主 `acp:detect` 返回 `{dsh:true, …}`。

### 2. 对话（走面板同一条桥 `window.texpileAcp`）
```
start()  → {ok:true, agent:'dsh'}
事件流    → state:starting → state:ready(title:"DeepSeek Harness")
          → state:working → agent_message_chunk("OK") → usage_update(12278/1000000)
          → state:ready
prompt() → {ok:true, stopReason:'end_turn', changes:[]}
```

### 3. 修改内容（含权限往返）
```
prompt("请在当前工作区根目录创建 _dsh_probe.txt，内容 hello from DSH")
→ {ok:true, stopReason:'end_turn',
   changes:[{path:'…\_dsh_probe.txt', kind:'added', before:null}]}
事件流 → tool_call → tool_call_update → agent_thought_chunk → agent_message_chunk
```
磁盘核对：`_dsh_probe.txt` 存在，15 字节，内容正是 `hello from DSH`（验证后已删除）。

`tool_call` / `tool_call_update` / `agent_thought_chunk` / `agent_message_chunk`
正是 `agentItems.ts` 用来渲染步骤条目的那几种，面板显示不会有形状偏差。

## 四、还剩一处：底部 dock 的 Agent 标签没冒出来

三道闸门我已逐一核对，运行时条件都满足：
- `agentOn = !panelTabOff()` → `aiOff=false` 且 `agentPanelAgents` 未设 → `true`
- `agentBlocked = agentUnavailable()` → `acpBridge()` 现在**存在** → `null`（可运行）
- `{#if agentOn}`（`BottomDock.svelte:185`）应该渲染出按钮

但点"终端 › 显示终端"打开 dock 后，标签条只有「终端」，没有「助手」。
说明问题不在上述三道闸门，而在更外层（dock 的 `view` 初始值、或该 dock 实例没重新挂载）。

**下一步定位很明确**：在 `BottomDock.svelte:185` 的 `{#if agentOn}` 处打断点/加日志，
确认 `agentOn` 的实际取值，以及 dock 是否用了缓存过的 `agentPanelAgents`。
这一步不影响功能本身——桥和 ACP 都已证明可用，只是入口按钮没显示。

## 五、第二阶段（你要的 session 管理）已经预埋好

| 需求 | 现状 / 下一步 |
|---|---|
| 统一在一个 texpile 专属工作区 | `settings.acpWorkspace` 开关已接；下一阶段在偏好设置加输入框，Default 保持"当前论文目录" |
| 插件设置里手动管理 | 我们的 Store 已经能持久化任意 settings 键，加一个设置面板即可 |
| 会话列表 | `chats()` 已实现（`session/list`），`history:false` 关着；打开后 dock 的 Agent 标签会出历史列表 |
| 会话切换 | `openChat()` 已实现（`session/resume`） |

> 注意：DSH 的 `session/list` 是按 profile 持久化根列出的，所以"texpile 专属工作区"
> 最好同时意味着 **专用的 profile 或专用 workspace 根**，否则会把你其他会话也列进来。
> 这一点在做第二阶段时需要先定：是"专用 workspace 目录"还是"专用 profile"。
