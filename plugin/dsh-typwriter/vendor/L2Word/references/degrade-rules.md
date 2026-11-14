# 降级规则：LaTeX 构造 → Word 对应物

S1 审计把风险分成 high / medium / low。**high 项必须在 S3 之前处理**，转完之后再补等于重做。
本文件只讲"怎么改"，改完仍要重新跑 `scan_tex.py` 确认风险清零。

## high：会丢内容，必须先处理

### TikZ / pgfplots
整块图丢失，只剩 caption。Word 没有矢量绘图引擎。

处理：单独编译成 PDF，再当图片插入。

```bash
# 把 tikzpicture 抽成独立文档编译
xelatex -interaction=nonstopmode fig1.tex      # 得到 fig1.pdf
pdftoppm -r 300 -png fig1.pdf fig1             # 或直接留 PDF
```

然后 `.tex` 里改成 `\includegraphics[width=\linewidth]{fig1.pdf}`。
pandoc 会把 PDF 转成 Word 里的图片，**但 PDF 里的公式不会变成 MathType**——
如果图里有公式，宁可重新画一遍，也不要指望转换。

### algorithm2e / algorithm / algorithmic
pandoc 整块丢弃，**连里面的行内公式也一起消失**。`filled.json` 的 `unplaced`
字段会列出这些公式的行号，用来核对丢了什么。

处理顺序（按代价从低到高）：
1. 算法本身简单 → 改成 `\begin{enumerate}` 或三线表；
2. 需要保留伪代码外观 → 用 `verbatim` 排版（会丢公式）；
3. 必须保留公式 → 手工在 Word 里重排一页。

### tcolorbox / mdframed
只剩框内文字，装饰壳全丢。视觉上像"框不见了"，容易误判为丢内容。

处理：改成普通段落 + 底纹（Word 段落边框），或整块截图。

### 模板自定义的 front matter 命令（`\affil`、`\institute`、`\address` …）
pandoc **连参数一起丢掉**，不报错。作者单位、通信地址会整块消失，而 docx 里看不出"少了一段"。
实测：IOP `iopconfser.cls` 的 `\affil{...}` 两段全丢。

处理：`tex_struct.py` 的 `AFFIL_CMDS` 已覆盖常见叫法（自动编号、自动剥掉单位自带的上标）；
其它名字走 `unwrap_front_macros()` 兜底——只要是本工程定义过、且只吃一个参数，就展开成段落并告警。
**新模板出现新的元数据命令时不要改代码**，让它走兜底即可；但如果它带两个以上参数，
需要在 `AFFIL_CMDS` 里单独加分支。

### 双栏（`\documentclass[twocolumn]`）
pandoc 出的是单栏。转完再调很痛苦。

处理：`learn_style.py` 量 PDF 时版心宽取的是两栏并集，正文会按单栏排。要保留双栏就给一个
双栏的 `.docx` 模板走 `--reference-doc`。

## medium：能转但会变形，转完要人工过一遍

| 构造 | 结果 | 处理 |
|---|---|---|
| `figure` / `table` 浮动位置 | 内联到出现处 | Word 里手动拖；论文级排版本来就该人工定 |
| `\caption` 内的 `\label` | 保留编号映射，图题可能合并 | 检查 `equations.json` 的 `label_numbers` |
| `subfigure` / `subcaption` | 子图排成一行或堆叠 | 手工拆成独立图 |
| `biblatex` | pandoc 的 citeproc 只认 bibtex 风格 | 先转 `\bibliography{refs}` + `refs.bib` |
| `siunitx` 的 `\SI{}{}` | 在数学里会整段失败 | 改成 `9.81\,\mathrm{m/s^2}` |
| 自定义 `\newenvironment` | 内容可能保留、外壳丢失 | 展开成显式命令 |

## low：可以不管

`\verb`（样式丢、字保留）、`\footnote`（变尾注或丢失，视上下文）、
`\thanks`、`titlesec` 的间距微调、`geometry` 的页面参数（由模板决定）。

## 公式侧的降级（和排版无关）

MathType 的 TeX 翻译器是子集。下面这些在 S2 已经被 `tex_macros.py` 改写，
新遇到的按同样思路加：

| 原写法 | 改写为 | 原因 |
|---|---|---|
| `\norm{x}` | `\left\|x\right\|` | 自定义宏，MathType 不认识；若论文自己定义了 `\norm`，会优先用论文的定义 |
| `\lVert` / `\rVert` / `\Vert` | `\|` | amsmath 定界符，翻译器只认 `\|` |
| `\bm{x}` | `\mathbf{x}` | bm 包不在翻译器词表里 |
| `\R` / `\N` / `\Z` | `\mathbb{R}` 等 | 同上 |
| `\argmin` | `\arg\min` | 否则整段失败 |
| `\operatorname*{x}` | `\mathrm{x}` | 星号版本不支持 |
| `\tfrac` / `\dfrac` | `\frac` | 只保留 `\frac` |
| `\text{中文}` | 保留 | **实测支持**，不必回避 |

唯一已知的硬失败：`\sqrt[3]{x}` 这类可选指数根式。失败时 MathType 会**静默吞掉原文**，
所以 S4 必须保留快照并在失败时回填——只数对象个数是不够的，要在转换前把段落原文存下来。
