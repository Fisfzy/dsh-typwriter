#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L2word-mathtype · S2.5 结构重写：把 pandoc 读不懂的 LaTeX 语义补回去。

pandoc 的 LaTeX reader 只认一小部分结构，遇到就整块丢掉或降级：

    \\begin{theorem}[X]      环境名、序号、可选标题全丢，只剩正文
    \\cite{key}              变成空白（句子直接出现窟窿）
    \\bibitem                [1] 编号丢失
    \\keywords{...}          整块消失
    \\institute{...}         整块消失（作者单位没了）
    \\subsubsection / \\paragraph   本应是行内小标题，被当成块级标题

这一步在公式已经换成占位符之后运行，所以可以放心做文本手术：
公式是 MTXi0007 这样的纯 token，不会被误伤。

输出约定 —— 段落开头的 @@STY:样式名@@ 是一个给 S3 看的标记：
    pandoc 会把它当普通文字原样搬过去，S3 把它删掉并把该段落套上同名样式。
    用来表达 pandoc 从 LaTeX 输入里没法直接表达的样式（Keywords / Institute / Abstract）。
"""
from __future__ import annotations

import re

THEOREM_ENVS = {
    "theorem": "Theorem", "proposition": "Proposition", "corollary": "Corollary",
    "lemma": "Lemma", "definition": "Definition", "example": "Example",
    "remark": "Remark", "conjecture": "Conjecture", "claim": "Claim",
    "assumption": "Assumption", "notation": "Notation", "exercise": "Exercise",
    "problem": "Problem", "property": "Property", "hypothesis": "Hypothesis",
    "observation": "Observation", "algorithm2e": None,
}
THEOREM_ENVS.pop("algorithm2e")

STYLE_MARK = "@@STY:{}@@"


# ---------------------------------------------------------------- 语言

# 模板的"天然语言"必须从文档自己推断，不能写死英文。
# 中文稿里印出 "Abstract." / "Keywords:" / "References" 是最刺眼的一类错误：
# 不报错、不影响任何计数、S5 也查不出来，只有翻到那一页才看得见。
LANG_STRINGS = {
    "zh": {
        "abstract": "摘要", "keywords": "关键词", "references": "参考文献",
        "appendix": "附录",
        "abstract_sep": "：", "keywords_sep": "：",
    },
    "en": {
        "abstract": "Abstract", "keywords": "Keywords", "references": "References",
        "appendix": "Appendix",
        "abstract_sep": ".", "keywords_sep": ":",
    },
}

# 摘要/关键词在各家模板里的写法。pandoc 只认 \begin{abstract}，
# 其余（尤其 \abstract{...} 命令形式）会整段静默丢弃，必须自己抽。
ABSTRACT_ENVS = ("abstract", "summary", "Abstract", "ABSTRACT", "Summary")
KEYWORD_ENVS = ("keywords", "keyword", "Keywords", "IEEEkeywords", "KWD", "key words")
KEYWORD_CMDS = ("keywords", "keyword", "kw")


def detect_lang(text: str) -> str:
    """判断文档的书写语言，返回 "zh" 或 "en"。

    两条判据，任一命中即判为中文：
      1. 用 ctex / xeCJK / CJK 宏包或 ctex 文档类；
      2. 中文字符 ≥ 60 个，且占非空白字符 5% 以上
         （英文稿里零星夹注中文不会误判）。
    """
    if re.search(r"\\usepackage(?:\[[^\]]*\])?\{ctex|\\documentclass(?:\[[^\]]*\])?\{ctex"
                 r"|\\usepackage\{xeCJK\}|\\usepackage\{CJK\}", text):
        return "zh"
    cjk = len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff]", text))
    if cjk >= 60:
        visible = len(re.sub(r"\s", "", text))
        if visible and cjk / visible >= 0.05:
            return "zh"
    return "en"


def lang_strings(lang: str) -> dict[str, str]:
    return LANG_STRINGS.get(lang, LANG_STRINGS["en"])


def sec_prefix(n: int, appendix: bool = False) -> str:
    """章节号：普通文档 1/2/3，`\\appendix` 之后 A/B/C（超过 26 个走 AA/AB）。"""
    if not appendix:
        return str(n)
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(ord("A") + r) + s
    return s


# ---------------------------------------------------------------- 定理计数器

def parse_newtheorems(text: str) -> dict[str, dict]:
    r"""解析导言区的 `\newtheorem` 声明。

    LaTeX 的规则：
        \newtheorem{theorem}{Theorem}                独立计数器
        \newtheorem{lemma}[theorem]{Lemma}           与 theorem 共用计数器
        \newtheorem{definition}{Definition}[section] 按节编号

    不解析它就只能一律"每环境独立计数"，于是 article 系的稿子会出现
    Theorem 1 / Lemma 1 / Definition 1 —— 三个本该是 1 2 3 的号全成了 1。
    """
    out: dict[str, dict] = {}
    pat = re.compile(
        r"\\newtheorem\*?\s*\{([^}]*)\}\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}"
        r"\s*(?:\[([^\]]*)\])?")
    for m in pat.finditer(text):
        env = m.group(1).strip()
        if not env:
            continue
        title = re.sub(r"\\[A-Za-z]+\s*", "", m.group(3)).strip() or env
        out[env] = {
            "title": title,
            "shared": (m.group(2) or "").strip() or None,
            "within": (m.group(4) or "").strip() or None,
        }
    return out


class TheoremNumbering:
    """定理类环境的发号器，S2（引用）与 S2.5（正文）共用同一份。

    两份实现各算一遍是这个项目已经踩过的坑（图表编号就是这么漂移的），
    所以定理号也收成一个类，两边都实例化它。
    """

    def __init__(self, decls: dict[str, dict] | None = None,
                 default_titles: dict[str, str] | None = None):
        self.decls = decls or {}
        self.default_titles = default_titles or THEOREM_ENVS
        self.counts: dict[str, int] = {}
        self.sec = 0
        self.appendix = False

    def title_of(self, env: str) -> str:
        d = self.decls.get(env) or {}
        return d.get("title") or self.default_titles.get(env) or env.capitalize()

    def set_section(self, sec: int) -> None:
        if sec != self.sec:
            self.sec = sec
            # 只有"按节编号"的计数器才在换节时清零
            if any(d.get("within") == "section" for d in self.decls.values()):
                self.counts.clear()

    def set_appendix(self, flag: bool = True) -> None:
        self.appendix = flag

    def next(self, env: str) -> str:
        d = self.decls.get(env) or {}
        key = d.get("shared") or env
        # 共享计数器时，"按节编号"的声明挂在被共享的那个环境上
        within = d.get("within") or (self.decls.get(key) or {}).get("within")
        self.counts[key] = self.counts.get(key, 0) + 1
        n = self.counts[key]
        if within == "section":
            return f"{sec_prefix(self.sec, self.appendix)}.{n}"
        return str(n)


# ---------------------------------------------------------------- 小工具

def match_brace(s: str, i: int) -> int:
    """i 指向 '{'，返回配对 '}' 的下标，失败 -1。"""
    if i >= len(s) or s[i] != "{":
        return -1
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
                return j
        j += 1
    return -1


def match_bracket(s: str, i: int) -> int:
    if i >= len(s) or s[i] != "[":
        return -1
    depth, j = 0, i
    while j < len(s):
        if s[j] == "\\":
            j += 2
            continue
        if s[j] == "[":
            depth += 1
        elif s[j] == "]":
            depth -= 1
            if depth == 0:
                return j
        j += 1
    return -1


def split_blocks(s: str) -> list[str]:
    return [b for b in re.split(r"\n\s*\n", s) if b.strip()]


def is_display_token(s: str) -> bool:
    return bool(re.fullmatch(r"\s*MTXd\d{4}\s*", s))


def _italic(chunk: str) -> str:
    """把一段正文包成斜体；纯公式占位符段落不包（公式本身不是斜体）。"""
    s = chunk.strip()
    if not s or is_display_token(s):
        return s
    return r"\textit{" + s + "}"


# ---------------------------------------------------------------- 1. 定理类环境

def rewrite_theorems(text: str, warnings: list[str],
                     decls: dict[str, dict] | None = None) -> str:
    decls = decls if decls is not None else parse_newtheorems(text)
    num = TheoremNumbering(decls)
    sec = 0
    # 环境名 = 内置常见名 ∪ 导言区 \newtheorem 声明的名字。
    # 只认内置表的话，`\newtheorem{thmx}{TheoremX}` 这类自定义定理环境会被
    # 完全当成未知环境（pandoc 丢掉名称和序号，\ref 也变成 ??）。
    names = "|".join(sorted(set(THEOREM_ENVS) | set(decls), key=len, reverse=True))
    pat = re.compile(r"\\begin\{(" + names + r")(\*?)\}")
    out: list[str] = []
    pos = 0
    while True:
        m = pat.search(text, pos)
        if not m:
            out.append(text[pos:])
            break
        env, star = m.group(1), m.group(2)
        full = env + star
        out.append(text[pos:m.start()])

        # 章节推进：定理号可能是 2.1 这种按节编号，也可能被 \appendix 切成 A.1。
        # 这个函数自己走一遍正文，所以顺手把节号数出来，不用外部再传参。
        for sm in re.finditer(r"\\section(?![A-Za-z*])|\\appendix(?![A-Za-z])",
                              text[pos:m.start()]):
            if sm.group(0).startswith("\\appendix"):
                num.set_appendix(True)
                sec = 0
            else:
                sec += 1
                num.set_section(sec)

        # 找配对的 \end{env}
        depth, j, end_start = 1, m.end(), -1
        scan = re.compile(r"\\(begin|end)\{" + re.escape(full) + r"\}")
        while True:
            n = scan.search(text, j)
            if not n:
                break
            depth += 1 if n.group(1) == "begin" else -1
            if depth == 0:
                end_start = n.start()
                j = n.end()
                break
            j = n.end()
        if end_start < 0:
            warnings.append(f"{full} 环境没有配对，已原样保留")
            out.append(text[m.start():m.end()])
            pos = m.end()
            continue

        body = text[m.end():end_start]
        # 可选标题 [Ghoussoub-Preiss]
        opt = ""
        rest = body.lstrip()
        if rest.startswith("["):
            k = match_bracket(rest, 0)
            if k > 0:
                opt = rest[1:k].strip()
                body = rest[k + 1:]
        body = re.sub(r"\\label\{[^}]*\}", "", body).strip()

        if star:
            label = num.title_of(env)
        else:
            label = f"{num.title_of(env)} {num.next(env)}"
        if opt:
            label += f" ({opt})"

        blocks = split_blocks(body) or [""]
        head = r"\textbf{" + label + ".}"
        first = blocks[0]
        if is_display_token(first):
            piece = head + "\n\n" + first
            tail = blocks[1:]
        else:
            piece = head + " " + _italic(first)
            tail = blocks[1:]
        for b in tail:
            piece += "\n\n" + _italic(b)
        out.append("\n\n" + piece + "\n\n")
        pos = j
    return "".join(out)


# ---------------------------------------------------------------- 2. 行内小标题

def rewrite_runin_headings(text: str) -> str:
    """\\subsubsection / \\paragraph 在 svproc/article 里是行内小标题，不是块级标题。"""
    for cmd, fmt in (("subsubsection", r"\textbf{{{}}}"), ("paragraph", r"\textit{{{}}}")):
        pat = re.compile(r"\\" + cmd + r"\*?\s*\{")
        guard = 0
        while guard < 200:
            guard += 1
            m = pat.search(text)
            if not m:
                break
            k = match_brace(text, m.end() - 1)
            if k < 0:
                break
            title = text[m.end():k].strip()
            p = k + 1
            while p < len(text) and text[p] in " \t\n":
                p += 1
            nb = re.search(r"\n\s*\n", text[p:])
            block = text[p:p + nb.start()] if nb else text[p:]
            if not block.strip():
                text = text[:m.start()] + fmt.format(title) + text[k + 1:]
                continue
            if is_display_token(block) or block.lstrip().startswith("\\"):
                # 后面紧跟公式或环境，不合并，只把标题变成加粗/斜体段落
                text = text[:m.start()] + fmt.format(title) + text[k + 1:]
                continue
            repl = fmt.format(title) + " " + block.strip()
            text = text[:m.start()] + repl + text[p + len(block):]
    return text


# ---------------------------------------------------------------- 3. 引用与参考文献

def build_bibmap(text: str) -> dict[str, int]:
    """svproc/unsrt 的编号 = \\bibitem 的声明顺序。"""
    keys = re.findall(r"\\bibitem(?:\[[^\]]*\])?\s*\{([^}]*)\}", text)
    return {k.strip(): i for i, k in enumerate(keys, 1)}


def rewrite_cites(text: str, bibmap: dict[str, int], warnings: list[str]) -> str:
    def rep(m: re.Match) -> str:
        keys = [k.strip() for k in m.group(2).split(",")]
        nums = []
        for k in keys:
            if k in bibmap:
                nums.append(str(bibmap[k]))
            else:
                warnings.append(f"引用 {k} 在 \\bibitem 里找不到")
        if not nums:
            return ""
        # 可选参数是页码/章节注记：\cite[p.~5]{k} → [1, p. 5]
        opts = re.findall(r"\[([^\]]*)\]", m.group(1) or "")
        note = opts[-1].replace("~", " ").strip() if opts else ""
        return "[" + ", ".join(nums) + (", " + note if note else "") + "]"

    return re.sub(r"\\cite[a-zA-Z]*\*?((?:\[[^\]]*\]){0,2})\s*\{([^}]*)\}", rep, text)


def bibliography_title(text: str, lang: str = "en") -> str:
    """文献表标题：优先作者自己的 \\refname/\\bibname 重定义，否则按语言取默认。"""
    for name in ("refname", "bibname"):
        m = re.search(r"\\(?:re)?newcommand\*?\s*\{\\" + name + r"\}\s*\{([^}]*)\}", text)
        if m and m.group(1).strip():
            return m.group(1).strip()
    return lang_strings(lang)["references"]


def rewrite_bibliography(text: str, lang: str = "en") -> str:
    m = re.search(r"\\begin\{thebibliography\}\{[^}]*\}", text)
    if not m:
        return text
    end = text.find("\\end{thebibliography}")
    if end < 0:
        return text
    block = text[m.end():end]
    parts = re.split(r"\\bibitem(?:\[[^\]]*\])?\s*\{[^}]*\}", block)[1:]
    items = [re.sub(r"\s+", " ", p).strip() for p in parts if p.strip()]
    body = "\n".join("\\item " + it for it in items)
    repl = ("\\section*{" + bibliography_title(text, lang) + "}\n\n"
            "\\begin{enumerate}\n" + body + "\n\\end{enumerate}\n")
    return text[:m.start()] + repl + text[end + len("\\end{thebibliography}"):]


# ---------------------------------------------------------------- 4. 摘要 / 关键词

def extract_keywords(text: str) -> tuple[str, str]:
    """把全文里的关键词块摘出来，返回 (去掉关键词的文本, 关键词文本)。

    关键词的写法比摘要还杂：`\\keywords{}` 是 svproc/Springer 风格，
    `\\begin{IEEEkeywords}` 是 IEEEtran，`\\begin{keyword}` 是 Elsevier。
    pandoc 对这些一律"保留文字、丢掉语义"，所以会在正文里留下裸段落。
    """
    found: list[str] = []

    for env in KEYWORD_ENVS:
        pat = re.compile(r"\\begin\{" + re.escape(env) + r"\}(.*?)\\end\{"
                         + re.escape(env) + r"\}", re.S)
        while True:
            m = pat.search(text)
            if not m:
                break
            if m.group(1).strip():
                found.append(m.group(1).strip())
            text = text[:m.start()] + text[m.end():]

    for cmd in KEYWORD_CMDS:
        while True:
            m = re.search(r"\\" + cmd + r"\s*(?:\[[^\]]*\])?\s*\{", text)
            if not m:
                break
            k = match_brace(text, m.end() - 1)
            if k < 0:
                break
            if text[m.end():k].strip():
                found.append(text[m.end():k].strip())
            text = text[:m.start()] + text[k + 1:]

    return text, " ".join(found).strip()


def rewrite_abstract(text: str, lang: str = "en", kw: str = "") -> str:
    """把摘要提到正文最前面并打上 Abstract 样式标记。

    支持 `\\begin{abstract}` / `\\begin{summary}` 环境与 `\\abstract{...}` 命令
    两种形式——后者是 Springer/Elsevier 那类模板的写法，pandoc 会整段丢弃。
    """
    S = lang_strings(lang)
    body = ""
    start = end = -1

    for env in ABSTRACT_ENVS:
        m = re.search(r"\\begin\{" + re.escape(env) + r"\}", text)
        if not m:
            continue
        close = text.find("\\end{" + env + "}", m.end())
        if close < 0:
            continue
        body = text[m.end():close]
        start, end = m.start(), close + len("\\end{" + env + "}")
        break

    if start < 0:
        m = re.search(r"\\abstract\s*\{", text)
        if m:
            k = match_brace(text, m.end() - 1)
            if k > 0:
                body = text[m.end():k]
                start, end = m.start(), k + 1

    if start < 0:
        return text

    # 摘要体里可能还夹着关键词（多数模板把 \keywords 写在 abstract 环境内）
    body, kw_in_body = extract_keywords(body)
    kw = " ".join(x for x in (kw, kw_in_body) if x).strip()
    body = body.strip()
    blocks = split_blocks(body) or [""]
    head = r"\textbf{" + S["abstract"] + S["abstract_sep"] + r"} "
    piece = STYLE_MARK.format("Abstract") + head + blocks[0].strip()
    for b in blocks[1:]:
        piece += "\n\n" + STYLE_MARK.format("Abstract") + b.strip()
    if kw:
        piece += ("\n\n" + STYLE_MARK.format("Keywords") + r"\textbf{"
                  + S["keywords"] + S["keywords_sep"] + r"} " + kw)
    return text[:start] + "\n\n" + piece + "\n\n" + text[end:]


# ---------------------------------------------------------------- 5. 标题页

# 单位/地址类命令：各出版社叫法不同。写死 \institute 的结果是换一套模板就
# 整块静默消失 —— IOP 的 \affil 实测被 pandoc 连参数一起吞掉，一个字不剩。
AFFIL_CMDS = ("institute", "affil", "affiliation", "affiliations",
              "address", "organization", "institution")

# pandoc 自己认识的 front matter 命令，别替它展开（展开反而破坏标题/作者域）
FRONT_SAFE = {
    "title", "author", "date", "maketitle", "and", "thanks", "email", "inst",
    "footnote", "thanks", "ref", "eqref", "autoref", "cref", "Cref", "pageref",
    "label", "cite", "citet", "citep", "citeauthor", "citeyear", "nocite",
    "textbf", "textit", "texttt", "textsf", "textrm", "textsc", "textup",
    "textsuperscript", "textsubscript", "emph", "textsl", "textnormal",
    "url", "href", "hspace", "vspace", "mbox", "hbox", "noindent", "indent",
    "fontsize", "selectfont", "rmfamily", "bfseries", "itshape", "mdseries",
    "scshape", "upshape", "small", "large", "Large", "footnotesize",
    "scriptsize", "tiny", "centering", "hfill", "vfill", "newline",
    "linebreak", "today", "section", "subsection", "subsubsection",
    "paragraph", "item", "caption", "quad", "qquad", "ldots", "dots",
}

# 只有编号/标识、没有正文的命令，直接删掉（展开只会留一串数字）
DROP_ONLY_CMDS = ("orcid",)


def _strip_lead_cite(s: str) -> str:
    """去掉单位自带的上标编号：\\affil{$^1$Princeton...}，编号由我们统一加。"""
    return re.sub(r"^\s*\$?\s*\^\{?\s*(\d+)\s*\}?\s*\$?\s*", "", s).strip()


def unwrap_front_macros(text: str, macros: dict[str, tuple[int, str]] | None,
                        warnings: list[str]) -> str:
    """把 front matter 里"工程自己定义、pandoc 不认识"的单参数命令展开成段落。

    这类命令 pandoc 会连参数一起丢掉且不报错。判据只认"本工程确实定义过、且
    只吃一个参数"的命令，所以不会误伤 \\section 这类原语。
    """
    if not macros:
        return text
    cut = len(text)
    m = re.search(r"\\section\*?\s*[\[{]", text)
    if m:
        cut = m.start()
    hits: list[tuple[int, int, str, str]] = []
    last = -1
    for mm in re.finditer(r"\\([A-Za-z]+)\s*\{", text[:cut]):
        name = mm.group(1)
        if mm.start() < last or name in FRONT_SAFE:
            continue
        info = macros.get("\\" + name)
        if not info or info[0] != 1:
            continue
        k = match_brace(text, mm.end() - 1)
        if k < 0 or k + 1 > cut:
            continue
        arg = text[mm.end():k].strip()
        if not arg or len(arg) > 300:
            continue
        hits.append((mm.start(), k + 1, name, arg))
        last = k + 1
    if not hits:
        return text
    for start, end, name, arg in reversed(hits):
        text = text[:start] + "\n\n" + arg + "\n\n" + text[end:]
    names = sorted({h[2] for h in hits})
    warnings.append(
        f"模板自定义的 {'、'.join('\\\\' + n for n in names)} 在 pandoc 里会被整块丢弃，"
        f"已展开为普通段落（{len(hits)} 处）")
    return text


# 页眉运行栏的短标题/短作者：各出版社叫法完全不同，逐个试，谁有就用谁。
#   svproc/splnproc : \titlerunning / \authorrunning
#   Springer        : \titlemark / \authormark（也常见 \shorttitle）
#   Elsevier/else   : \shorttitle / \shortauthor
RUNNING_AUTHOR_CMDS = ("authorrunning", "shortauthor", "runningauthor",
                       "authorshort", "authormark")
RUNNING_TITLE_CMDS = ("titlerunning", "shorttitle", "runningtitle",
                      "titlemark", "shorttitle")


def _grab_cmd_arg(text: str, cmd: str) -> str:
    m = re.search(r"\\" + cmd + r"\s*\{", text)
    if not m:
        return ""
    k = match_brace(text, m.end() - 1)
    return text[m.end():k].strip() if k > 0 else ""


def rewrite_titlepage(text: str, meta: dict,
                      warnings: list[str] | None = None,
                      macros: dict[str, tuple[int, str]] | None = None) -> str:
    warnings = warnings if warnings is not None else []
    # 运行栏（页眉）：按上面两张表逐个试
    for cmd in RUNNING_AUTHOR_CMDS:
        v = _grab_cmd_arg(text, cmd)
        if v:
            meta["running_head"] = v
            break
    for cmd in RUNNING_TITLE_CMDS:
        v = _grab_cmd_arg(text, cmd)
        if v:
            meta["title_running"] = v
            break

    # \markboth{左}{右} / \markright{右}：语义随模板而变（IEEEtran 左=刊物信息、
    # 右=作者；book 类左=章名、右=节名），猜不准就不猜——只删掉，
    # 免得 pandoc 把它们当普通文字印进正文。
    marked = re.search(r"\\(?:markboth|markright)\s*\{", text)
    if marked:
        warnings.append("检测到 \\markboth/\\markright：页眉各页内容随模板语义而定，"
                        "未自动还原，请在 Word 里核对页眉")
    for cmd in ("markboth", "markright"):
        guard = 0
        while guard < 20:
            guard += 1
            m = re.search(r"\\" + cmd + r"\s*\{", text)
            if not m:
                break
            k = match_brace(text, m.end() - 1)
            if k < 0:
                break
            end = k + 1
            if cmd == "markboth":                      # 第二个参数
                m2 = re.match(r"\s*\{", text[end:])
                if m2:
                    k2 = match_brace(text, end + m2.end() - 1)
                    if k2 > 0:
                        end = k2 + 1
            text = text[:m.start()] + text[end:]

    # \pagestyle{empty} / \thispagestyle{empty}：作者明确不要页眉页脚。
    # 一些会议模板（IOP Conference Series 等）禁止自加页眉页码，必须尊重这个声明，
    # 否则导出的 PDF 会多出一条作者栏。
    if re.search(r"\\(?:this)?pagestyle\s*\{\s*empty\s*\}", text):
        meta["no_running_head"] = True

    # 去掉 pandoc 用不上的运行栏专用命令（含参数整体删除）
    for cmd in ((RUNNING_TITLE_CMDS + RUNNING_AUTHOR_CMDS
                 + ("tocauthor", "subclass")) + DROP_ONLY_CMDS):
        guard = 0
        while guard < 20:
            guard += 1
            m = re.search(r"\\" + cmd + r"\s*\{", text)
            if not m:
                break
            k = match_brace(text, m.end() - 1)
            if k < 0:
                break
            text = text[:m.start()] + text[k + 1:]

    # 作者块：\inst{n} → 上标；\and → 逗号（pandoc 会把 \and 拆成多个 Author 段）
    m = re.search(r"\\author\s*\{", text)
    if m:
        k = match_brace(text, m.end() - 1)
        if k > 0:
            block = text[m.end():k]
            block = re.sub(
                r"\\inst\s*\{([^}]*)\}",
                lambda mm: r"\textsuperscript{" + mm.group(1).strip() + "}", block)
            block = block.replace("\\and", ",")
            block = re.sub(r"\s*,\s*", ", ", block)
            block = re.sub(r"\s+", " ", block).strip().strip(",").strip()
            text = text[:m.end()] + block + text[k:]

    # 单位块：pandoc 直接丢弃（\institute / \affil / \affiliation …叫法各异），
    # 这里统一改成"带上标编号的居中段落"，编号跨命令连续。
    inst_parts: list[str] = []
    anchor: int | None = None
    for cmd in AFFIL_CMDS:
        guard = 0
        while guard < 30:
            guard += 1
            m = re.search(r"\\" + cmd + r"\s*\{", text)
            if not m:
                break
            if anchor is None:
                anchor = m.start()
            k = match_brace(text, m.end() - 1)
            if k < 0:
                break
            body = text[m.end():k]
            text = text[:m.start()] + text[k + 1:]
            for p in body.split("\\and"):
                p = re.sub(r"\s+", " ", p).strip().strip(",").strip()
                p = _strip_lead_cite(p)
                if p:
                    inst_parts.append(p)

    # 还有没被上面认出来的模板自定义命令 → 兜底展开，绝不静默丢整块
    text = unwrap_front_macros(text, macros, warnings)

    inst = "\n\n".join(
        STYLE_MARK.format("Institute") + r"\textsuperscript{" + str(n) + "} " + p
        for n, p in enumerate(inst_parts, 1))

    if inst:
        # 有 \maketitle 就挂在它后面（单位永远在标题之下）；没有就留在原位置，
        # 不然会把单位提到标题上面去（IOP 模板没有 \maketitle）。
        mk = re.search(r"\\maketitle", text)
        if mk and (anchor is None or mk.start() >= anchor):
            pos = mk.end()
        elif anchor is not None:
            pos = min(anchor, len(text))
        else:
            pos = 0
        text = text[:pos] + "\n\n" + inst + "\n\n" + text[pos:]
    return text


# ---------------------------------------------------------------- 6. 题注编号

FIG_MARK = "@@FG{:04d}@@"
TAB_MARK = "@@TB{:04d}@@"

# 题注前缀词：不同模板叫法不同（Fig./Figure/图），从源码里认，不写死
DEFAULT_CAPTION_NAMES = {"figure": "Fig.", "table": "Table"}


def detect_caption_names(text: str) -> dict[str, str]:
    """识别 \\figurename / \\tablename 的重定义，以及中文模板（ctex 系列）。"""
    names = dict(DEFAULT_CAPTION_NAMES)
    for m in re.finditer(r"\\renewcommand\*?\s*\{\\(figurename|tablename)\}\s*\{([^}]*)\}", text):
        key = "figure" if m.group(1) == "figurename" else "table"
        val = m.group(2).strip().rstrip(".").strip()
        if val:
            names[key] = val
    if re.search(r"\\usepackage(?:\[[^\]]*\])?\{ctex|\\documentclass(?:\[[^\]]*\])?\{ctex"
                 r"|\\usepackage\{xeCJK\}|\\usepackage\{CJK\}", text):
        names.setdefault("_cjk", "1")
        if names["figure"] == DEFAULT_CAPTION_NAMES["figure"]:
            names["figure"], names["table"] = "图", "表"
    return names


def _alpha(n: int) -> str:
    """1→a, 2→b … 26→z, 27→aa（子图字母）。"""
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(ord("a") + r) + s
    return s


def _env_span(s: str, start: int, env: str) -> int:
    """返回从 start（\\begin{env} 的起点）开始的环境结束位置（\\end{env} 之后）。"""
    depth, j = 1, s.find("{", start) + 1
    pat = re.compile(r"\\(begin|end)\{" + re.escape(env) + r"\}")
    for n in pat.finditer(s, j):
        depth += 1 if n.group(1) == "begin" else -1
        if depth == 0:
            return n.end(), n.start()
    return -1, -1


def _number_subfigures(block: str, parent: int, subs: dict) -> tuple[str, int, list]:
    """给 subfigure/subtable 里的 \\caption 加 (a)/(b) 前缀。

    子图题注在 LaTeX 里是 "(a) Sub A"，主图题注才是 "Fig. 1."。
    旧实现每个 float 只认第一条 \\caption，于是第一个子图吃掉主图编号、
    第二个起的子图变成裸题注（探针实测："Fig. 1. Sub A" / "Sub B" / "Main caption"）。
    """
    out: list[str] = []
    regions: list[tuple[int, int]] = []
    pos = 0
    letter = 0
    pat = re.compile(r"\\begin\{(subfigure|subtable)\}")
    while True:
        m = pat.search(block, pos)
        if not m:
            out.append(block[pos:])
            break
        out.append(block[pos:m.start()])
        env = m.group(1)
        after, end_start = _env_span(block, m.start(), env)
        if after < 0:
            out.append(block[m.start():m.end()])
            pos = m.end()
            continue
        inner = block[m.end():end_start]
        cm = re.search(r"\\caption(\[[^\]]*\])?\s*\{", inner)
        piece = inner
        if cm:
            letter += 1
            tag = _alpha(letter)
            k = match_brace(inner, cm.end() - 1)
            if k > 0:
                cap = inner[cm.end():k].strip()
                piece = (inner[:cm.start()] + r"\caption{" + f"({tag}) " + cap + "}"
                         + inner[k + 1:])
            for lm in re.finditer(r"\\label\{([^}]*)\}", piece):
                subs[lm.group(1).strip()] = (
                    str(parent), tag, "figure" if env == "subfigure" else "table")
        seg = block[m.start():m.end()] + piece + f"\\end{{{env}}}"
        regions.append((sum(len(x) for x in out), sum(len(x) for x in out) + len(seg)))
        out.append(seg)
        pos = after
    return "".join(out), letter, regions


def _prefix_caption(block: str, prefix: str, skip: list[tuple[int, int]] | None = None
                    ) -> tuple[str, int]:
    """给块内第一条（不在 skip 区间里的）\\caption 加前缀，返回新块与插入位置。"""
    for cm in re.finditer(r"\\caption(\[[^\]]*\])?\s*\{", block):
        if skip and any(a <= cm.start() < b for a, b in skip):
            continue
        k = match_brace(block, cm.end() - 1)
        if k < 0:
            continue
        cap = block[cm.end():k].strip()
        return block[:cm.start()] + r"\caption{" + prefix + cap + "}" + block[k + 1:], cm.start()
    return block, -1


def number_captions(text: str, names: dict[str, str] | None = None,
                    subs: dict | None = None
                    ) -> tuple[str, dict[str, tuple[str, str]]]:
    """给 \\caption 加编号前缀，编号位置写成 @@FG0003@@ 之类的标记。

    为什么不直接写死 "Fig. 3."：
        写死的是文本，插一张图就全错了。标记由 S3 换成 Word 的 SEQ 域，
        插图增删后 Ctrl+A→F9 能重排；图表的 \\ref 也能用 REF 域指过来。

    `subs` 是出参：子图 label → (主图号, 字母)，供交叉引用拼 "1a" 用。
    """
    names = names or DEFAULT_CAPTION_NAMES
    subs = subs if subs is not None else {}
    sep = "" if names.get("_cjk") else "~"
    fig = tab = 0
    caps: dict[str, tuple[str, str]] = {}

    def walk(s: str) -> str:
        nonlocal fig, tab
        res = []
        i = 0
        pat = re.compile(r"\\begin\{(figure|table|longtable)(\*?)\}")
        while True:
            m = pat.search(s, i)
            if not m:
                res.append(s[i:])
                break
            res.append(s[i:m.start()])
            kind = m.group(1)
            full = kind + m.group(2)
            depth, j, end = 1, m.end(), -1
            scan = re.compile(r"\\(begin|end)\{" + re.escape(full) + r"\}")
            while True:
                n = scan.search(s, j)
                if not n:
                    break
                depth += 1 if n.group(1) == "begin" else -1
                if depth == 0:
                    end = n.start()
                    break
                j = n.end()
            if end < 0:
                res.append(s[m.start():m.end()])
                i = m.end()
                continue
            block = s[m.start():end]
            # 没有题注就没有号，别白占一个（否则后面所有图表号整体前移）
            if not re.search(r"\\caption(\[[^\]]*\])?\s*\{", block):
                res.append(block)
                i = end
                continue
            skip: list[tuple[int, int]] = []
            if kind == "figure":
                fig += 1
                num = fig
                block, _nsub, skip = _number_subfigures(block, fig, subs)
            else:
                tab += 1
                num = tab
            key = "figure" if kind == "figure" else "table"
            mark = (FIG_MARK if kind == "figure" else TAB_MARK).format(num)
            prefix = r"\textbf{" + names[key] + sep + mark + ".} "
            block, _ = _prefix_caption(block, prefix, skip)
            # 环境里所有 \label 都指向这个题注（\label 常写在 \caption 之后）
            for lm in re.finditer(r"\\label\{([^}]*)\}", block):
                lab = lm.group(1).strip()
                if lab and lab not in subs:
                    caps[lab] = (str(num), key)
            res.append(block)
            i = end
        return "".join(res)
    return walk(text), caps


# ---------------------------------------------------------------- 7. 杂项清理

def strip_longtable_heads(text: str) -> str:
    """切掉 longtable 的重复表头/表尾定义块。

    longtable 会把表头写两遍：`\\endfirsthead` 前面是第一份，`\\endhead` 前面
    是"续页"用的第二份。pandoc 不认这套语义，于是同一行表头在 Word 里出现两次。
    """
    text = re.sub(r"\\endfirsthead.*?\\endhead", "", text, flags=re.S)
    text = re.sub(r"\\endfoot.*?\\endlastfoot", "", text, flags=re.S)
    return re.sub(r"\\(?:endfirsthead|endhead|endfoot|endlastfoot)(?![A-Za-z])", "", text)


TOC_MARK = "@@TOC@@"
APX_MARK = "@@APX@@"


def mark_appendix(text: str) -> str:
    """`\\appendix` → 标记段落。

    pandoc 完全无视 `\\appendix`（探针实测：附录章节接着编号 3，而不是 A）。
    章节号是 pandoc 按 --number-sections 自己印的，只能等它排完之后再改，
    所以这里先埋一个标记，S3 见到标记就把后面所有标题号换成 A / A.1。
    """
    return re.sub(r"\\appendix(?![A-Za-z])\s*",
                  lambda _m: "\n\n" + APX_MARK + "\n\n", text)


def rewrite_toc(text: str, warnings: list[str]) -> str:
    """`\\tableofcontents` → @@TOC@@ 标记，由 S3 换成 Word 的 TOC 域。

    pandoc 直接把它吃掉，连个空段落都不留（探针实测整块消失、零告警）。
    Word 的目录是域，必须由 Word 自己排版，所以这里只放域、不生成条目。
    """
    if "\\tableofcontents" in text:
        warnings.append("\\tableofcontents 已转成 Word 的 TOC 域："
                        "打开文档后 Ctrl+A → F9 才会显示条目")
        text = re.sub(r"\\tableofcontents\s*",
                      lambda _m: "\n\n" + TOC_MARK + "\n\n", text)
    if re.search(r"\\(?:listoffigures|listoftables)\b", text):
        warnings.append("\\listoffigures / \\listoftables 未自动生成，"
                        "需要的话在 Word 里用「引用 → 插入表目录」")
        text = re.sub(r"\\(?:listoffigures|listoftables)\b\s*", "", text)
    return text


def cleanup_misc(text: str, warnings: list[str] | None = None) -> str:
    # \- 是可断字提示，零视觉内容，留着会印出一个连字符
    text = text.replace("\\-", "")
    text = strip_longtable_heads(text)
    if warnings is not None:
        n_multi = len(re.findall(r"\\(?:multirow|multicolumn)(?![A-Za-z])", text))
        if n_multi:
            warnings.append(
                f"{n_multi} 处 \\multirow / \\multicolumn 会被拍平成普通单元格"
                f"（合并跨行跨列是 Word 表格属性，LaTeX 源码里表达不出来），上刊前要手工合并")
    # \email / \homedir 是 svproc 专用，pandoc 不认
    for _ in range(20):
        m = re.search(r"\\email\s*\{", text)
        if not m:
            break
        k = match_brace(text, m.end() - 1)
        if k < 0:
            break
        text = text[:m.start()] + text[m.end():k] + text[k + 1:]
    text = text.replace("\\homedir", "~")
    # \qed 手写在 proof 之外时 pandoc 会转成 "0◻"，与 proof 自带的 ◻ 叠加
    text = re.sub(r"\\qed(?![A-Za-z])", "", text)
    return text


# ---------------------------------------------------------------- 汇总

def restructure(text: str, meta: dict | None = None, warnings: list[str] | None = None,
                macros: dict[str, tuple[int, str]] | None = None) -> str:
    meta = meta if meta is not None else {}
    warnings = warnings if warnings is not None else []
    bibmap = build_bibmap(text)

    # 语言先判：摘要/关键词/文献标题的词形都从这里来，不能各写一份英文
    lang = detect_lang(text)
    meta["lang"] = lang
    meta["bib_title"] = bibliography_title(text, lang)

    text = cleanup_misc(text, warnings)
    text = rewrite_toc(text, warnings)
    text = mark_appendix(text)
    text = rewrite_titlepage(text, meta, warnings, macros)
    # 关键词可能在摘要环境里，也可能独立成环境（IEEEtran/Elsevier），先全局摘
    text, kw = extract_keywords(text)
    text = rewrite_abstract(text, lang, kw)
    text = rewrite_cites(text, bibmap, warnings)
    text = rewrite_bibliography(text, lang)
    cap_names = detect_caption_names(text)
    subs: dict = {}
    text, caps = number_captions(text, cap_names, subs)
    meta["captions"] = caps
    meta["sub_captions"] = subs
    meta["caption_names"] = {k: v for k, v in cap_names.items() if not k.startswith("_")}
    text = rewrite_theorems(text, warnings)
    text = rewrite_runin_headings(text)
    meta["bib_count"] = len(bibmap)
    return text
