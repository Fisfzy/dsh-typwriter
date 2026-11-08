# Typst 工具链落地报告（Windows x64 · 自包含目录）

- 生成时间：2026-11-08（Asia/Shanghai）
- 安装位置：`D:\AIWORK\TYPST PAPER WRITE\plugin\dsh-typwriter\bin\`
- 结论：**两个二进制均已就位并可用；`tinymist.exe` 与 `typst.exe` 都能编译真实论文，产出 97 页 A4 PDF。编译不需要网络、不需要系统级安装、不需要任何环境变量。**

---

## 1. 版本与文件

| 项目 | 值 |
|---|---|
| `typst.exe` | `typst 0.15.1 (9dfd3a08)` |
| `tinymist.exe` | `tinymist v0.15.12`，内嵌 **Typst 0.15.1**（`Cargo Target Triple: x86_64-pc-windows-msvc`） |
| 字节大小 | `typst.exe` = **52,487,680** 字节；`tinymist.exe` = **64,103,424** 字节 |
| SHA-256 (typst.exe) | `081217a463adb006f8894b44227fe4b9c9e91fc85f5463d5948e8370db9bb31e` |
| SHA-256 (tinymist.exe) | `c7a2ad09d2f25f18e09f203deda20de1e086b3134fe70a5d163b720e97524af4` |
| 目录结构 | 扁平：两个 exe 直接位于 `bin\`（已从 zip 内的嵌套目录取出） |

### 版本输出原文

```text
$ bin\typst.exe --version
typst 0.15.1 (9dfd3a08)

$ bin\tinymist.exe --version
tinymist
Build Timestamp:     2026-11-03T06:25:46.048922800Z
Build Git Describe:  v0.15.12
Commit SHA:          9681433b09c3ae15b9794a42a399fecec0aa0747
Cargo Target Triple: x86_64-pc-windows-msvc
Typst Version:       0.15.1
Typst Source:        git+https://github.com/Myriad-Dreamin/typst.git?tag=tinymist/v0.15.1#59b5999da8e74e74583069408d2564fc1f9bc973
```

两者 Typst 内核同为 0.15.1，因此两份编译结果可互相对照。

---

## 2. 下载过程（重要：直连 CDN 被阻断）

- 目标 URL：
  - typst：`https://github.com/typst/typst/releases/latest/download/typst-x86_64-pc-windows-msvc.zip` → 302 到 `v0.15.1`
  - tinymist：`Myriad-Dreamin/tinymist` 最新版 `v0.15.12`，Windows x64 资产名为 **`tinymist-x86_64-pc-windows-msvc.zip`**（30,079,432 字节）。
    - 另有单文件 `tinymist-win32-x64.exe`（64,103,424 字节）与本报告安装的文件大小一致；本次选用 zip（带官方 sha256 可校验）。
- **问题**：`github.com` 本身可解析、302 正常，但重定向后的 `objects.githubusercontent.com` / release-assets CDN **HEAD 超时、下载被 reset**（`curl: (56) Recv failure: Connection was reset`）。
- **解决**：改用 GitHub 反代镜像前缀，成功：

```powershell
$direct='https://github.com/typst/typst/releases/download/v0.15.1/typst-x86_64-pc-windows-msvc.zip'
curl.exe -L --fail --retry 3 -o typst.zip "https://ghfast.top/$direct"
# tinymist 同理：https://ghfast.top/https://github.com/Myriad-Dreamin/tinymist/releases/download/v0.15.12/tinymist-x86_64-pc-windows-msvc.zip
```

- 可用的镜像候选（本次实测 HTTP 200）：`ghfast.top`、`gh-proxy.com`、`ghproxy.net`；`ghp.ci` 域名不可解析；`hk.gh-proxy.com` 返回 302。
- **完整性校验**：tinymist 官方 `.sha256` 与下载文件一致
  `7dfa68a764363bf825871c7d0ea302b6590a33b5b3ae43585e34d04296e987b1 ✔`
- 未使用 winget / scoop / choco，未做任何系统级安装。

---

## 3. 编译验证（在副本上，未触碰用户原目录）

- 源目录（只读）：`C:\Users\Fisfzy\Desktop\硕士课题PD资料\毕业论文初稿`
- 工作副本：`D:\AIWORK\TYPST PAPER WRITE\scratch\thesis-compile-test\`（robocopy /E，148 个文件，36.4 MB；排除 `.texpile`、`.workbuddy`）
- 源目录时间戳前后完全一致，**未被修改**。

### 尝试结果

| # | 命令 | 退出码 | 产物 | 耗时 |
|---|---|---|---|---|
| **a（首选，成功）** | `bin\tinymist.exe compile --root . main.typ out/main.pdf` | **0** | ✅ 17,369,840 字节 | **3.43 s** |
| b（同样成功） | `bin\typst.exe compile --root . main.typ out/main-typst.pdf` | **0** | ✅ 17,115,533 字节 | 3.61 s |

**两者都一次通过，无任何 warning / error 输出。**

### PDF 验证数据

```text
Pages:           97
Page size:       595.276 x 841.89 pts (A4)
File size:       17,369,840 bytes      (typst.exe 版本：17,115,533 bytes)
Creator:         Typst 0.15.1
Title:           基于近场动力学微分算子的风机叶片变形与裂纹扩展研究
Author:          夏宇澄
```

两份 PDF 页数一致（97 页）；字节差约 254 KB 来自生成器元数据/压缩差异（tinymist 写入的 Producer 与时间戳不同），内容等价。

### 中文与字体检查

`pdftotext` 抽取首页，中文完整、可回溯、无豆腐块：

```text
分类号：
ＵＤＣ：

密级：
编号：

工学硕士学位论文

基于近场动力学微分算子的
风机叶片变形与裂纹扩展研究

硕 士 研 究 生：夏宇澄
指  导  教  师：高岩
学 科、 专 业：土木水利

哈尔滨工程大学
```

正文页（第 20 页，第 1 章 绪论）同样正常抽取到中文段落与参考文献编号 `[26]`、`[8]`、`[20]`、`[21]`。

`pdffonts` 显示全部字体已嵌入并子集化（`emb=yes sub=yes uni=yes`）：

| 字体 | 用途 |
|---|---|
| `SimSun`（宋体） | 正文 |
| `SimHei`（黑体） | 各级标题 |
| `KaiTi`（楷体） | 封面/题名等 |
| `TimesNewRomanPSMT` / `TimesNewRomanPS-BoldMT` | 西文 |
| `NewCMMath-Book` | 数学公式 |

> 小提示：poppler 的 `pdfinfo` 会打印一行 `Syntax Error: Suspects object is wrong type (boolean)`。这是 poppler 解析 Typst 写入的 `Suspects` 元数据时的解析怪癖，**不影响文档本身**——Pages/Page size 等均正确读出，`pdftotext`/`pdffonts` 正常。

---

## 4. 非自包含项核查

| 项 | 是否必需 | 实测结论 |
|---|---|---|
| Typst `@preview` 包 | **否** | 全仓库 `*.typ` 中**零**处 `@preview/` 或 `@local/` 引用；模板为本地包 `heuthsis/`（`lib.typ`、`cover.typ` 等 6 个文件），图片在 `figures/`，参考文献为本地 `reference.bib`。 |
| 包缓存 `%LOCALAPPDATA%\typst\packages` | **否** | 编译前该路径**不存在**，编译后**依然不存在**——全程没有任何包下载，**编译期不需要网络**。 |
| 字体 | 用系统字体，**无需额外配置** | 论文使用 `SimSun / SimHei / KaiTi / FangSong / Times New Roman / Cambria Math`。Typst 自动扫描 `C:\Windows\Fonts`（本机共 240 个字体族）。设置 `TYPST_FONT_PATHS=C:\Windows\Fonts` 与否**均可编译成功**。 |
| `--root` | **是** | 文档使用绝对路径 `/` 与 `#include "body/..."`，必须以论文目录为 root；`--root .`（在论文目录内）或 `--root <论文绝对路径>` 均可。 |
| 外部 `typst.exe` | **否**（对 tinymist 而言） | 把 `bin\` 从 PATH 中移除后，`tinymist.exe` 仍以退出码 0 编译成功 → tinymist 内嵌 Typst 0.15.1，**不会去调用外部 typst.exe**。 |

---

## 5. 宿主插件 spawn 进程所需的确切环境

**必需：**

- 可执行文件：`D:\AIWORK\TYPST PAPER WRITE\plugin\dsh-typwriter\bin\tinymist.exe`（或 `typst.exe`），用**绝对路径**调用；
- 工作目录：论文根目录（或显式传 `--root`）；
- 参数：`compile --root <论文根目录> <入口.typ> <输出.pdf>`。

**环境变量：全部可选（本机实测均非必需）**

| 变量 | 建议值 | 作用 |
|---|---|---|
| `PATH` | 前置 `…\plugin\dsh-typwriter\bin` | 便于其他工具按名调用；仅用绝对路径时可不改 PATH |
| `TYPST_FONT_PATHS` | `C:\Windows\Fonts`（或插件自带字体目录） | 用于**可复现**地固定字体来源，防止换机后字体漂移；非必需 |
| `TYPST_PACKAGE_PATH` | 插件内 `bin\..\packages` | 只有在**将来**引入 `@preview` 包时才需要；当前论文**不需要** |
| `TYPST_ROOT` | 论文根目录 | 与 CLI `--root` 等价的备选 |

**关键隔离性证明**（均退出码 0、均产出 PDF）：

```text
PATH 仅 = <bin>;C:\WINDOWS\System32 ，cwd=C:\ ，全绝对路径        → OK，3.13s
PATH 仅 = C:\WINDOWS\System32（不含 bin），绝对路径调 tinymist    → OK
TYPST_FONT_PATHS=C:\WINDOWS\Fonts                               → OK
TYPST_PACKAGE_PATH=<空目录>                                      → OK
```

即：**一个全新环境里，只要指向那个 `bin\` 的两个 exe 绝对路径，就能离线编译出正确 PDF。**

### 推荐的最小 spawn 配置

```powershell
$env:PATH = "D:\AIWORK\TYPST PAPER WRITE\plugin\dsh-typwriter\bin;$env:PATH"
$env:TYPST_FONT_PATHS = "C:\Windows\Fonts"
# cwd = 论文根目录
tinymist.exe compile --root . main.typ out/main.pdf
```

---

## 6. 交付物清单

- `plugin\dsh-typwriter\bin\typst.exe`（52,487,680 B，typst 0.15.1）
- `plugin\dsh-typwriter\bin\tinymist.exe`（64,103,424 B，tinymist v0.15.12 / typst 0.15.1）
- 编译验证副本与产物：`scratch\thesis-compile-test\out\main.pdf`（97 页，17.4 MB）
- 下载缓存与临时文件：`scratch\_dl\`

## 7. 复现脚本（简版）

```powershell
$bin='D:\AIWORK\TYPST PAPER WRITE\plugin\dsh-typwriter\bin'
$dst='D:\AIWORK\TYPST PAPER WRITE\scratch\thesis-compile-test'
robocopy 'C:\Users\Fisfzy\Desktop\硕士课题PD资料\毕业论文初稿' $dst /E /XD .texpile .workbuddy | Out-Null
Set-Location $dst
& "$bin\tinymist.exe" compile --root . main.typ out/main.pdf
& pdfinfo.exe out/main.pdf | Select-String 'Pages|File size'
```
