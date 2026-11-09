# 改上游代码的规则（防"稍微一改就全盘爆炸"）

这个仓库是 **Texpile 上游 + 我们的补丁**。补丁散着打、不校验、没回滚点，就一定会出现
"改一处、整包构建失败"或"改动悄悄没生效"的情况——这两种都发生过。

## 三条硬规则

### 1. 开工前先跑 preflight（1.1 秒）
```bash
pnpm run preflight      # = patch:check + check:svelte
```
- `patch:check`：12 条受管补丁的锚点是否还在。**锚点没了就退出码 1**——说明上游变化让补丁失效，
  此时不要再继续改别的，先修补丁。
- `check:svelte`：444 个 `.svelte` 的结构 parse，1.1 秒。
  > 实测：故意漏一个 `{/if}` → `FAIL: 1/445  Block was left open`，1 秒内报出、退出码 1。
  > 而完整 `vite build` 要 75 秒才发现同一个错误。

### 2. 补丁只走清单，不写一次性脚本
`scripts/patches.mjs` 里每条补丁都要有：
- `id`、`why`（为什么改）
- `file`（精确路径）
- `search`（**必须恰好命中 1 次**；用文本锚点，不用行号）
- `replace`

```bash
node scripts/patches.mjs --list      # 看清单
node scripts/patches.mjs --check .   # 只校验（不写）
node scripts/patches.mjs --apply .   # 幂等应用
```
状态含义：`APPLIED`（已打）/ `PENDING`（待打）/ `ANCHOR_GONE`（锚点失效）/ `AMBIGUOUS`（命中多次）。

### 3. 每过一步就 commit
```bash
git add -A && git commit -m "xxx: 说明"
git checkout -- .        # 改坏了：秒回上一个可用状态
```

## 两条设计约束（这次事故的直接教训）

### A. 不要用"运行环境"门控可见性
上一轮的 bug：我用 `{#if embedded}`（`window.self !== window.top`）包住「偏好设置」和「返回 DSH」，
结果直接打开 URL（顶层窗口）时两个按钮**整个不渲染**，看起来就像"设置跑回文件菜单了"。

规则：**UI 元素一旦存在就常显**。需要区分环境时：
- 用**能力探测**（例如 `typeof fn === 'function'`）+ 降级行为，
- 不要用整体隐藏。

### B. 界面改动必须"两种上下文 + 强制重载"验证
- 顶层直接打开、iframe 嵌进宿主，**两种都要看**
- 一律带 cache-busting：`/typwriter/?v=N`
  （上一轮我被旧 bundle 误导，白测了一轮）

## 优先"加"而不是"改"
能新增组件/新增属性（带默认值）解决的，就不去改上游现有的 `{#if}` 树或事件链。
上游结构越少动，升级时冲突越少，出事面越小。

## 发布（Typwriter 插件）

**规矩：GitHub 与 npm 两端都要发**——GitHub 是源码与文档的家，npm 是 `dsh plugin add` 的安装源，缺一不可。

发版清单（版本号三处同步：plugin package.json / 本 CHANGELOG 或提交信息 / git tag）：

1. 确认 `plugin/dsh-typwriter/app/` 是最新构建（`pnpm --filter texpile-editor exec vite build --outDir dist-typwriter --base /typwriter/app/` + 拷贝）
2. bump `plugin/dsh-typwriter/package.json` 的 `version`
3. 提交并推送 GitHub：`git push origin master:main`
4. 打 tag：`git tag plugin-v0.x.y && git push origin plugin-v0.x.y`
5. 发 npm（在 `plugin/dsh-typwriter/` 下）：
   - Granular token 首次发包会进 staging：`npm stage publish --access public`，然后 `npm stage approve <id>`（浏览器 2FA 一次）
   - 之后版本可直接 `npm publish --access public`
6. 验证：`npm view dsh-typwriter version` 与 GitHub Releases 都可见
