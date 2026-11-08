# ACP 代理的运行预设：工作区怎么定、插件从哪来

日期：2026-11-08 · 全部结论来自本机实测

## 一、工作区（session/cwd）是怎么确定的

### 现在的规则（代码 + 磁盘双证据）
`src/host/acp.js`：

```js
workspace: () => acpWorkspace() || store.state?.activeRoot || null
```

1. `settings.acpWorkspace`（插件设置里的「代理工作区」）——**当前没设**，为空
2. 否则用 **`activeRoot`**，即 Texpile 当前打开的论文目录

拿到后作为 ACP `session/new` 的 `cwd` 传过去。

### 实测证据
**① 会话就落在论文目录下**（DSH 按 cwd 编码目录名）：
```
C:\Users\Fisfzy\.dsh\sessions\--C-Users-Fisfzy-Desktop-~7855~58EB~8BFE~9898PD~8D44~6599-~6BD5~4E1A~8BBA~6587~521D~7A3F--\
   6e8238d8-…  16:43     ← 与我这几次开对话的时间一一对应
   bfc6670c-…  16:37
   05362ceb-…  16:28
   a48baf23-…  16:13
   e6937c2c-…  16:03
   afc8b825-…  15:43
```

**② 代理真的能写那个目录**：早前让它创建 `_dsh_probe.txt`，文件出现在**论文根目录**（15 字节，内容 `hello from DSH`）。

### 所以要明确的是
- **是**，就是这篇论文的文件夹；
- **换一篇论文 → cwd 变 → 会话也分到另一个目录**（这就是"会话按工作区分组"的机制）；
- 想让所有论文共用一个工作区，就把 `settings.acpWorkspace` 设成论文总目录（读取逻辑已经写了，只差设置界面）。

## 二、预装载的插件：独立进程，但共用同一个 DSH 家目录

### 事实
每次 `start()` 都会**新起一个 `dsh --profile acp` 进程**。它加载什么：

| 来源 | 内容 |
|---|---|
| `profiles/acp/package.json` 的 bundles | **只有** `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-acp-app` |
| `profiles/acp/cordis.patch.yml` | 空（`[]`） |
| **用户级** `~/.dsh/cordis.patch.yml` | 你那份几十行的全局 patch（**所有 profile 都吃**） |

**不加载**：desktop profile 里的插件——`dsh-media-desk`、`ego-browser`、`dsh-better-sidebar`、
`dsh-cae-agent`、`dsh-tylina`……以及**我们自己这个论文编辑插件 `dsh-typwriter`**。

### 实测证据：直接问代理"你能调用哪些工具"
它答：
```
agent_session_read、agent_session_search、create_goal、edit、exit_plan_mode、get_goal、
glob、grep、interrupt_agent、job_kill、job_list、job_output、list_agents、
list_mcp_resource_templates、list_mcp_resources、lit_download_links、lit_fetch、
lit_paper_detail、lit_review_run、lit_save、lit_sufficiency_check、pwsh、read、
read_image、read_mcp_resource、send_message、session_health、skill、subagent、
subagent_fork、todo_write、update_goal、web_fetch、web_search、workflow、write
```

对照可知：
- ✅ 通用能力齐：`read` / `write` / `edit` / `grep` / `glob` / `pwsh` / `web_search` / `subagent` / `workflow`
- ✅ 还有一批来自全局 patch 的插件：`lit_*`（文献）、`session_*`、`job_*`
- ❌ **没有任何 `typst_*`**——论文插件不在这个进程里
- ❌ 没有 `bsk_*` / `ego_*` / `media_*`（desktop 专属插件确实没进）

### 也就是说
> 它是一个**独立的 DSH 进程**，跟你现在开着 GUI 的那个 DSH **共享** `$DSH_HOME`
> （`profiles/`、`sessions/`、`settings.yaml`、`.credentials.yaml` 都是同一份），
> 但**不共享内存里的插件集合**。
>
> 好处：登录态、模型配置、会话存储天然一致；
> 代价：**它不知道"论文编辑器"这回事**——没有论文结构、编译、大纲这些工具。

## 三、上下文从哪来（这一条容易被忽略）

代理并不是靠工具知道你在看什么，而是靠 **Texpile 把上下文塞进 prompt**：

`agentSession.send()` 里
```ts
bridge.prompt([ ...words, ...imageBlocks(images), ...attachedBlocks(attached) ])
```
- `words`：你打的字
- `attachedBlocks`：**当前打开的文件**（或选中的行区间）作为一个 `resource_link` / 文本块
- 实测面板里那条 `chapter02-theory.typ` 小标签，就是它

所以"知道在改哪篇论文哪一段"这件事，**是客户端给的，不是 agent 自己查的**。

## 四、对"论文适配"的直接结论

### 结论 1：要给它论文工具，唯一干净入口是 `session/new` 的 `mcpServers`
ACP 的 `initialize` 明确回了 `mcpCapabilities: { http: true }`——
**支持 HTTP 形式的 MCP**。所以做法是：

1. 在插件宿主里开一个本地 MCP server，暴露论文能力：
   `typst_outline` / `typst_read` / `typst_write` / `typst_compile` / `typst_query` / `typst_locate`
2. `session/new` 时在 `mcpServers` 里声明它
3. 代理就多出这些工具，且**只属于论文场景**

需要注意的现实问题：ACP 是**独立进程**，它要能访问到这个 MCP 端点。
我们插件现有的路由挂在 DSH 的 HTTP 服务上、用 cookie 鉴权，ACP 子进程没有 cookie。
→ 需要一个**loopback + bearer token** 的专用入口（或让 MCP server 单独监听一个端口）。
这是下一步要定的小设计，不难但必须定，否则声明了也连不上。

### 结论 2：人格（persona）可以在专用 profile 里换掉
`dsh-acp-app` 的 patch 把 persona 设成"编码助手"。如果做专用 profile，
可以在其 patch 里换成"论文写作助手 + 学术规范"，比在每条 prompt 里重复嘱咐更省 token、更稳。

### 结论 3：现在它"能改论文"但"不懂论文"
- 能：`read`/`write`/`edit` 按路径直接改，我们已经验证过（`_dsh_probe.txt`）；
- 不懂：不知道章节结构、不知道哪个是 main.typ、不会编译、不会查 label/引用。
- 所以**当前 agent 改论文是"盲改文本"**——能用，但风险高（容易破坏 Typst 结构）。

这正好是加 `typst_*` 工具要解决的问题，也解释了为什么"先了解运行预设"是对的。

## 五、一句话总结

| 问题 | 答案 |
|---|---|
| 工作区怎么定 | `settings.acpWorkspace` → 否则 `activeRoot`（**当前就是这篇论文的文件夹**） |
| 会话存哪 | `$DSH_HOME/sessions/--<cwd 编码>--/`，按工作区分组 |
| 插件独立吗 | **独立进程**，但共享 `$DSH_HOME`；只装 base + acp-app + **用户级全局 patch** |
| 有我们的论文插件吗 | **没有**，所以没有 `typst_*` 之类的论文工具 |
| 上下文哪来 | 客户端（Texpile）把当前文件/选中行塞进 prompt |
| 加能力的入口 | `session/new` 的 `mcpServers`（HTTP），需要一个 ACP 能访问的 loopback 端点 |
