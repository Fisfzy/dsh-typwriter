---
name: L2word-mathtype
description: 把 LaTeX 论文转换成 Word，公式落地为可双击编辑的原生 MathType 对象，且全程不生成 OMML。当用户要求"LaTeX 转 Word"、"tex 转 docx"、"论文导成 Word 且公式要是 MathType 格式"、"公式批量转 MathType"、"保留章节/图表/公式编号"时使用。适用于含大量公式与复杂排版的学术论文。
---

# LaTeX → Word（MathType 公式，无 OMML）

## 一句话

`.tex` 里的公式**全程以 LaTeX 源码形态流转**：pandoc 只处理正文骨架，公式被抽成占位符绕过去；最后一步用 MathType 官方宏 `Toggle TeX` 原地换成 `Equation.DSMT4` 对象。**文档里永远不会出现 OMML。**

## 能做什么 / 别指望什么

**适合**：含十几到几百个公式的**学术论文**（会议/期刊投稿稿、预印本），单栏或"双栏改单栏"都行；
产物是**可继续编辑的 Word 工作稿**——公式双击能改、编号是域能重排、章节图表都在。

**不适合**（不是能力不足，是这条路走不通，别硬上）：

| 需求 | 为什么不行 | 换什么 |
|---|---|---|
| 交付**出版级排版**（与 LaTeX 输出像素级一致） | Word 的断行/浮动/字距算法和 TeX 不同，页数会差 ±1 页 | 直接用 PDF 投稿；Word 只当协作/返修载体 |
| 公式要**图片**交付 | IOP/Springer 等明确禁止公式转图片 | 本技能给的正是可编辑对象，符合要求 |
| TikZ / pgfplots 矢量图保真 | Word 没有矢量绘图引擎 | 先 `xelatex` 单独编译成 PDF 再 `\includegraphics` |
| 保留**双栏版式** | pandoc 出的是单栏 | 给一个双栏 `.docx` 走 `--reference-doc`，或转完手工分栏 |
| 在 macOS / Linux / 只有 LibreOffice-WPS 的机器上跑 | OLE 对象必须由**桌面版 Word** 写入 | 换 Windows + Word + MathType 7 完整版 |

**硬性环境**（缺一件就跑不动，`doctor.py` 会直接报）：Windows + 桌面版 Word + MathType 7 完整版
（且 `MathType Commands 2016.dotm` 在 Word 的 STARTUP 目录里）+ pandoc 3 + python-docx/pywin32。

**交付前只认这三条**，不认"我看着差不多"：

1. `verify.py` 结论必须是「通过」——它查**对象内容**（OLE 里的未知宏）而不只是个数，
   还会拿 `filled.json`/`equations.json` 做**内容对账**：公式有没有整块没进文档、
   题注域数对不对得上、文献条数对不对得上；
2. `compare_pdf.py` 的**正文段落缺失必须是 0**——整体词相似度会被公式对象拉低，不能当验收线；
3. `verify.json` 里 `omml` 必须是 0。

## 为什么必须绕开 OMML

| 走 OMML 的后果 | 本技能的做法 |
|---|---|
| 公式变成 Word 原生公式编辑器对象，之后想把某个公式改一个字，得整条重排 | 每个公式是独立 MathType 对象，双击就改 |
| LaTeX 的宏信息在 OMML 那一步就丢了，后面无法还原 | 宏在 S2 展开、在 S4 才消费，源码一直在 |
| 从 OMML 再转 MathType 需要额外一步，且转换器会再丢一层信息 | 没有中间态，一步到位 |

这是硬约束，不是偏好。任何"先转字再换公式"的中间产物都不要交付。

## 快速开始

```bash
# 用装了 pywin32 的系统 Python，不是宿主内置解释器
PY="C:/Users/<你>/AppData/Local/Programs/Python/Python313/python.exe"

$PY scripts/doctor.py                     # 先体检，有 [STOP] 别往下走

# 最省事：版式从论文自身推断（现场编译量版面），不需要任何模板
$PY scripts/run.py paper.tex -o paper.docx --auto-style

# 有官方样例 PDF：直接量它，最准
$PY scripts/run.py paper.tex -o paper.docx --auto-style --style-pdf 样例.pdf

# 有学校/期刊的 Word 模板：优先用它，跳过推断
$PY scripts/run.py paper.tex -o paper.docx --reference-doc 学校模板.docx

# 跑完顺手和参考 PDF 对一遍（版式 + 正文覆盖）
$PY scripts/run.py paper.tex -o paper.docx --auto-style --compare 样例.pdf
```

`run.py` 串完 S1→S5（可选 S6），任一步失败会停在原地并说明原因。想分步调试就单独跑下面的命令。

**这个技能不假设你用哪本期刊模板。** 版式、宏、编号全部从输入推出来：

| 需要知道的东西 | 从哪来 |
|---|---|
| 纸张 / 边距 / 字号 / 行距 / 标题层级 / 题注字号 | `learn_style.py`：编译论文量 PDF；没有 LaTeX 工具链就解析 `.cls`/`.sty` 的 geometry |
| 模板自定义的数学宏（`\bbbr` 之类） | `tex_macros.py`：读 `\documentclass`/`\usepackage` 指向的 `.cls`/`.sty`，连同导言区一起收集 |
| 图表题注叫 `Fig.` 还是 `图` | `tex_struct.detect_caption_names()`：认 `\figurename` 重定义与 ctex 系列 |
| 公式/图/表/定理的编号 | `prep_tex.scan_structure()` + `tex_struct.number_captions()` 按文档顺序推演 |

想单独调版式参数（不跑全流程）：

```bash
$PY scripts/learn_style.py paper.tex -o ref.docx            # 自动推断
$PY scripts/learn_style.py paper.tex -o ref.docx --pdf 样例.pdf
$PY scripts/make_reference_docx.py -o ref.docx --size 10 --line 12 \
    --margins 3.27,6.24,4.75,4.05 --indent 15               # 全手填
```

## 阶段

| 阶段 | 命令 | 做什么 | 产物 |
|---|---|---|---|
| S1 审计 | `scan_tex.py paper.tex --out audit.md` | 数公式、标高风险构造、预估耗时 | `audit.md` |
| S2 抽公式 | `prep_tex.py paper.tex -o build/` | 展开 `\input`、**从类文件收集并展开宏**、**就地解析 `.bib`**、把公式换成占位符、自己算编号，再做**结构重写**（定理环境/引用/题注/标题页/附录） | `prepared.tex`、`equations.json` |
| S2.5 推版式 | `learn_style.py paper.tex -o reference.docx` | 编译论文量版面（或解析类文件），生成 pandoc 参考模板 | `reference.docx`、`style.json` |
| S3 建 docx | `build_docx.py prepared.tex -o base.docx --equations equations.json` | pandoc 出骨架，回填 `$...$` / `\[...\]` 文本、`SEQ` 编号域（公式/图/表各一条序列）、`REF` 引用域 | `base.docx`、`filled.json` |
| S4 转 MathType | `to_mathtype.py base.docx -o out.docx` | 两轮：先倒序逐段整段 `MTCommand_TeXToggle`，再对残留逐条精确框选重转 | `out.docx`、报告 JSON |
| S5 校验 | `verify.py out.docx --expect N --manifest filled.json --source equations.json` | 读 docx 内部结构，核对对象数/OMML/残留分隔符/**OLE 里的未知宏**/未解析引用，再做**内容完整性对账**（题注域、文献条数） | 通过或不通过 |
| S6 对比（可选） | `compare_pdf.py 参考.pdf out.pdf` | 版式指标 + 逐段正文覆盖 | `compare.json` |

### 各阶段的关键设计（改代码前必读）

**S2 为什么必须自己实现公式扫描**：pandoc 的 LaTeX reader 会把 `$...$` 变成 Math 元素，docx writer 再写成 OMML——这正是要避免的。所以公式在进 pandoc 之前就被换成了 `MTXd0007` 这类纯字母数字占位符。占位符能被 pandoc 当普通文本搬运，事后可以精确找回。

**S2 的编号推演**：LaTeX 的编号是编译期算的，pandoc 不搬。`prep_tex.py` 自己数 `\section` 与公式计数器，支持 `\numberwithin{equation}{section}`、`\tag{}`、`\nonumber`/`\notag`，`align`/`gather`/`eqnarray` 逐行编号，`multline` 合并成一行。图、表、小节的编号也一并推演，供 `\ref` 使用。

**S3 的编号为什么用 SEQ 域**：写死文本 `(3)` 的后果是插入一个公式后全篇错号。`{ SEQ Equation }` 是 Word 的计算域，`Ctrl+A → F9` 就能重排；交叉引用是 `{ REF _Eq7 }`，跟着编号走。不想要域就加 `--plain-numbers`。

**图、表也走同一条路**：`tex_struct.number_captions()` 不在题注里写死 "Fig. 1."，而是留下
`@@FG0003@@` / `@@TB0002@@` 标记；S3 把标记换成「书签 `_Fig3` + `SEQ Figure` 域」，
`\ref{fig:x}` 换成 `REF _Fig3`，`\autoref` 额外补 "Figure"/"Table"（中文模板自动变"图"/"表"）。
这样插一张图，题注号和正文引用一起重排。

**`\label` 通常在 `\caption` 之后、环境之内**——只从题注花括号里找 `\label` 会漏掉绝大多数
正常写法，正文就印出 `Figure ??`。现在扫整个 float 环境。

**S2.5 为什么要单独做结构重写（`tex_struct.py`）**：pandoc 的 LaTeX reader 只认一小部分结构，
遇到就整块丢或降级——`\begin{theorem}[X]` 的环境名和序号全丢、`\cite` 变空白、
`\bibitem` 的编号没了、`\keywords` / `\institute` 整块消失、`\subsubsection` / `\paragraph`
本该是行内小标题却被当成块级标题。这一步在**公式已经换成占位符之后**运行（公式是 `MTXi0007`
纯 token，不会被误伤），把这些语义按 `svproc`/`article` 的真实排版补回去：

| 输入 | 输出 |
|---|---|
| `\begin{proposition}...\end{proposition}` | `**Proposition 1.** *正文斜体*`（每个环境独立计数） |
| `\cite{a,b}` | `[1, 2]`（编号 = `\bibitem` 声明顺序，与 unsrt 一致） |
| `\begin{thebibliography}` | `\section*{References}` + 有序列表 |
| `\keywords{x}` | `**Keywords:** x`，套 `Keywords` 样式 |
| `\institute{A \and B}` / `\affil{...}` / `\affiliation{...}` | 两段居中的 9pt 上标编号单位 |
| `\subsubsection{X}` / `\paragraph{X}` | 行内加粗 / 行内斜体，与后一段合并 |
| `\caption{...}` | `**Fig. 1.** ...` / `**Table 1.** ...` |

段落开头的 `@@STY:样式名@@` 是给 S3 的标记：pandoc 原样搬过去，S3 删掉标记并套同名样式。
用来表达 LaTeX 输入里没法直接表达的东西（`Keywords` / `Institute` / `Abstract`）。

**front matter 的元数据命令不能只认几个名字**：pandoc 遇到不认识的单参数命令（IOP 模板的
`\affil{...}`）会**连参数一起丢掉**，不报错、不留痕。旧的写法只硬编码了 svproc 的 `\institute`，
换一套模板就整块作者单位消失——实测 IOP 那套因此丢掉两段。现在的顺序是：

1. `AFFIL_CMDS` 覆盖 `institute / affil / affiliation / address / organization / institution`，
   编号跨命令连续，并自动剥掉单位里自带的上标（`\affil{$^1$...}` 不会变成 `¹¹`）；
2. 兜底 `unwrap_front_macros()`：扫 front matter，凡是**本工程确实定义过、且只吃一个参数**的命令，
   一律展开成普通段落并打告警。判据只认工程里真实存在的定义，所以不会误伤 `\section` 这类原语。
3. 插入位置按源码顺序走：有 `\maketitle` 就挂在它后面，没有就留在原处——否则 IOP 那种没有
   `\maketitle` 的模板会把单位提到标题上面去。

**S3 的版式精修**：书签只包住 `SEQ` 域本身（包到括号外面会让 `REF` 返回 `(7)`，
和正文括号叠成 `((7))`）；表格自动套三线；`Proof.` 段首转斜体；
`References` 之后的段落套 `Bibliography`。页眉按双面排：**偶数页「页次 + `\authorrunning`」左齐、
奇数页「`\titlerunning`」居中 + 页次右齐**（svproc 的惯例，需要 `w:evenAndOddHeaders`，
python-docx 没有对应属性，得直接写 `sectPr`）；源文件声明 `\pagestyle{empty}` 时不加页眉。

**为什么要 `learn_style.py`（而不是写死一套版式）**：pandoc 默认模板是 Calibri + 蓝色标题，
投稿不能用；但把某本期刊的边距、字号抄进代码，换一个模板就全废。所以版式必须从输入推出来：

1. **有 PDF 就量 PDF**（`--pdf` 指定样例，或现场 `xelatex` 编译后量）——
   纸张、版心、正文字号（按字符数加权取众数）、行距（块内相邻行基线差中位数）、
   首行缩进、标题字号（比正文大的短行）、题注字号，全部实测。
   编译时会把 `styles/`、`cls/` 这些兄弟目录塞进 `TEXINPUTS`，否则会报找不到 `.cls`。
2. **没工具链就解析源文件**：`\documentclass[a4paper,11pt]`、`geometry` 的 `margin/top/left`、
   `\setlength{\textwidth}`、`\linespread`、ctex 判断中文。
3. **都没有**用通用默认值（A4 / 10pt / 12pt 行距 / 16cm 版心）。

`make_reference_docx.build_reference()` 是唯一的落地函数，上面三条路都调它。
**行距必须是"最小值"而不是"固定值"**，否则行内公式会被行高压扁、直接和上下行重叠。

**为什么 S5 要扫 OLE 二进制**：MathType 遇到不认识的宏**不报错**，只把它当普通字符印出来；
它还会把原始 TeX token 存进 MTEF（所以干净文件里也能扫到 `\frac`、`\left`）。
判据因此是「有没有 KNOWN_MACROS 之外的命令」，而不是"有没有命令"。
S2 的白名单体检会提前拦，S5 在最终产物上再验一次——两道闸门，缺一道就会放过静默降级。

**为什么要 `compare_pdf.py`**："我看着差不多"不是验收标准。它把两件事变成数字：
版式指标（纸张/版心宽/字号/行距/页数，超容差就报）+ 逐段正文覆盖。
后者对每段取与转出文本的**所有匹配块之和 ÷ 段落词数**——不能只取最长单块，
因为行内公式在转出侧没有文字层，会把句子切成好几截，只取最长块会误判整段缺失（实测 40 段误报 10 段）。
另外必须过滤公式残留词（`\mathbb{R}` 在 PDF 文字层里是 `IR`、`\mathbb{T}^2` 是 `TZZ`），
并把 `non-` + `degenerate` 的断字接回去。

**行距只统计"正文字号"的行**：参考文献、题注用的是更小字号和更紧的行距，混进来会把中位数
拉低约 1pt，把本来合格的成品误判成"差 1pt"（实测 svproc 从 12.0 掉到 11.0）。现在按字号
±0.6pt 过滤后再算基线差中位数。
"版心高"**不做判定**——它等于"页面排得满不满"，浮动体和段落松紧都会影响，拿它当版式指标会
把正常稿判成差异；只在页数不同时输出溢出诊断（末页内容高度对比），说明是排版松紧还是真丢内容。


**S4 为什么用宏而不是 SDK**：`MT6.dll` 的 `MTSetEqnFromLangStr` 在无加载项上下文里状态不确定——同一份代码、同一个 payload，本机实测时而返回 0、时而 `-9999`、偶尔直接 access violation；`MathPage.wll` 则 12 次全 `-9999`。而 `MTCommand_TeXToggle` 走 MathType 自己的翻译器，会话内稳定，速度还快两个数量级（0.3 秒/公式 vs 11 秒/公式）。

**S4 的五条硬约束（改 `to_mathtype.py` 前必读）**：

1. **Toggle 是切换语义。** 对已经转好的内容再跑一次，会把 MathType 对象**还原成 LaTeX 文本**。
   所以任何"整篇重跑"/"失败回填重写"的写法都在自相残杀：实测整篇全选一次 140 条只吃下 66 条，
   再跑一轮残留从 74 涨回 140。现在的写法是两轮：整段轮**跳过已经含对象的段落**，
   精确轮**只框还没转的那些**。
2. **不能按字符下标算 Range。** 一个 MathType 对象在 `Range.Text` 里是 1 个 `\x01`，
   在 Word 的位置空间里占 27 个（实测 5 个对象、len=22、跨度=152，每个多占 26）。
   段内已有对象时"下标 + 偏移"必然算歪，而选歪的后果不是失败，是把隔壁已经转好的对象 toggle 回 LaTeX
   （旧实现实测：精确轮 ok 计数 3+4+5=12，残留却从 4 涨到 5）。精确轮改成**用 `Find` 定位分隔符**
   （只找 `$` / `\[` / `\]`，不拿公式正文当查找串——正文里的 `^` 会被 Find 当特殊字符，且 Find.Text 有 255 字上限）。
3. **居中的表格单元格里 TeXToggle 一定失败**，还会往正文插一个句点。转换前临时改成左对齐、转完立刻还原，
   最终版式不受影响（真实稿靠这一条从 119 涨到 140）。
4. **验收只数正文里还剩多少 `$...$`，不认段落序号。** 转换会改变段落结构（公式段被并进上一段、
   或被拆成多段），段落总数和序号都会变；拿转换前的 index 回头核对会张冠李戴
   （实测把已经转好的判成失败，报告写"成功 3 / 失败 3"，其实 6 个全转好了）。
5. **Toggle 还会重写公式段的段落属性。** S3 在 base.docx 里给行间公式设的 10pt 段前/段后，
   转完 MathType 就退回"继承样式"，而 `MTDisplayEquation` 样式只有段后 3pt。
   结果整篇比参考 PDF 短 5cm 左右、刚好差一整页（实测 153cm vs 158cm）。
   所以 S4 在存盘前跑一遍 `restore_display_spacing()` 把间距补回来：连续多段属于同一个
   被拆开的公式时，只给首段"段前"、末段"段后"，中间贴紧。
   **S3 里设的 `DISPLAY_SPACE` 只对 base.docx 有效，最终稿以 S4 的这一步为准。**

**失败是概率性的**：同一份内容时过时不过（居中 + 10pt 那组挂了，换个上下文就过）。所以精确轮可以反复调用，
靠多轮收敛；它是幂等且安全的，因为只碰还没转的公式。

## 实测支持矩阵（本机 MathType 7.8.2 + Word 16 + pandoc 3.6.4）

**通过**：分式、根式 `\sqrt{x}`、上下标嵌套、求和/连乘/积分、希腊字母、
`array`、`matrix`/`pmatrix`/`bmatrix`/`Bmatrix`、`cases`、`align`、`\text{中文}`、`\mathbf`、`\mathcal`、
`\mathbb`、`\left(...\right)` 与空定界符 `\left.`/`\right.`、`\hat/\vec/\bar`、`\overline`、`\binom`、
`\lim`、`\nabla`、`\partial`、`\leq/\neq/\approx`、行内公式混排

### 多行环境：不认的会"假成功"，这是本 SKILL 最大的坑

**MathType 只认一部分多行环境，不认的时候不报错——它照样把 `$...$` 变成一个 MathType 对象，
然后把 `\begin`/`\end` 当普通字符画在公式里。** 于是：`$` 没了、对象数对得上、S5 的 OLE 扫描
也查不出（`\begin` 本身是公开命令，不在"未知宏"里），只有肉眼看得出公式里夹着一串反斜杠。
这就是为什么 `find_unsupported()` 除了宏还要单独检查**环境名**——这是唯一能在转换前拦住它的位置。

| 写法 | 结果 |
|---|---|
| `array{rl}` / `array{rll}` / `matrix` / `pmatrix` / `bmatrix` / `Bmatrix` / `cases` / `align` | 干净 |
| `aligned` / `gathered` / `split` / `eqnarray` | **对象里留字面 `\begin`、`\end`** |
| 顶层裸 `\\`（不属于任何环境） | **画成字面 `\\`** |

所以 `normalize()` 里有一层 `_remap_environments()`：`aligned`/`alignedat` → `array{rl…}`（列数按
每行 `&` 的个数算）、`gathered`/`gather` → `array{c}`、`split` → `array{rl}`、
`eqnarray` → `array{rcl}`、`multline` → `array{l}`；顶层裸 `\\` 由 `_fix_toplevel_breaks()` 处理
（整条没环境就包成 `array{l}`，环境外还夹着就退化成 `\quad`）。
`find_unsupported()` 会对归一化后仍存在的非白名单环境报警，别忽略那条告警。

**单条公式有长度上限**：实测 378 字的多行数组能转、469 字能转、**525~660 字必挂**
（把外层 `\left\{...\right\}` 去掉剩 645 字照样挂，所以卡的是总长度不是嵌套结构）；
挂法是静默的（原文原样留在正文）。超长的多行公式由 S3 的 `tex_macros.split_long_display()`
按 `\\` 拆成几段，每段单独转成一个对象：首段以 `\right.` 收尾、后续段以 `\left.` 开头，
续段再加一个 `\quad` 悬挂缩进，让行首对齐到首段大括号里面的内容列（实测约 1em）。

**拆段的已知代价（内容正确，观感打折）**：大括号会被切成两半——首段的 `\{` 只覆盖它那几行，
末段的 `\}` 只覆盖它那几行，中间的续行落在括号外。参考稿里是一个括号贯穿全式。
这是 MathType 的硬限制：一个对象只能有一个括号，跨对象无法拼接，而整条又超过长度上限。
`\phantom` 本可以精确对齐，但 MathType 不支持它（用了整条公式会退化成字面文本），
所以续段只能用固定 `\quad` 近似。交付时如果这几条公式要上刊，建议在原对象上双击手动微调。

**换行的可选行距 `\\[-2pt]` 会让整条公式挂掉**（真实稿 eq.29 的尾段就是这么废的）。
`normalize()` 里负值整段抹掉（语义就是不断行），非负值退回普通 `\\`。

**`\sqrt[3]{x}` 可用**（指数以约 0.57 倍字号排在根号左上，实测 size 6.9pt vs 主体 11.9pt）。
`\bigl/\bigr/\Big` 一族的尺寸定界符不被支持，`normalize()` 会自动剥离，括号退成正常尺寸。

**"失败"有两种形态，都不能只看 `$` 有没有剩**：

| 形态 | 表现 | 怎么发现 |
|---|---|---|
| 静默不转 | `$...$` 原样留在正文 | 数残留 `$`（S4 自己就在数） |
| **假成功** | 对象建出来了，但里面夹着字面 `\begin`、`\foobar` | 只能导出 PDF 扫文字层，或 S2 前置白名单拦 |

未知宏走的是第二种：`$\foobar{x}+1$` 实测对象数 +1、段落文本为空，看不出任何异常。
早期版本以为它"吞掉原文"，因此要求 S4 做快照回填——**那个函数已经删了**（它用
`Range.Text = src` 重写段落，每跑一次就多插一个句点，把 `$` 对也打碎）。
现在靠两道前置闸门：S2 的 `find_unsupported()`（宏 + 环境白名单）、
S5 扫 OLE 二进制里有没有白名单外的命令。

**MathType 的隐藏规则：没有结构符号的"原子串"一定失败。** 公式内容不含 `\` `_` `^` `{` `}` `(` `)`
`[` `]` `|` 中任何一个时（`$ab$`、`$kT$`、`$H'$`、`$2T$`、`$1.2$`、`$0.30$`、`$u,v,w$`），
`Toggle TeX` 必然静默失败并把 `$...$` 原样留在正文。`normalize()` 会自动给这类串末尾补一个空组
（`1.2` → `1.2{}`），渲染完全一致。<br>
判据用"有没有结构符号"而不是字符白名单：白名单永远会漏——小数点就是这么漏掉的
（旧版白名单里没有 `.`，于是 `1.2` 没补组、静默失败）。

**已在 S2 归一化里改写的写法**：`\norm`、`\abs`、`\bm`、`\R/\N/\Z`、`\lVert/\rVert/\Vert`、`\argmin`、
`\operatorname*`、`\tfrac/\dfrac`、`\mbox`、`\vspace/\hspace`、`\displaystyle`、`\widetilde`（→`\tilde`）、
`\allowbreak`/`\qed`/`\hfill`（删除）。

**模板自己的宏是自动收集的，不需要逐个补。** `collect_macros_with_files()` 会读
`\documentclass`/`\usepackage`/`\RequirePackage` 指向的 `.cls`/`.sty`（先在论文同目录找，找不到走
`kpsewhich`），提取 `\newcommand`/`\renewcommand`/`\providecommand`/`\DeclareMathOperator`/`\def`，
**导言区的定义覆盖类文件的定义**。这样 `svproc.cls` 里的 `\bbbr` 之类在任意模板上都能自动展开。

两条安全阀：类文件里的宏若函数体含 `@`（LaTeX 内部宏）或超过 200 字符（排版机器），直接跳过——
展开进公式只会更糟。所以真正需要手工加进 `ARG_MACROS`/`BARE_MACROS` 的情况已经很少了：
基本只剩"类文件里的宏用了我们解析不了的语法"。

**S2 会做未知宏体检**：归一化之后用 `tex_macros.find_unsupported()` 核对每条公式，
凡是 MathType 不认识的宏都会在 S2 就告警（"转出来会是字面文本"）。
这一步是必需的——S4 遇到不认识的宏**不会报错**，它把 `\foo` 当普通字符印出来，
S5 也只数对象个数，照样判"通过"。别跳过这个告警。

## 结构能力：公式之外的那半篇论文

这一节列的每一条，旧版本都是**静默错、不报错**：正文印出 `??`、题注没号、
参考文献整块消失。现在都有实现，也都进了回归用例（`08-struct`）。

| 构造 | 做法 | 边界 |
|---|---|---|
| `\section{X}\label{y}` + `\ref`/`\autoref`/`\cref` | 标题**花括号外**的 `\label` 也算（这才是主流写法） | `\autoref` 给 `Section/Figure/Table/Equation/Appendix`（中文模板给 节/图/表/式/附录）；`\cref{a,b}` 拆成多条 |
| `\appendix` | 章节号改写成 A/B/C，`\ref` 跟着变；`\numberwithin{equation}{section}` 时公式为 `A.1` 且**每节清零** | pandoc 的 `--number-sections` 会先印数字，所以 S3 在它之后改那些带 `SectionNumber` 样式的 run |
| 定理类环境 | 解析导言区 `\newtheorem`：`[theorem]` 共享计数器、`[section]` 按节编号；**自定义环境名**（`\newtheorem{thmx}`）也认 | 只在导言区找声明；`.cls` 里定义的按"每环境独立计数"处理（大多数模板本来就是这样） |
| `\begin{subfigure}` 子图 | 子题注 `(a)(b)`，主题注仍是 `Fig. 1.`；`\ref` 子图 → `1a`（REF 主图号 + 字面字母） | 只认 `subfigure`/`subtable` 环境；`\subfloat` 会被丢；子图字母是字面量，重排子图不会自动换字母 |
| `longtable` | 题注照样编号；`\endfirsthead`…`\endhead` / `\endfoot`…`\endlastfoot` 的重复表头切掉 | 跨页断行由 Word 自己处理，不做“续表”标记 |
| bibtex `.bib` | `bibtex.py` 就地解析：按 `\bibliographystyle` 排序（unsrt/ieeetr 用引用顺序，plain/abbrv 字母序），排成 unsrt 风格的条目 | 不跑 bibtex 二进制、不解析 `.bst`；作者-年样式和 `alpha` 的 `[Smi20]` 标签不还原（会告警） |
| `\tableofcontents` | 换成 Word 的 TOC 域 | 目录条目要 Word 自己排：打开后 `Ctrl+A → F9` |
| `\pageref` | 公式/图表走 `PAGEREF` 域（页码） | 章节引用退回章节号（pandoc 写的书签名带冒号，Word 的域不认） |
| 摘要 / 关键词 | 摘要认 `\begin{abstract}`、`\begin{summary}`、`\abstract{...}` 命令形式；关键词认 `\keywords{}`、`\keyword{}`、`\begin{keywords}`、`\begin{IEEEkeywords}`、`\begin{keyword}` | `\abstract{...}` 是 pandoc **整段吞掉**的写法（一句不剩、不报错），必须自己抽；除上表所列不再扩展 |
| 中英语言 | `detect_lang()` 按「ctex/xeCJK 宏包」+「中文字符占比」双判据决定语言，摘要/关键词/文献标题/图表题注/定理名/`\autoref` 前缀全部跟随 | 只分 `zh`/`en`；日、韩模板按 `en` 处理（题注词仍可从 `\figurename` 重定义取） |

`\cite[p.~5]{k}` 的可选参数会变成 `[1, p. 5]`。未被引用的 `.bib` 条目默认不进文献表
（要保留就写 `\nocite{key}` 或 `\nocite{*}`），条数不对会在 S2 报警。

## 已知会丢的东西（必须提前告知用户）

| 构造 | 结果 | 建议 |
|---|---|---|
| TikZ / pgfplots 图 | 整块丢失 | S2 之前用 `xelatex` 单独编译成 PDF/PNG 再 `\includegraphics` |
| `tcolorbox` / `mdframed` | 只剩框内文字 | 改成普通段落 + 底纹，或截图 |
| `algorithm2e` / `algorithm` 环境 | pandoc 整块丢弃（含其中公式） | 手动改成三线表或编号段落；`filled.json` 会列出被丢的公式行号 |
| 双栏布局 | 变单栏 | 用 `--reference-doc` 套双栏模板 |
| 浮动体位置 | 内联到出现位置 | Word 里手动拖（`\vspace` 也一并丢了，图位会变矮） |
| `\verb` | 样式丢失，文字保留 | 可接受 |
| `\multirow` / `\multicolumn` | 拍平成普通单元格（合并是 Word 表格属性） | S2 会告警并给条数，上刊前手工合并 |
| `\subfloat` / 旧式 `subfigure` 包 | 子图题注丢失 | 改成 `\begin{subfigure}`（subcaption 包） |
| `\listoffigures` / `\listoftables` | 不生成 | Word 里用「引用 → 插入表目录」 |
| 页眉页脚 | 写「页码 + 短作者」；有短标题（`\titlerunning`/`\shorttitle`/`\runningtitle`/`\titlemark`）时按双面排 | `\markboth`/`\markright` 的语义随模板而变（IEEEtran 左=刊物信息、book 类左=章名），**只删除不还原**并告警；章节名运行栏需手工改 |

**已经补上的**（旧版本会丢，现在 `tex_struct.py` 负责）：定理类环境的名称与编号、`\cite`、
`\bibitem` 编号、摘要（含 `\abstract{...}` 命令形式）与关键词（含 `IEEEkeywords`/`keyword` 环境）、
`\institute`/`\affil`/`\affiliation` 等**各家叫法不同的单位命令**、
短标题/短作者命令（`\titlerunning`/`\shorttitle`/`\titlemark`/`\authorrunning`/`\shortauthor`）、
front matter 里其它模板自定义的单参数命令（兜底展开并告警）、`\email`、图表题注编号、
`\subsubsection`/`\paragraph` 的行内小标题、表格 `\hline`（统一转三线表）。

> 判断"这个词该印中文还是英文"**只有一个来源**：`tex_struct.detect_lang()` →
> `LANG_STRINGS`。不要在别处再写一份 `if cjk: "摘要" else "Abstract"`，
> 这类双份实现是本项目反复踩的坑（图表编号漂移就是这么来的）。

S1 审计会把这些标成 high/medium 风险；**没处理完不要进 S3**，转完再补等于重做。

## 环境要求

```bash
$PY scripts/doctor.py     # 任何 [STOP] 都要先解决
```

- Windows + 桌面版 Word（LibreOffice/WPS 不行，OLE 对象不通用）
- MathType 7 完整版（fonts-only 版没有加载项）
- **加载项必须在 Word STARTUP 里**，否则 `Toggle TeX` 宏不可见：
  ```
  复制 "<MathType安装目录>\Office Support\64\MathType Commands 2016.dotm"
   到  "%APPDATA%\Microsoft\Word\STARTUP\"
  ```
  用户级、可随时删除，不改系统全局。装完重启 Word 才会加载。
- pandoc ≥ 3（S3 必需）、python-docx、lxml、pywin32（装在系统 Python 上）

## 铁律

- **不要用 zipfile 直接改 `document.xml` 插公式**。OLE 对象的关系、ShapeID、预览图必须由 Word 写，手工拼出来的 docx 打不开。
- **传给 Word 的路径必须先 `resolve()`**。`SaveAs2("out.docx")` 是按 Word 自己的当前目录解析的，
  会把文件存进「我的文档」，脚本还照常打印成功。同理，`Documents.Open` 失败时 Word 的报错信息
  会显示成 `D:\//a...` 这种畸形路径，别被误导——先确认文件到底在不在。
- **不要用 `Range.Text = 原文` 去"回填"转换失败的公式**。重写段落会给每个 run 补一个句点
  （`$u_x$ (m)` 变成 `$u_x$ (m)...`），还会把配对的 `$` 打散。失败只能靠"再精确框一次"重试，
  不能靠改文本。验收也只数残留的 `$...$`，不数对象数——假成功的对象数是对的。
- **Word 打不开以 `.` 开头目录里的文件**（报"不是有效文件名"）。`to_mathtype.py` 会自动中转，自己写脚本时要留意。
- **不要在空文档上试跑 `Application.Run(MACRO)`**，Word 会弹框，隐藏窗口下表现为永久卡死。
- **路径含中文/空格没问题，含 `.` 开头目录不行**；交付目录不要用 `.build`。
- 公式里出现字面 `$`（货币）会被当成数学分隔符，先改成 `\$` 或删除。

## 产物

```
<out>.docx                 交付件：结构 + MathType 公式
<out>.pdf                  可选：--pdf-out / --compare 时导出
<out>_build/
    audit.md               审计报告，随交付一起给对方
    reference.docx         S2.5 推断出的版式模板（可复用、可手改）
    style.json             推断出的版式参数，便于复核与微调
    prepared.tex           占位符版（中间产物）
    equations.json         每个公式的 LaTeX 原文、编号、标签、行号；引用带 kind
    base.docx              MathType 之前的版本（公式是 LaTeX 文本，可回退）
    filled.json            哪些公式进了文档、哪些被 pandoc 丢了
    mathtype-report.json   转换成功/失败清单
    verify.json            校验结果
    compare.json           与参考 PDF 的差异（可选）
```

`base.docx` 是安全网：S4 出问题时有它就能重来，不必重跑 S1–S3。

### 已知的版式差异（与 LaTeX 编译结果对比）

两套结构完全不同的文档类，都只给 `.tex`（不给模板、不给字号、不给边距），版式全部由
`learn_style.py` 现场编译量出来：

| 指标 | svproc 参考 | svproc 转出 | IOP 参考 | IOP 转出 |
|---|---|---|---|---|
| 页数 | 6 | 6 ✅ | 5 | 6 ⚠ |
| 纸张 | 21.0×29.7 cm | 21.0×29.7 cm ✅ | 21.0×29.7 cm | 21.0×29.7 cm ✅ |
| 版心宽 | 12.20 cm | 12.38 cm ✅ | 16.15 cm | 16.35 cm ✅ |
| 正文字号 | 10.0 pt | 10.0 pt ✅ | 11.0 pt | 11.0 pt ✅ |
| 行距 | 12.0 pt | 12.5 pt ✅ | 13.5 pt | 13.5 pt ✅ |
| 正文段落覆盖 | 45 段 | 缺失 0 ✅ | 50 段 | 缺失 0 ✅ |
| 公式 | 167 | 167 ✅ | 172 | 172 ✅ |

IOP 那套多 1 页，`compare_pdf.py` 给出的归因是末页只堆了 1.83cm（约两行）——逐段排版松紧
累积的溢出，不是丢内容。

剩余的真实差异：

- **字体不同**：LaTeX 用 Latin Modern（Computer Modern），Word 里映射到 Times New Roman。
  要完全一致就把 MiKTeX 里的 `lmroman*.otf` 装进系统字体，再改 `FONT_MAP` 或 `--font`。
- **行高会略涨**：MathType 的行内对象比文字行高；正文用「最小值」行距后，
  含行内公式的行会涨到 13–18pt。这是为了让公式不被压扁，代价是每页少排 1–2 行。
- 浮动体不浮动、`\vspace` 丢失，图注会跟到正文中间（Word 里手动拖）。
- 页眉已按双面排（偶页「页次 + 短作者」、奇页「短标题 + 页次」），但字号/制表位与
  svproc 的原始定义仍有毫米级差异，交付前目视核对一遍；`\pagestyle{empty}` 的稿件不会写页眉。
- **整栏宽度**：LaTeX 双栏稿会变单栏（版心宽仍按两栏并集取）。

## 回归测试

```bash
$PY tests/run_tests.py                 # 10 个用例跑到 S3，约 25 秒
$PY tests/run_tests.py --with-mathtype # 连 S4/S5，约 90 秒
$PY tests/run_tests.py -k floats       # 只跑某个用例
```

`tests/cases/` 里的每个 `.tex` 都对应一个**历史上真实踩过的坑**，断言不看肉眼看结果：

| 用例 | 防的是什么 |
|---|---|
| `01-basic` | 行内/行间/`align` 编号、`\eqref`、纯 token 公式 |
| `02-floats` | 图表题注 SEQ 域、`\label` 写在 `\caption` 之后、`\autoref` 前缀 |
| `03-theorem` | 定理类环境编号、`\ref` 指向定理、Proof 斜体 |
| `04-macros` | **类文件里定义的宏**（`teststyle.cls` 模拟 `\bbbr`）与导言区宏 |
| `05-tokens` | MathType 边界写法：纯 token 串、`\widetilde`、`\allowbreak`、`\|` |
| `06-cite` | `\cite` 编号、`thebibliography` |
| `07-cjk` | ctex 中文排版、中文题注"表 1"、中文交叉引用 |
| `08-struct` | **章节/附录引用、`\newtheorem` 共享计数器、子图 (a)(b) 与 `1a` 引用、longtable 题注与表头去重、bibtex `.bib`、目录域** |
| `09-ieee` | **`\abstract{...}` 命令形式不被吞、`\begin{IEEEkeywords}` 环境、`\markboth` 只删不还原并有告警、定理共享计数（Theorem 1 / Lemma 2）** |
| `10-cjk-full` | **中文全要素：摘要：/关键词：/参考文献/定理 1 引理 2，且不得残留 `Abstract.`/`Keywords:`/`References`** |

`04-macros` 是这套测试里最重要的一条：它复现的正是"类文件宏没展开 → MathType 静默印出
`\bbbr` → S4 报成功 → S5 报通过"那个链条。现在这条链在三个位置都会断。

## 现状

| 脚本 | 状态 |
|---|---|
| `doctor.py` | ✅ 环境体检 |
| `scan_tex.py` | ✅ 复杂度审计与耗时预估 |
| `prep_tex.py` | ✅ 167 公式全对（`\numberwithin`、`\tag`、多行环境）；图表 label 全类型注册 |
| `tex_struct.py` | ✅ 定理/引用/题注/标题页重写；题注用标记+SEQ 域；认得 `\figurename` 与 ctex；front matter 自定义命令兜底展开 |
| `learn_style.py` | ✅ 自动推断版式（量 PDF / 解析类文件 / 默认值 三级回退） |
| `build_docx.py` | ✅ 0 OMML；公式/图/表三套 SEQ 域 + REF 交叉引用；A4 兜底 |
| `to_mathtype.py` | ✅ 167/167，~60 秒；输出路径强制绝对化并校验文件真的落地 |
| `verify.py` | ✅ 结构校验 + **OLE 未知宏扫描** + 未解析引用检查 |
| `compare_pdf.py` | ✅ 版式指标 + 逐段正文覆盖；行距按正文字号过滤；页数不同时给溢出诊断 |
| `make_reference_docx.py` | ✅ 版式落地函数（可被 learn_style 调用） |
| `run.py` | ✅ 端到端 S1→S5（可选 S6 导出与对比） |
| `tex_macros.py` | ✅ 类文件宏自动收集 + 归一化 + 未知宏体检 |
| `bibtex.py` | ✅ `.bib` 解析与条目排版（不依赖 bibtex 二进制） |
| `tests/run_tests.py` | ✅ 10/10 通过（含 MathType 全链路）；`09-ieee`/`10-cjk-full` 带内容断言 |
