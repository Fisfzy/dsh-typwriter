#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""LaTeX 数学片段归一化：把 MathType 不认识的写法换成它认识的。

MathType 的 TeX 翻译器是一个子集。实测不认识的有：
    \\argmin \\norm \\bm \\R \\tfrac \\mbox \\operatorname* 以及用户自定义的 \\newcommand
实测认识的有：
    分式/根式/求和/积分/矩阵/cases/aligned/\\text{中文}/\\mathbf/\\mathcal/\\mathbb/\\left(...\\right)

所以策略是：先展开论文自己的宏，再把常见但不受支持的写法改写成等价的标准形式。
这不是为了排版好看，是为了让公式能被 MathType 吃下去。
"""
from __future__ import annotations

import re

# 单参数宏 → 模板（{0} 为参数）
ARG_MACROS: dict[str, str] = {
    "norm": r"\left\|{0}\right\|",
    "abs": r"\left|{0}\right|",
    "bm": r"\mathbf{{{0}}}",
    "boldsymbol": r"\mathbf{{{0}}}",
    "tfrac": r"\frac{{{0}}}",          # 只对 \tfrac{a}{b} 生效，见下方专门处理
    "dfrac": r"\frac{{{0}}}",
    "mbox": r"\text{{{0}}}",
    "operatorname": r"\mathrm{{{0}}}",
    "vect": r"\vec{{{0}}}",
    "textsc": r"\text{{{0}}}",
    "num": r"{{{0}}}",
    "si": r"\mathrm{{{0}}}",
    "unit": r"\mathrm{{{0}}}",
    # MathType 的翻译器没有 \widetilde，一律退化成 \tilde（单字母结果一致）
    "widetilde": r"\tilde{{{0}}}",
    "widehat": r"\hat{{{0}}}",
}

# 无参数替换
BARE_MACROS: dict[str, str] = {
    r"\R": r"\mathbb{R}",
    r"\N": r"\mathbb{N}",
    r"\Z": r"\mathbb{Z}",
    r"\C": r"\mathbb{C}",
    r"\Q": r"\mathbb{Q}",
    r"\argmin": r"\arg\min",
    r"\argmax": r"\arg\max",
    r"\dd": r"d",
    r"\ee": r"e",
    r"\ii": r"\mathrm{i}",
    r"\degree": r"^{\circ}",
    r"\celsius": r"^{\circ}\mathrm{C}",
    r"\vspace": r"",
    r"\hspace": r"",
    r"\displaystyle": r"",
    r"\textstyle": r"",
    r"\scriptstyle": r"",
    r"\nonumber": r"",
    r"\notag": r"",
    r"\centering": r"",
    r"\noindent": r"",
    # 换行提示 / 证明结束符：零视觉含义，MathType 不认，直接删
    r"\allowbreak": r"",
    r"\allowdisplaybreaks": r"",
    r"\qed": r"",
    r"\qedsymbol": r"",
    r"\hfill": r"",
    r"\mathstrut": r"",
    r"\strut": r"",
    # 类文件（.cls）里常见的黑板体简写，pandoc 与 MathType 都不认识
    # 注意：论文若自己重定义了同名宏，_expand_user_macros 已先行展开，不会被这里覆盖
    r"\bbbr": r"\mathbb{R}",
    r"\bbbn": r"\mathbb{N}",
    r"\bbbz": r"\mathbb{Z}",
    r"\bbbc": r"\mathbb{C}",
    r"\bbbp": r"\mathbb{P}",
    r"\bbbe": r"\mathbb{E}",
    # amsmath 的定界符命令，MathType 的翻译器只认 \| 与 |
    r"\lVert": r"\|",
    r"\rVert": r"\|",
    r"\Vert": r"\|",
    r"\lvert": r"|",
    r"\rvert": r"|",
    r"\vert": r"|",
    r"\lbrace": r"\{",
    r"\rbrace": r"\}",
}

# 直接删掉的命令（连同参数）
DROP_WITH_ARG = ("label", "index", "footnote", "cite", "citep", "citet", "ref",
                 "eqref", "tag*", "phantom", "hphantom", "vphantom")


def match_group(s: str, i: int) -> tuple[str, int] | None:
    """i 指向 '{'，返回 (花括号内文本, 结束后下标)。"""
    if i >= len(s) or s[i] != "{":
        return None
    depth, j = 0, i
    while j < len(s):
        if s[j] == "\\":
            j += 2
            continue
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                return s[i + 1:j], j + 1
        j += 1
    return None


def _expand_user_macros(tex: str, macros: dict[str, tuple[int, str]]) -> str:
    for _ in range(6):
        changed = False
        for name, (nargs, body) in macros.items():
            pat = re.compile(re.escape(name) + r"(?![A-Za-z])")
            pos = 0
            while True:
                m = pat.search(tex, pos)
                if not m:
                    break
                j = m.end()
                args: list[str] = []
                ok = True
                for _k in range(nargs):
                    while j < len(tex) and tex[j] in " \t":
                        j += 1
                    g = match_group(tex, j)
                    if g is None:
                        ok = False
                        break
                    args.append(g[0])
                    j = g[1]
                if not ok:
                    pos = m.end()
                    continue
                rep = body
                for k, a in enumerate(args, 1):
                    rep = rep.replace(f"#{k}", a)
                tex = tex[:m.start()] + rep + tex[j:]
                changed = True
                pos = m.start() + len(rep)
        if not changed:
            break
    return tex


def collect_macros(text: str) -> dict[str, tuple[int, str]]:
    """从导言区收集 \\newcommand / \\renewcommand / \\DeclareMathOperator。"""
    macros: dict[str, tuple[int, str]] = {}
    for m in re.finditer(r"\\(?:newcommand|renewcommand|providecommand)\*?\s*\{?\\([A-Za-z]+)\}?"
                         r"\s*(?:\[(\d)\])?\s*\{", text):
        body_start = m.end() - 1
        g = match_group(text, body_start)
        if g is None:
            continue
        macros["\\" + m.group(1)] = (int(m.group(2) or 0), g[0])
    for m in re.finditer(r"\\DeclareMathOperator\*?\s*\{\\([A-Za-z]+)\}\s*\{", text):
        g = match_group(text, m.end() - 1)
        if g is None:
            continue
        macros["\\" + m.group(1)] = (0, r"\mathrm{" + g[0] + "}")
    # 老式 \def\name{...} / \def\name#1#2{...}
    for m in re.finditer(r"\\def\s*\\([A-Za-z]+)\s*((?:#[1-9]\s*)*)\{", text):
        g = match_group(text, m.end() - 1)
        if g is None:
            continue
        nargs = len(re.findall(r"#[1-9]", m.group(2)))
        macros["\\" + m.group(1)] = (nargs, g[0])
    return macros


# ---------------------------------------------------------------- 类文件宏
# 期刊模板的数学简写大多定义在 .cls / .sty 里，而不是论文导言区。
# 只从 .tex 里收集，就会漏掉 \bbbr 这类写法，最后原样印进公式。
# 这里把 \documentclass / \usepackage 指向的文件也读进来一起收集。

_PKG_CACHE: dict[str, str] = {}


def _strip_tex_comments(s: str) -> str:
    return re.sub(r"(?<!\\)%[^\n]*", "", s)


def _pkg_files(text: str, base) -> list:
    """把 \\documentclass/\\usepackage 解析成本地文件路径。"""
    import shutil
    import subprocess
    from pathlib import Path

    base = Path(base)
    names: list[str] = []
    for m in re.finditer(
            r"\\(?:documentclass|usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}", text):
        for n in m.group(1).split(","):
            n = n.strip()
            if n and n not in names:
                names.append(n)
    kpse = shutil.which("kpsewhich")
    out = []
    for n in names:
        hit = None
        for ext in (".cls", ".sty"):
            cand = base / (n + ext)
            if cand.exists():
                hit = cand
                break
        if hit is None and kpse:
            key = n
            if key in _PKG_CACHE:
                hit = Path(_PKG_CACHE[key]) if _PKG_CACHE[key] else None
            else:
                found = ""
                for ext in (".cls", ".sty"):
                    try:
                        r = subprocess.run([kpse, n + ext], capture_output=True,
                                           text=True, timeout=8)
                    except Exception:  # noqa: BLE001
                        continue
                    if r.returncode == 0 and r.stdout.strip():
                        found = r.stdout.strip().splitlines()[0]
                        break
                _PKG_CACHE[key] = found
                hit = Path(found) if found else None
        if hit is not None and hit.exists() and hit.stat().st_size < 400_000:
            out.append(hit)
    return out


def collect_macros_with_files(text: str, base=None) -> tuple[dict[str, tuple[int, str]], list[str]]:
    """先收集类文件里的宏，再用论文自己的定义覆盖（导言区优先级更高）。

    返回 (宏表, 已读文件列表)，后者用来在日志里说明"这次到底展开了什么"。
    """
    macros: dict[str, tuple[int, str]] = {}
    used: list[str] = []
    if base is not None:
        for p in _pkg_files(text, base):
            try:
                raw = p.read_text(encoding="utf-8", errors="replace")
            except Exception:  # noqa: BLE001
                continue
            got = collect_macros(_strip_tex_comments(raw))
            # 类文件里大量定义是排版机器（含 @ 内部宏、超长结构），展开进公式只会更糟
            got = {k: v for k, v in got.items() if "@" not in v[1] and len(v[1]) <= 200}
            if got:
                macros.update(got)
                used.append(p.name)
    macros.update(collect_macros(text))
    return macros, used


# ---------------------------------------------------------- 多行环境兼容映射
# MathType 的 TeX 翻译器对多行环境的态度是"认就认、不认就摆烂"：不认的时候
# 仍然会把 `$...$` / `\[...\]` 变成一个 MathType 对象，然后把 `\begin` / `\end`
# 当普通字符画在公式里。结果就是公式外面看不出问题、里面夹着一串反斜杠命令。
# 逐项实测（MathType 7.8.2 + Word 16，一个公式一个文档，导出 PDF 扫文字层）：
#   \begin{array}{rl} / {rll} / matrix / pmatrix / bmatrix / Bmatrix / cases / align  → 干净
#   \begin{aligned} / gathered / split / eqnarray                                    → 有渣
# 顶层裸 \\ （不属于任何环境）同样有渣。
#
# 映射表：环境名 → (目标环境, 列格式)。列格式给 None 表示"按每行 & 的个数算"。
_ENV_REMAP: dict[str, tuple[str, str | None]] = {
    "aligned": ("array", None),
    "alignedat": ("array", None),
    "gathered": ("array", "c"),
    "split": ("array", "rl"),
    "eqnarray": ("array", "rcl"),
    "eqnarray*": ("array", "rcl"),
    "gather": ("array", "c"),
    "gather*": ("array", "c"),
    "multline": ("array", "l"),
    "multline*": ("array", "l"),
    "alignat": ("array", None),
    "alignat*": ("array", None),
}

_BEGIN_RE = re.compile(r"\\begin\{([A-Za-z*]+)\}")


def _remap_environments(tex: str) -> str:
    """把 MathType 不认的多行环境换成等价且受支持的写法。

    只处理映射表里点名的环境，其余（array / matrix / cases / bmatrix…）原样保留。
    结构不完整（有 \\begin 没 \\end）时原样返回，交给上层如实报失败，
    不在这里猜。
    """
    for name, (target, spec) in _ENV_REMAP.items():
        open_pat = re.compile(r"\\begin\{" + re.escape(name) + r"\}")
        end_tok = "\\end{%s}" % name
        guard = 0
        while True:
            m = open_pat.search(tex)
            if not m or guard > 50:
                break
            guard += 1
            e = tex.find(end_tok, m.end())
            if e < 0:
                break
            body = tex[m.end():e]
            if spec is None:
                # aligned 的语义就是"按 & 分列、首列右对齐其余左对齐"，
                # 所以列数取所有行里 & 最多的那一行 + 1。
                rows = body.split("\\\\")
                ncol = max(1, max((r.count("&") for r in rows), default=0) + 1)
                spec_txt = "{r" + "l" * (ncol - 1) + "}"
            else:
                spec_txt = "{%s}" % spec
            tex = (tex[:m.start()] + "\\begin{%s}%s" % (target, spec_txt)
                   + body + "\\end{%s}" % target + tex[e + len(end_tok):])
    return tex


def _fix_toplevel_breaks(tex: str) -> str:
    """处理**不属于任何环境**的顶层 `\\\\`。

    MathType 只认环境内部的换行；顶层裸 `\\\\` 会被当成字面字符画出来
    （实测 `\\[a=1\\\\ b=2\\]` 有渣）。这里按环境深度扫一遍：
    - 整条公式一个环境都没有 → 包成 `array{l}`，保住分行的视觉效果；
    - 环境外面还夹着换行 → 退化成 `\\quad` 接在上一行（不猜结构）。
    """
    if "\\\\" not in tex:
        return tex

    # 整条没有环境：直接包成单列 array，\\ 原样保留就是正确的换行
    if "\\begin{" not in tex:
        return "\\begin{array}{l}" + tex + "\\end{array}"

    depth, i, n = 0, 0, len(tex)
    pieces: list[str] = []
    while i < n:
        m = _BEGIN_RE.match(tex, i)
        if m:
            depth += 1
            pieces.append(m.group(0))
            i = m.end()
            continue
        if tex.startswith("\\end{", i):
            e = tex.find("}", i)
            if e > 0:
                depth = max(0, depth - 1)
                pieces.append(tex[i:e + 1])
                i = e + 1
                continue
        if tex.startswith("\\\\", i) and depth == 0:
            pieces.append("\\quad ")
            i += 2
            continue
        pieces.append(tex[i])
        i += 1
    return "".join(pieces)


def normalize(tex: str) -> str:
    # 带参数但不受支持的宏：\tfrac/\dfrac 单独处理
    for name in ("tfrac", "dfrac"):
        pat = re.compile(r"\\" + name + r"\s*\{")
        while True:
            m = pat.search(tex)
            if not m:
                break
            g1 = match_group(tex, m.end() - 1)
            if g1 is None:
                break
            j = g1[1]
            while j < len(tex) and tex[j] in " \t":
                j += 1
            g2 = match_group(tex, j)
            if g2 is None:
                break
            tex = tex[:m.start()] + r"\frac{" + g1[0] + "}{" + g2[0] + "}" + tex[g2[1]:]

    # 单参数宏
    for name, tpl in ARG_MACROS.items():
        if name in ("tfrac", "dfrac"):
            continue
        pat = re.compile(r"\\" + name + r"(?![A-Za-z])\s*\{")
        guard = 0
        while True:
            m = pat.search(tex)
            if not m or guard > 200:
                break
            guard += 1
            g = match_group(tex, m.end() - 1)
            if g is None:
                break
            tex = tex[:m.start()] + tpl.format(g[0]) + tex[g[1]:]

    # \operatorname*{...}
    tex = re.sub(r"\\operatorname\*\s*", lambda _m: r"\operatorname", tex)

    # 尺寸类定界符 \bigl[ \bigr] \Bigg\{ …：MathType 的 TeX 翻译器不认这一族，
    # 只要出现一次整条公式就直接失败（真实稿实测 3 条 eqnarray 全挂）。
    # 去掉尺寸命令、保留分隔符本身，视觉上只是括号小一号——比整条公式丢掉好得多。
    # 末尾的 (?![A-Za-z]) 保证 \bigcup / \bigcap / \bigoplus 不被误伤。
    tex = re.sub(r"\\(?:bigg|Bigg|big|Big)[lr]?(?![A-Za-z])", "", tex)

    # 空定界符 \left. / \right. 曾经被当成"MathType 必挂"，实测是误判——
    # 单独复现 \left\{...\right. 与 \left....\right\} 都能正常转换，当年那批失败
    # 全是长度上限造成的。所以这里**不再**把 \left/\right 退化掉：保留它们才能
    # 让括号跟着内容缩放，拆分段之间也能靠 \left. / \right. 接续。
    # 只有 \middle 这一族翻译器确实不认，去掉命令、留下分隔符本身。
    tex = re.sub(r"\\middle(?![A-Za-z])", "", tex)

    # 换行的可选行距 `\\[-2pt]`、`\\[3pt]`：MathType 的 TeX 翻译器完全不吃这一族，
    # 只要残留在公式里整条就静默失败（真实稿 eq.29 的尾段就是被 `\\[-2pt]` 打挂的，
    # 单独复现：原样挂、删掉即过，见 real_v11/_probe）。
    # 负值在 LaTeX 里本意是"把它挤回上一行"，语义上就是不断行，所以整个抹掉；
    # 非负值退回普通换行 `\\`。
    # 必须排在"顶层裸 \\ 处理"之前，否则会被当成换行改写掉。
    def _line_break(m: re.Match[str]) -> str:
        try:
            return "" if float(m.group(1)) < 0 else "\\\\"
        except ValueError:  # pragma: no cover
            return "\\\\"

    tex = re.sub(r"\\\\\s*\[\s*(-?\d+(?:\.\d+)?)\s*(?:pt|em|ex|cm|mm)?\s*\]",
                 _line_break, tex)

    # 多行环境：MathType 的 TeX 翻译器只认一部分，不认的那几个**不是报错**，
    # 而是把对象照建出来、再把 \begin / \end 当字面文字塞进公式里——比直接失败
    # 更糟，因为 `$` 没了、校验数对象也数得对，坏的是肉眼可见的公式内容。
    # 本机（MathType 7.8.2 + Word 16）逐项实测：
    #   认：array / matrix / pmatrix / bmatrix / Bmatrix / cases / align
    #   不认：aligned / gathered / split / eqnarray（外加顶层裸 \\）
    # 所以统一映射到 array / align，语法（& 与 \\）本来就是同一套。
    tex = _remap_environments(tex)
    tex = _fix_toplevel_breaks(tex)

    # 无参数宏（按长度倒序，避免 \R 抢占 \Re）
    for name in sorted(BARE_MACROS, key=len, reverse=True):
        rep = BARE_MACROS[name]
        if rep == "" and name.startswith((r"\vspace", r"\hspace")):
            tex = re.sub(re.escape(name) + r"\s*\{[^{}]*\}", "", tex)
            continue
        tex = re.sub(re.escape(name) + r"(?![A-Za-z])", lambda _m, r=rep: r, tex)

    # 删除带参数且不需要保留的命令
    for name in DROP_WITH_ARG:
        pat = re.compile(re.escape("\\" + name) + r"\s*\{")
        guard = 0
        while True:
            m = pat.search(tex)
            if not m or guard > 50:
                break
            guard += 1
            g = match_group(tex, m.end() - 1)
            if g is None:
                break
            tex = tex[:m.start()] + tex[g[1]:]

    # 清理残留：空花括号、多余空格
    tex = re.sub(r"\{\s*\}", "", tex)
    tex = re.sub(r"[ \t]{2,}", " ", tex)
    tex = tex.strip()

    # 无结构的"原子串"会让 Toggle TeX 静默失败，末尾补一个空组立刻就好，
    # 渲染结果完全一致。实测：$ab$ $kT$ $H'$ $2T$ $u,v,w$ $1.2$ $0.30$ 全挂，
    # 各自加 {} 后全过（见 real_v11/_probe）。
    #
    # 判据用"有没有结构符号"而不是字符白名单：白名单永远会漏——小数点就是这么
    # 漏掉的（"1.2" 里 '.' 不在白名单，于是没补组、静默失败）。反过来，
    # 反斜杠/上下标/花括号/圆括号/方括号/竖线任意出现一个，MathType 都能正常解析。
    if tex and not re.search(r"[\\_^{}()\[\]|]", tex):
        tex += "{}"
    return tex


def prepare_math(tex: str, macros: dict[str, tuple[int, str]] | None = None) -> str:
    out = _expand_user_macros(tex, macros or {})
    return normalize(out)


# ------------------------------------------------------------ 超长行间公式拆分
# MathType 的 TeX 翻译器对**单条公式**有长度上限，而且撞上限是静默失败：
# 本机实测（MathType 7.8.2 + Word 16）455 字符能转、525 字符必挂，
# 挂了之后原文原样留在正文，不报错。真实论文里一个 Equation 写六七行很常见，
# 所以这里按 \\ 换行处拆成几段，每段单独转成一个 MathType 对象。
#
# 拆点选在换行处，并让首段以 \right. 收尾、后续段以 \left. 开头——
# 空定界符 MathType 能正常渲染（单独实测 \left. a+b \right| 干净），
# 视觉上仍是同一个跨行大括号表达式，每段还能各自双击编辑。
MAX_DISPLAY_TEX = 440          # 留出 \[ \] 与包装的余量，上限实测在 455~525 之间

# 只有"按行排列"的环境才能拆。matrix/bmatrix/cases 拆开会散架，不在此列。
# 注意 normalize 已经把 aligned/gathered/split 映射成 array，所以这里主要是 array。
_SPLIT_ENVS = ("array", "align")
_EMPTY_RIGHT = "\\right."
_EMPTY_LEFT = "\\left."


def split_long_display(tex: str, limit: int = MAX_DISPLAY_TEX) -> list[str]:
    """把超长的多行行间公式拆成若干段，每段都能独立交给 MathType。

    返回的每一段都是**不带** `\\[ ... \\]` 包裹的公式体，长度都控制在 limit 以内。
    无法拆分（不含可拆环境，或本来就不长）时原样返回单元素列表。
    """
    if len(tex) <= limit:
        return [tex]

    m = re.search(r"\\begin\{(" + "|".join(_SPLIT_ENVS) + r")\}", tex)
    if not m:
        return [tex]
    env = m.group(1)

    # array 的列格式参数 {rl} 属于开头记号的一部分，漏掉它整段就是野的
    open_end = m.end()
    if env == "array":
        j = open_end
        while j < len(tex) and tex[j] in " \t\n":
            j += 1
        if j < len(tex) and tex[j] == "{":
            g = match_group(tex, j)
            if g is not None:
                open_end = g[1]

    end = tex.find("\\end{%s}" % env, open_end)
    if end < 0:
        return [tex]

    head, body, tail = tex[:m.start()], tex[open_end:end], tex[end:]
    rows = body.split("\\\\")
    if len(rows) < 2:
        return [tex]

    open_tok, close_tok = tex[m.start():open_end], "\\end{%s}" % env
    # 贪心时用保守的后缀开销，避免最后一段超出上限
    tail_cost = max(len(tail), len(_EMPTY_RIGHT))

    # 续段的悬挂缩进：首段前面那段 `\sum...V_{(k)}\left\{` 大约占 1em，
    # 续段如果顶格写，读者会以为这些行没被求和号乘进去（实测参考稿里续行
    # 正好落在这个位置）。`\phantom` 在 MathType 里不被支持——用了整条公式
    # 会退化成字面文本，所以只能用固定宽度的 `\quad` 近似。
    cont_indent = "\\quad" if head.strip() else ""
    cont_lead = _EMPTY_LEFT + cont_indent

    groups: list[list[str]] = [[]]
    for row in rows:
        cand = groups[-1] + [row]
        lead = head if len(groups) == 1 else cont_lead
        need = len(lead) + len(open_tok) + len("\\\\".join(cand)) + len(close_tok) + tail_cost
        if groups[-1] and need > limit:
            groups.append([row])
        else:
            groups[-1].append(row)

    if len(groups) == 1:
        return [tex]

    out: list[str] = []
    last = len(groups) - 1
    for i, g in enumerate(groups):
        # 首段只有当 head 里真的开了一个 \left 时才能配 \right.，
        # 否则会多出一个没有对应 \left 的空右定界符
        if i == 0:
            lead = head
            close_right = _EMPTY_RIGHT if "\\left" in head else ""
        else:
            lead = cont_lead
            close_right = "" if i == last else _EMPTY_RIGHT
        body_txt = "\\\\".join(g)
        # tail 自带 \end{env}，末段直接接上；其余段自己补 \end{env}
        end_tok = tail if i == last else close_tok + close_right
        seg = lead + open_tok + body_txt + end_tok
        # 补过 \left. 的段如果没有对应的 \right，MathType 会整条拒绝；
        # 这里按实际计数兜一次（\leftarrow 这类不算，正则排除后接字母的）
        n_left = len(re.findall(r"\\left(?![A-Za-z])", seg))
        n_right = len(re.findall(r"\\right(?![A-Za-z])", seg))
        if n_left > n_right:
            seg += _EMPTY_RIGHT
        out.append(seg)
    return out


# ---------------------------------------------------------------- 白名单校验
# MathType 遇到不认识的宏不会报错，而是把 "\foo" 当普通字符印出来。
# 唯一的防线是在进 pandoc 之前，用白名单核对归一化后的公式。
KNOWN_MACROS: frozenset[str] = frozenset("""
frac sqrt sum prod coprod int iint iiint oint lim liminf limsup sup inf max min arg
nabla partial infty forall exists nexists emptyset varnothing setminus cup cap bigcup bigcap
leq le geq ge neq ne approx equiv sim simeq cong propto ll gg prec succ
left right middle langle rangle lfloor rfloor lceil rceil lgroup rgroup
text textrm textit textbf mathrm mathbf mathit mathcal mathbb mathsf mathtt boldsymbol bm
hat tilde bar vec dot ddot dddot acute grave breve check widehat widetilde overrightarrow overleftarrow
overline underline overbrace underbrace overset underset stackrel
binom choose frac dfrac tfrac sqrt
alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi
omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega
Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega
to rightarrow leftarrow Rightarrow Leftarrow leftrightarrow Leftrightarrow mapsto longrightarrow
times div pm mp cdot cdots ldots dots vdots ddots ast star circ bullet oplus otimes
quad qquad hspace vspace phantom hphantom vphantom displaystyle textstyle scriptstyle scriptscriptstyle
begin end array matrix pmatrix bmatrix Bmatrix vmatrix Vmatrix cases align
langle rangle lbrace rbrace lbrack rbrack vert Vert lvert rvert lVert rVert
substack atop above relax cr
Re Im aleph hbar ell wp prime backslash
square blacksquare triangledown triangle Box
neg land lor implies iff models vdash dashv
sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln exp det dim ker deg gcd hom
mod bmod pmod
in ni subseteq supseteq setminus
rm bf it sf tt cal mit mathnormal
bullet star dagger ddagger
not
""".split())

# 这些宏在归一化阶段会被删掉/展开，不算残留
_IGNORED = frozenset("""
label tag nonumber notag allowbreak allowdisplaybreaks qed qedsymbol hfill
centsering noindent centering displaystyle textstyle scriptstyle
""".split())


# MathType 的 TeX 翻译器**认这些多行环境**（本机逐项实测）。
# 其余的（aligned / gathered / split / eqnarray …）不是"转换失败"，而是对象照建、
# `\begin` `\end` 变成字面文字——校验时对象数、`$` 残留数都正常，只有肉眼看得出。
# normalize 会把这些映射成 array，所以走到这里还剩下不认识的，一定是新写法，
# 必须报警而不是默默交给 MathType。
_SUPPORTED_ENVS = frozenset("""
array matrix pmatrix bmatrix Bmatrix vmatrix Vmatrix cases align
""".split())


def find_unsupported(tex: str) -> list[str]:
    """返回公式里仍然残留、且不在 MathType 已知集合中的宏（含反斜杠）。

    除了宏，还会检查多行环境名：环境不在 `_SUPPORTED_ENVS` 里时返回
    `\\begin{名字}`。这一条不能省——不认的环境不会报错，只会在公式里留下
    一串反斜杠命令，事后靠对象计数完全发现不了。
    """
    out: list[str] = []
    # 必须先吃掉换行符 `\\`，否则 `\\([A-Za-z]+)` 会把矩阵里的
    # `\\K_{\mathrm{II}}` 读成"宏 \K"——真实稿 eq.47 就这么被误报过。
    # 正则交替左优先：同一位置上能匹配 `\\` 时不会再退回去当 `\name`。
    for m in re.finditer(r"\\\\|\\[A-Za-z]+", tex):
        tok = m.group(0)
        if tok == "\\\\":          # 换行符，不是宏
            continue
        name = tok[1:]
        if name in KNOWN_MACROS or name in _IGNORED:
            continue
        if tok not in out:
            out.append(tok)
    for m in re.finditer(r"\\begin\{([A-Za-z*]+)\}", tex):
        if m.group(1) in _SUPPORTED_ENVS:
            continue
        tok = "\\begin{%s}" % m.group(1)
        if tok not in out:
            out.append(tok)
    return out

