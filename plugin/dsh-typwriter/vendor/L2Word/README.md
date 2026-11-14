# L2Word-mathtype

**LaTeX → Word，公式落地为可双击编辑的原生 MathType 对象，全程零 OMML。**

学术论文（十几到几百个公式）从 `.tex` 转成**可继续编辑的 Word 工作稿**：
公式是独立的 `Equation.DSMT4` 对象，编号是 Word 域能重排，章节/图表/交叉引用都在。

> English summary: convert LaTeX papers to Word where every equation becomes an editable
> native MathType OLE object instead of OMML. Pandoc builds the text skeleton; equations
> travel as LaTeX source until the last step. Windows + Word + MathType 7 required.

---

## 环境要求

缺一件就跑不动，`doctor.py` 会直接报 `[STOP]`：

| 依赖 | 要求 | 为什么 |
|---|---|---|
| 操作系统 | **Windows** | OLE 复合对象只能由桌面版 Word 写入 |
| Word | **桌面版 Microsoft Word** | WPS / LibreOffice 不能写 MathType 对象 |
| MathType | **7 完整版**，且 `MathType Commands 2016.dotm` 在 Word 的 STARTUP 目录 | 转换靠它提供的 `Toggle TeX` 宏 |
| pandoc | **3.0+** | 负责正文骨架与版式 |
| Python | **3.9+** | 编排各阶段、读写 docx |

```bash
pip install python-docx pywin32
```

安装 MathType 后确认宏已挂上（Word 里应能看到 MathType 选项卡）；不确定就先体检：

```bash
python scripts/doctor.py
```

体检会把「Python 有没有 pywin32」「Word 能不能起 COM」「MathType 宏在不在」「pandoc 版本」
逐条打勾，有 `[STOP]` 的项别往下走。

## 快速使用

```bash
# 用装了 pywin32 的那个 Python，不是 IDE 内置解释器
PY="C:/Users/<you>/AppData/Local/Programs/Python/Python313/python.exe"

# 版式从论文自身推断（现场编译量版面），不需要任何模板
$PY scripts/run.py paper.tex -o paper.docx --auto-style

# 有官方样例 PDF：直接量它，最准
$PY scripts/run.py paper.tex -o paper.docx --auto-style --style-pdf sample.pdf

# 有目标版式的 Word 样板
$PY scripts/run.py paper.tex -o paper.docx --reference-doc template.docx
```

产物旁边会生成 `mathtype-report.json`、`verify.json`、`filled.json`，用来判定是否可交付。

### 分步执行

```bash
$PY scripts/prep_tex.py paper.tex -o build/          # → prepared.tex, equations.json
$PY scripts/build_docx.py build/prepared.tex -o base.docx \
        --equations build/equations.json             # → base.docx, filled.json
$PY scripts/to_mathtype.py base.docx -o out.docx     # → out.docx, mt.json
$PY scripts/verify.py out.docx --manifest build/filled.json --source build/equations.json
```

### 集成方式

三种都行，互相不影响：

1. **直接当 CLI 用** —— 上面那些命令就是全部接口，不依赖任何特定编辑器。
2. **作为 agent skill 加载** —— `SKILL.md` 是面向 AI agent 的入口文档，写明了每个阶段的
   输入输出、硬约束和踩坑记录；把它连同 `scripts/` 放进你所用的工具的技能目录即可。
3. **当 Python 库调** —— `scripts/` 里每个阶段都是独立脚本，可 `import` 后接到自己的流水线里。

## 支持范围

**结构层**：章节/子章节、附录（A/B/C 编号）、交叉引用（`\ref` `\eqref` `\autoref`
`\cref`）、图表题注 + SEQ/REF 域、子图（`subfigure` 的 1a/1b）、`longtable`、
定理类环境（解析 `\newtheorem` 的共享/按节计数）、摘要与关键词的多写法、
`\bibitem` 与 bibtex `.bib`、目录（TOC 域）、双面页眉。

**语言**：中英双语标题词从文档自身推断——中文稿输出「摘要：/关键词：/参考文献/定理」，
不会印出 `Abstract.` / `Keywords:` / `References`。图表题注同理（图/表 vs Fig./Table）。
判定只看文档本身（ctex/xeCJK 宏包 + 中文字符占比），不靠命令参数。

**公式**：`array` `matrix` `pmatrix` `bmatrix` `Bmatrix` `cases` `align` 及
`aligned`/`gathered`/`split`/`eqnarray`（后者会先映射成受支持的写法）。

### 明确不做

| 需求 | 为什么不行 |
|---|---|
| 出版级像素对齐 | Word 断行/浮动算法与 TeX 不同，页数会差 ±1 页 |
| TikZ / pgfplots 矢量保真 | Word 无矢量绘图引擎，先单独编译成 PDF 再 `\includegraphics` |
| 保留双栏版式 | pandoc 出单栏，需给双栏 `.docx` 作 reference 或转完手工分栏 |
| macOS / Linux / WPS / LibreOffice | OLE 对象只能由桌面版 Word 写入 |
| `\subfloat`、`\listoffigures`、`multirow` 真实合并、`.bst` 作者-年样式 | 未实现，`SKILL.md` 里逐条写明 |

详见 [`SKILL.md`](SKILL.md)。

## 工作原理

### 为什么不用 OMML

| 走 OMML 的后果 | 本项目的做法 |
|---|---|
| 公式变成 Word 原生公式编辑器对象，改一个字要整条重排 | 每个公式是独立 MathType 对象，双击就改 |
| LaTeX 宏信息在 OMML 那一步就丢了，无法还原 | 宏在预处理阶段展开、转换阶段才消费，源码全程在 |
| OMML → MathType 需要额外转换，再丢一层信息 | 没有中间态，一步到位 |

这是硬约束，不是偏好。任何「先转字再换公式」的中间产物都不应交付。

### 五阶段流水线

公式**全程以 LaTeX 源码形态流转**：pandoc 只处理正文骨架，公式被抽成
`MTXi0007` 这样的占位符绕过去；最后一步用 MathType 官方宏 `Toggle TeX`
原地换成 OLE 对象。

| 阶段 | 脚本 | 做什么 |
|---|---|---|
| S1 审计 | `scan_tex.py` | 扫宏包/风险项，给出阻塞项与工时估计 |
| S2 预处理 | `prep_tex.py` | 展开 `\input`、从 `.cls`/`.sty` 收集并展开宏、抽公式、算编号、结构重写（定理/引用/题注/标题页/摘要/文献） |
| S3 排版 | `build_docx.py` | pandoc 出骨架，回填公式文本，写 SEQ/REF 域、书签、页眉、三线表 |
| S4 落地 | `to_mathtype.py` | Word COM 驱动 MathType 批量 TeX → OLE，校验一轮成功率 |
| S5 校验 | `verify.py` | 不打开 Word，直接读 docx 内部结构：对象数、OMML、残留分隔符、内容对账 |

一键串起来：`run.py`。

设计上有三条约束贯穿始终：

- **发号只有一个来源**：图表编号由 `number_captions()` 统一发，定理编号由 `TheoremNumbering`
  统一发。两处各算一遍必然漂移（这个坑踩过）。
- **语言只有一个来源**：`detect_lang()` 决定印中文还是英文，其余模块只读结果。
- **校验必须查内容**：`verify.py` 不只看对象个数，还要拿 `filled.json`/`equations.json`
  对账——公式有没有整块没进文档、题注域数、文献条数对不对得上。

## 测试

```bash
python tests/test_rules.py     # 纯 Python 规则断言，秒级，不需要 Word
python tests/run_tests.py      # 10 个端到端用例，只到 S3
python tests/run_tests.py --with-mathtype   # 连 S4/S5，需要 Word + MathType
```

端到端用例覆盖：基础公式、浮动体、定理、类文件宏、占位符、引用、中文排版、
结构全家桶（附录/子图/longtable/bibtex/TOC）、IEEEtran 风格、中文全要素。

## 授权

[MIT](LICENSE)
