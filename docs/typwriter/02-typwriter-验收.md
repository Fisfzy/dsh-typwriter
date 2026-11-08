# dsh-typwriter 验收报告（阶段 0–2 打通）

日期：2026-11-08 · 目标文档：`C:\Users\Fisfzy\Desktop\硕士课题PD资料\毕业论文初稿`

---

## 一、结论

**能正常修改、能正常编译。** 全链路已在独立宿主上跑通，不是推断：

| 验收项 | 结果 |
|---|---|
| 插件形态（左上角入口 + 主区整页） | ✅ client bundle 注册 `sidebar.panellist` + `main` |
| Texpile 界面复用 | ✅ 7543 文件 / 80.63 MB 构建产物，未重写任何 UI |
| **中文界面** | ✅ `document.documentElement.lang = "zh-Hans"`，菜单显示「文件 编辑 视图 插入 格式 拼写检查 终端 帮助」 |
| 打开该论文工程 | ✅ 文件树读到 `body/ heuthsis/ figures/ out/ source-latex/ tools/`、`main.typ`、`reference.bib` |
| 识别主文件 | ✅ 按工程自带 `.texpile/config.json` 的 `main: main.typ` |
| Typst 可视化编辑 | ✅ 可视化/源代码双模式，大纲解析出中文章节（绪论、近场动力学微分算子理论…） |
| 引用解析 | ✅ `reference.bib` 解析出 **72 条**参考文献并渲染 |
| **修改并落盘** | ✅ 在源代码模式输入 1 个空格 → 文件 3731 → **3732 字节**，SHA256 变化，mtime 更新 |
| **编译出 PDF** | ✅ 快捷键 `Ctrl+Alt+Enter` → `tinymist compile` → `output/main.pdf` **17,369,840 字节** |
| **PDF 面板** | ✅ 显示 **97 页**，pdf.js 渲染（2 个 canvas） |
| 用户文件完整性 | ✅ 测试后 `main.typ` 已还原，SHA256 与原始一致（`AB7FF59B…`） |

验证产物：`reports/proof-typwriter-thesis.png`

---

## 二、架构（已落地）

```
DSH 左上角「Typst 写作台」
└─ 主区同源 iframe → /typwriter/
   ├─ index.html（宿主注入 __TEXPILE_BOOTSTRAP__ + shim.js，顺序不能错）
   ├─ /typwriter/shim.js           ← 等价于 electron preload，10 个全局
   └─ Vite 产物（未改 UI）
        ↓ 同源 fetch / SSE
插件 host 半片（inject: ['webServer','connection']）
├─ /typwriter/api/rpc      POST，1:1 映射 ipcRenderer.invoke 通道名
├─ /typwriter/api/file     GET，取代 texfile://（Range 206 / ETag 304 / 根目录围栏）
├─ /typwriter/api/events   SSE，所有单向下发（terminal:data 等）
└─ /typwriter/*            静态（app/ · spell/ · themes/ · assets/）
```

实现文件：`plugin/dsh-typwriter/`
- `src/host/index.js` 路由与注入 · `rpc.js` 通道派发 · `fsops.js` 文件算子 · `term.js` 终端 · `static.js` 静态与字节 · `state.js` 持久化
- `src/browser/shim.js` 浏览器桥（同步 bootstrap + 全部全局）
- `dist/client.js` 双 slot 注册
- `app/` 构建产物 · `bin/` typst 0.15.1 + tinymist 0.15.12

---

## 三、修掉的三个真坑（都会导致"界面正常但什么都不发生"）

1. **静态路由重复前缀**：`index.html` 的 URL 是 `/typwriter/app/...`，按 `/typwriter/` 剥后又拼成 `app/app/...` → 主模块 404 → `#app` 空。修法：`rel.startsWith('app/')` 时再剥一层。
2. **宿主 PATH 没有 System32**：`spawn('powershell.exe')` 直接 `ENOENT`。修法：用 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` 绝对路径，并把 System32、Wbem 补回子进程 PATH；找不到 powershell 时降级 `cmd`（并让返回的 `shell` 名与 sentinel 语法一致）。
3. **Typst 默认走实时预览而不是 shell 编译**：`compileConfig.typst.preview` 默认 `true`，此时 `Ctrl+Alt+Enter` 只会去连 tinymist 预览服务（显示"实时 正在连接"），永远不出 PDF。修法：工程配置 `"typst": { "preview": false }`，走标准 `tinymist compile` 车道。

---

## 四、编译命令（实测，无需任何环境变量）

```
tinymist compile --root . main.typ output/main.pdf 2>output/main.log
```

- 完全离线：该工程无 `@preview` 导入，`%LOCALAPPDATA%\typst\packages` 未创建
- 字体：SimSun / SimHei / KaiTi / Times / NewCMMath 全部嵌入子集，中文抽取正常无豆腐块
- 耗时约 3.4 s，97 页 A4

---

## 五、本次对目标工程做的改动（需你知情）

| 路径 | 改动 | 说明 |
|---|---|---|
| `.texpile/config.json` | 增加 `"typst": { "preview": false }` | **建议保留**：否则 Typst 项目默认只能在 tinymist 预览里看，无法产出 PDF |
| `output/` | 新建目录 + `main.pdf` + `main.log` | 编译产物，与工程已有的 `out/` 并存 |
| `main.typ` | 编辑测试后已**完整还原** | SHA256 与原始一致 |

---

## 六、尚未实现（下一批）

| 项 | 状态 | 影响 |
|---|---|---|
| tinymist LSP（补全/诊断/悬停） | 未接 | 有语法高亮与大纲，无智能提示 |
| Typst 实时预览（tinymist preview） | 未接 | 用"编译→PDF 面板"替代，可接受 |
| 目录监视 | 未实现 | git 切分支等外部改动不会自动刷新 |
| Git 面板 | 桩（`not-a-repo`） | 面板降级不报错 |
| PDF/PNG 导出（另存为） | 未实现 | 需原生保存对话框 |
| 中文拼写检查 | 无中文词典 | 全红波浪线风险（默认语言已随 `zh-Hans`） |
| **注册进 DSH profile** | **未做** | 需要在 `profiles/desktop` 加 link 依赖 + bundle + 重启一次 |

> 由于重启 DSH 桌面端会结束当前会话，安装这一步留给你确认后再做。
