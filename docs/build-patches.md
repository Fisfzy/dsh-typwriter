# Texpile 渲染器：可 Web 托管构建（dist-typwriter）补丁与产物报告

日期：2026-11-08
工作副本：`D:\AIWORK\TYPST PAPER WRITE\scratch\texpile-build`（唯一被修改的源码树）
原始仓库：`D:\AIWORK\TYPST PAPER WRITE\texpile` —— **未修改**（只读引用）
产物交付：`D:\AIWORK\TYPST PAPER WRITE\plugin\dsh-typwriter\app\`
构建日志：`scratch\texpile-build\build-typwriter.log`

---

## 1. 构建结果

| 项 | 值 |
|---|---|
| 命令 | `pnpm --filter texpile-editor exec vite build --outDir dist-typwriter --base /typwriter/app/` |
| 退出码 | **0** |
| 耗时 | 70.3 s（vite 自报 `built in 1m 2s`） |
| 产物目录 | `apps/texpile-editor/dist-typwriter` |
| 文件数 | **7543** 个文件 |
| 体积 | **80.63 MB**（robocopy 报告 80.62 MB 字节数，一致） |
| 复制方式 | `robocopy <dist> <app> /E /MT:16`，退出码 1 = 有文件被复制（成功） |
| 校验 | `plugin\dsh-typwriter\app\index.html` 存在；`<head>` 中 61 处 URL **全部** 以 `/typwriter/app/` 开头，无例外 |

产物顶层结构：`assets/`、`spell/`、`themes/`、`favicon.svg`、`index.html`、`theme-init.js`。

---

## 2. 四项补丁（file : line，旧 → 新）

### 补丁 (1) 默认界面语言 → 简体中文

`apps/texpile-editor/src/lib/settings.ts:162`（DEFAULTS 对象内）

```diff
-	uiLocale: 'en',
+	uiLocale: 'zh-Hans',
```

核验：`uiLocale` 在 `src` 内共 18 处引用，运行期默认值只有这一处（`settings.ts:89` 是类型联合，`localeMeta.ts` / `prefsOptions.ts` / `PrefsAppearancePanel.svelte` 是选项列表，`migration/settings.ts` 是迁移白名单，其余是注释）。`main.ts:48` 先 `loadSettings()` 再 `mount()`，`loadSettings()` 内 `applyUiLocale(merged.uiLocale, { reload: false })` 会在首帧前把 Paraglide 运行期 locale 与 `<html lang>` 设为 `zh-Hans`，因此全新 profile 首屏即中文，无英文闪烁。

说明：`index.html` 的 `<html lang="en">` 是静态初始属性，由上面这行在挂载前覆盖，属预期，未单独改动。

### 补丁 (2) `texfile://` 协议 → HTTP 路由

原始字节改由 **`GET /typwriter/api/file?path=<encoded>`** 提供；桌面端的 `texfile://` 仍被接受，二者并存。

**a. 构造函数** — `src/lib/workspace/fileSystem.ts:418-425`

```diff
 export function fileUrl(path: string): string {
-	return `texfile://local/?path=${encodeURIComponent(path)}`;
+	return `/typwriter/api/file?path=${encodeURIComponent(path)}`;
 }
```

**b. 解析点 1** — `src/lib/workspace/fileSystem.ts:524-529`（`pathFromFileUrl`）

```diff
-	const m = url.match(/^texfile:\/\/local\/?\?path=([^&]+)/);
+	const m = url.match(/^texfile:\/\/local\/?\?path=([^&]+)/) ?? url.match(/^\/typwriter\/api\/file\?path=([^&]+)/);
 	return m ? decodeURIComponent(m[1]) : null;
```

**c. 解析点 2 / 3** — `src/lib/editor/visual/fileAccess.ts:41-53`

```diff
+const HTTP_FILE_URL = '/typwriter/api/file';
+
 export function pathOfFileUrl(url: string): string | null {
-	return url.startsWith('texfile:') ? new URL(url).searchParams.get('path') : null;
+	if (url.startsWith('texfile:')) return new URL(url).searchParams.get('path');
+	if (url.startsWith(HTTP_FILE_URL)) return new URL(url, 'http://file.invalid').searchParams.get('path');
+	return null;
 }
 
 export async function fileUrlExists(url: string): Promise<boolean> {
-	if (url.startsWith('texfile:')) {
+	if (url.startsWith('texfile:') || url.startsWith(HTTP_FILE_URL)) {
```

> `new URL()` 对相对路径会抛异常，所以新增分支带了占位 base（`http://file.invalid`）；`searchParams.get('path')` 的取值不受 base 影响。

**d. 无需改动但已核对的一处** — `fileSystem.ts:534` `isRemoteSrc()`：
`/^(https?:|data:|blob:|file:|texfile:|\/)/i` 已以 `\/` 兜底，`/typwriter/api/file?...` 天然被判为"非磁盘相对路径"，行为正确，故意保持原样。

**扫描计数（`apps/texpile-editor/src` 全树）**

- 大小写不敏感搜 `texfile`：**15** 处命中。
- 其中 3 处是 LaTeX 命令名（`addlatexfiles`、`insertlatexfile`、`texfiletree`，位于 `languages/latex/knowledge/data/**`），与协议无关。
- 真正与协议相关：**12** 处 = **5 个代码点**（1 构造 + 3 解析/判定 + 1 已兼容的正则）+ 7 处注释。
- `electron/src/appProtocols.ts`、`electron/src/fontT1Map.ts`、`tests/**` 另有 `texfile` 引用，属桌面端与测试，未改动。

### 补丁 (3) 根绝对资源路径 → 基相对

改了 3 个运行期站点（都是"改一行就能对"的干净补丁），使产物不再依赖站点根：

**`src/lib/theme.ts:81`**

```diff
-		link.href = `/themes/${name}.css`;
+		link.href = `${import.meta.env.BASE_URL}themes/${name}.css`;
```

**`src/lib/modals/window/ThemePicker.svelte:22`**

```diff
-		fetch('/themes/index.json')
+		fetch(`${import.meta.env.BASE_URL}themes/index.json`)
```

**`public/theme-init.js:29-38`（public 资源，Vite 不会按 `--base` 重写，必须手工改）**

```diff
-			document.write('<link id="texpile-theme" rel="stylesheet" href="/themes/' + name + '.css">');
+			var href = 'themes/' + name + '.css';
+			if (document.currentScript && document.currentScript.src) {
+				href = document.currentScript.src.replace(/[^/]*$/, '') + href;
+			}
+			document.write('<link id="texpile-theme" rel="stylesheet" href="' + href + '">');
```

（脚本自身所在目录 = 产物根的 `themes/`；无论宿主前缀是什么、也无论 iframe 地址是否带结尾斜杠，解析都正确。）

#### 根绝对 URL 清单（宿主必须知道的事实）

**改前**（参考产物 `dist-plugin`，base `/texpile-desk/app/`）的根绝对引用：

| 来源 | URL | 处置 |
|---|---|---|
| `index.html` `<link rel=icon>` | `/favicon.svg` | Vite 按 base 重写，已自动变为 `/typwriter/app/favicon.svg` |
| `index.html` `<script>` | `/theme-init.js` | 同上，已重写 |
| `theme.ts` → `assets/theme-*.js` | `` `/themes/${name}.css` `` | **已修补**为 `${BASE_URL}themes/…` |
| `ThemePicker.svelte` → `PreferencesDialog-*.js` | `fetch('/themes/index.json')` | **已修补**为 `${BASE_URL}themes/index.json` |
| `public/theme-init.js`（原文件字面量） | `/themes/<name>.css`（仅当用户存过预设主题时 document.write） | **已修补**为脚本相对路径 |

**改后实测**：`dist-typwriter/index.html` 的 61 处 `href/src` 全部是 `/typwriter/app/…`；全量 `assets/*.js` 中已无指向 `/themes`、`/spell`、`/favicon` 的根绝对字面量（唯一残留的 `"/assets/paper/default.jpg"` 是 LaTeX 宏包知识库里 beamer `background` 选项的默认值字符串，从不会被 fetch）。

**因此宿主只需提供：**

1. `/typwriter/app/*` → `plugin\dsh-typwriter\app\` 静态文件（**建议按带结尾 `/` 的目录形式提供 index.html**）；
2. `/typwriter/api/file?path=<绝对路径>` → 原始字节（这是本应用**唯一**的非静态数据出口，用于编辑器图片、插图预览、编译出的 PDF、T1 字体读取）；
3. 可选但推荐：`themes/*.css` 已在产物内，无需额外路由；`spell/*.trie.gz` 通过 `new URL('spell/', document.baseURI)` 解析 → 依赖文档 baseURI 以 `/` 结尾，同样由第 1 条保证。

---

## 3. 死重量裁剪结论（遵循"宁可不删"原则）

| 资产 | 大小 | 结论 |
|---|---|---|
| `assets/live-preview-demo-Ct-F_3-N.mp4` | **1.45 MB** | **保留** —— 被 `src/lib/modals/window/WhatsNewModal.svelte:5` 静态 `import demoVideo from '$lib/assets/live-preview-demo.mp4'`，删文件会让构建直接失败、仅删产物则留下 404。非死重。 |
| `assets/harper_wasm_bg-Cqq8NHnk.wasm` | **19.31 MB** | **保留**（按要求，仅报体积）。占产物 24%，是最大单项。 |
| `spell/` | **14.17 MB / 24 个文件** | **保留**（按要求，仅报体积）。其中 `de.trie.gz` 3.5 MB、`pt-BR` 2.6 MB、`fr` 2.5 MB、`pl` 2.3 MB 为大头。 |
| `assets/texpile_typst_syntax_wasm_bg-*.wasm` | 0.26 MB | 保留（Typst 解析器，启动即用）。 |

本次**没有删除任何文件**：唯一"像死代码"的 mp4 证实被静态 import。若后续确实想省 1.45 MB，正确做法是删掉 `WhatsNewModal.svelte` 里对应片段再重建，而不是删产物文件。

---

## 4. 构建告警（不影响成功）

1. **chunk > 500 kB**（Vite 默认阈值，Info 级）：`WorkspaceView-*.js` 3.0 MB（gzip 902 kB）、`sharedFiles-*.js` 1.59 MB、`mathlive-*.js` 875 kB、`pmComments-*.js` 656 kB、`pdf-*.js` 487 kB。属该应用原有体量，未调 chunk 切分（动 rollup 配置风险高于收益）。
2. `[PLUGIN_TIMINGS]` 时间分布（vite-plugin-wasm load 23.3 s、svelte compile 9.2 s 等）——纯信息性。
3. 无 TS / Svelte 编译错误、无缺失依赖、无 `externalized for browser compatibility` 警告。

---

## 5. 上游回放用的统一 diff 摘要（AGPL 披露）

改动仅 **6 个文件、7 处 hunk**，全部在工作副本内；原始仓库未被触碰。

| # | 文件 | 行 | 旧 | 新 |
|---|---|---|---|---|
| 1 | `apps/texpile-editor/src/lib/settings.ts` | 162 | `uiLocale: 'en',` | `uiLocale: 'zh-Hans',` |
| 2 | `apps/texpile-editor/src/lib/workspace/fileSystem.ts` | 423 | `` return `texfile://local/?path=${encodeURIComponent(path)}`; `` | `` return `/typwriter/api/file?path=${encodeURIComponent(path)}`; `` |
| 3 | `apps/texpile-editor/src/lib/workspace/fileSystem.ts` | 528 | `const m = url.match(/^texfile:\/\/local\/?\?path=([^&]+)/);` | `... ?? url.match(/^\/typwriter\/api\/file\?path=([^&]+)/);` |
| 4 | `apps/texpile-editor/src/lib/editor/visual/fileAccess.ts` | 41-53 | `pathOfFileUrl` 仅识别 `texfile:`；`fileUrlExists` 仅识别 `texfile:` | 新增常量 `HTTP_FILE_URL = '/typwriter/api/file'`，两处 `startsWith` 同时接受两种形式；`new URL` 走占位 base |
| 5 | `apps/texpile-editor/src/lib/theme.ts` | 81 | `` link.href = `/themes/${name}.css`; `` | `` link.href = `${import.meta.env.BASE_URL}themes/${name}.css`; `` |
| 6 | `apps/texpile-editor/src/lib/modals/window/ThemePicker.svelte` | 22 | `fetch('/themes/index.json')` | `` fetch(`${import.meta.env.BASE_URL}themes/index.json`) `` |
| 7 | `apps/texpile-editor/public/theme-init.js` | 29-38 | `href="/themes/' + name + '.css"` 硬编码站点根 | 以 `document.currentScript.src` 所在目录为基准拼 `themes/<name>.css` |

（另含补丁 2、3 中新增的 4 行注释，无行为影响。）

构建命令（回放用）：
```
pnpm --filter texpile-editor exec vite build --outDir dist-typwriter --base /typwriter/app/
```

> AGPL 说明：Texpile 为 AGPL-3.0 项目。上表 7 处修改属于对源码的修改，随产物一同分发时必须向接收方提供对应源码（含这 7 处补丁）。工作副本 `scratch\texpile-build` 即为该源码树。

---

## 6. 与宿主插件的对接要点（供 iframe 集成方参考）

- iframe 的 `src` 应为 `/typwriter/app/`（带结尾斜杠），或任意映射到该目录的路径；产物内部引用全部带 `/typwriter/app/` 前缀，所以**前缀必须真的是 `/typwriter/app/`**，改前缀需重新构建。
- 应用通过 `window.texpileNative` 桥接 `fs:*` IPC（读写文件、stat、扫描目录）；未注入时打开工作区会失败——但应用本体、偏好设置、主题、编辑器壳可正常渲染。桥接口径见 `reports/texpile-bridge-spec.md`。
- `GET /typwriter/api/file?path=` 需要支持 `HEAD`（`fileUrlExists()` 会发 `HEAD` 探测）、`Range` 与 PDF 的流式读取，并返回正确 `Content-Type`；编译器还会在 URL 后追加 `&t=<mtime>` 做缓存击穿，故实现须忽略未知查询参数。
- 产物 ~80 MB（其中 33.5 MB 是 harper wasm + spell 词典），建议宿主对该前缀开启 `Cache-Control: immutable`（文件名已带内容哈希）。
