#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L2word-mathtype · bibtex 支持：把 `\\bibliography{refs}` 就地展开成文献表。

为什么需要：
    绝大多数期刊/学位论文模板用 `.bib` + `\\bibliography{}`，而不是手写
    `\\begin{thebibliography}`。旧版只认后者，于是：`\\cite` 全输出空白
    （句子直接出现窟窿）、参考文献表整块消失、S1 审计还把 natbib 标成
    "支持 / 低风险" —— 这是最坏的一种失败：不报错、结果错。

为什么不用 bibtex 二进制：
    一是很多机器上没装；二是它要 `.aux` 文件、要跑两遍、还要处理
    `.bst` 宏语言，链路比这里长得多。这里只做"够用"的那部分：
    读 `.bib`、按引用顺序（或字母序）编号、输出接近 unsrt/plain 的条目文本。
    复杂 `.bst` 样式（作者-年、缩略期刊名）不做，会在 warnings 里说明。

用法（由 prep_tex.py 调用）：
    text = expand_bibliography(text, base_dir, warnings)
"""
from __future__ import annotations

import re
from pathlib import Path

CITE_RE = re.compile(r"\\(?:no)?cite[a-zA-Z]*\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}")


# ---------------------------------------------------------------- bib 解析

def _match_close(s: str, i: int) -> int:
    """i 指向 '{' 或 '('，返回配对的 '}' / ')' 下标。花括号要按嵌套深度算。"""
    if i >= len(s):
        return -1
    open_ch = s[i]
    close_ch = "}" if open_ch == "{" else ")"
    depth = 0
    j = i
    while j < len(s):
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return j
        j += 1
    return -1


def _read_value(s: str, i: int) -> tuple[str, int]:
    """读一个字段值：{...} / "..." / 裸数字 / 宏名，支持用 # 拼接。"""
    parts: list[str] = []
    n = len(s)
    while i < n:
        while i < n and s[i] in " \t\r\n":
            i += 1
        if i >= n:
            break
        if s[i] == "{":
            k = _match_close(s, i)
            if k < 0:
                break
            parts.append(s[i + 1:k])
            i = k + 1
        elif s[i] == '"':
            k = i + 1
            buf = []
            while k < n and s[k] != '"':
                if s[k] == "\\":
                    buf.append(s[k:k + 2])
                    k += 2
                    continue
                buf.append(s[k])
                k += 1
            parts.append("".join(buf))
            i = k + 1
        else:
            m = re.match(r"[\w.-]+", s[i:])
            if not m:
                break
            parts.append(m.group(0))
            i += m.end()
        while i < n and s[i] in " \t\r\n":
            i += 1
        if i < n and s[i] == "#":
            i += 1
            continue
        break
    return "".join(parts), i


def _parse_entry(body: str) -> tuple[str, dict[str, str]]:
    comma = body.find(",")
    key = body[:comma].strip() if comma > 0 else body.strip()
    if not re.fullmatch(r"[^,\s{}()]+", key or ""):
        return "", {}
    fields: dict[str, str] = {}
    i = comma + 1 if comma > 0 else len(body)
    n = len(body)
    while i < n:
        while i < n and body[i] in " \t\r\n,":
            i += 1
        m = re.match(r"([A-Za-z][\w-]*)\s*=", body[i:])
        if not m:
            break
        name = m.group(1).lower()
        val, i = _read_value(body, i + m.end())
        fields[name] = val.strip()
    return key, fields


def parse_bib(text: str) -> dict[str, dict]:
    """解析 .bib 文本，返回 key → {type, fields}。"""
    entries: dict[str, dict] = {}
    i = 0
    while True:
        at = text.find("@", i)
        if at < 0:
            break
        m = re.match(r"@\s*([A-Za-z]+)\s*[{(]", text[at:])
        if not m:
            i = at + 1
            continue
        typ = m.group(1).lower()
        open_idx = at + m.end() - 1
        close = _match_close(text, open_idx)
        if close < 0:
            break
        if typ not in ("comment", "preamble", "string"):
            key, fields = _parse_entry(text[open_idx + 1:close])
            if key:
                entries[key.lower()] = {"type": typ, "key": key, "fields": fields}
        i = close + 1
    return entries


# ---------------------------------------------------------------- 条目格式化

MONTHS = {"jan": "January", "feb": "February", "mar": "March", "apr": "April",
          "may": "May", "jun": "June", "jul": "July", "aug": "August",
          "sep": "September", "oct": "October", "nov": "November", "dec": "December"}


def _initials(name: str) -> str:
    out = []
    for tok in re.split(r"\s+", name.strip()):
        if not tok:
            continue
        if tok.endswith(".") and len(tok) <= 3:
            out.append(tok)
        elif "-" in tok:  # Jean-Paul → J.-P.
            out.append("-".join(x[0].upper() + "." for x in tok.split("-") if x))
        else:
            out.append(tok[0].upper() + ".")
    return " ".join(out)


def format_authors(raw: str) -> str:
    names = [p.strip() for p in re.split(r"\s+and\s+", raw or "") if p.strip()]
    out = []
    for p in names:
        if p.lower() in ("others", "et al.", "et al"):
            out.append("et al.")
            continue
        if "," in p:
            last, first = p.split(",", 1)
            out.append(f"{_initials(first)} {last.strip()}".strip())
        else:
            toks = p.split()
            if len(toks) == 1:
                out.append(toks[0])
            else:
                out.append(f"{_initials(' '.join(toks[:-1]))} {toks[-1]}".strip())
    return ", ".join(out)


def _strip_protect_braces(s: str) -> str:
    """去掉 `{Study}` 这种"保护大写"的花括号，但别碰 `\\textit{...}` 和公式。

    数学段（$...$）原样保留：`K_{I}` 里的花括号是下标语法，删了会变味。
    """
    parts = re.split(r"(\$[^$]*\$)", s)
    out = []
    for i, p in enumerate(parts):
        if i % 2:                      # 奇数位是 $...$，不动
            out.append(p)
            continue
        for _ in range(4):
            new = re.sub(r"(?<![\\A-Za-z])\{([^{}]*)\}", r"\1", p)
            if new == p:
                break
            p = new
        out.append(p)
    return "".join(out)


def clean_tex(s: str) -> str:
    """bib 字段里的排版糖前后处理：破折号、不换行空格、裸的 & 和 %。"""
    if not s:
        return ""
    s = s.replace("---", "—").replace("--", "–")
    s = re.sub(r"(?<!\\)~", " ", s)
    s = re.sub(r"(?<!\\)%", r"\\%", s)
    s = re.sub(r"(?<!\\)&", r"\\&", s)
    s = re.sub(r"\\(?:noindent|newblock|relax)\b", "", s)
    s = re.sub(r"\\[A-Za-z]+\{\}", "", s)      # \relax{} 之类的空命令
    s = _strip_protect_braces(s)
    s = re.sub(r"\s+", " ", s).strip()
    s = s.strip(".,;")
    return s


def _field(f: dict[str, str], *names: str) -> str:
    for n in names:
        v = clean_tex(f.get(n, ""))
        if v:
            return v
    return ""


def format_entry(entry: dict) -> str:
    """把一个条目排成接近 unsrt/plain 的参考文献文本。"""
    f = entry["fields"]
    typ = entry["type"]
    au = format_authors(f.get("author", "") or f.get("editor", ""))
    ed = format_authors(f.get("editor", "")) if f.get("editor") else ""
    ti = _field(f, "title")
    yr = _field(f, "year")
    vol = _field(f, "volume")
    num = _field(f, "number")
    pages = _field(f, "pages")
    pg = f"pp. {pages}" if pages else ""

    def joiner(*parts: str) -> str:
        return ", ".join(p for p in parts if p)

    if typ == "article":
        jr = _field(f, "journal", "journaltitle")
        body = joiner(au, f'"{ti},"' if ti else "",
                      rf"\textit{{{jr}}}" if jr else "",
                      f"vol. {vol}" if vol else "",
                      f"no. {num}" if num else "",
                      pg, yr)
    elif typ == "book":
        pub = joiner(_field(f, "address"), _field(f, "publisher"))
        body = joiner(au or ed, rf"\textit{{{ti}}}" if ti else "",
                      pub, f"vol. {vol}" if vol else "", yr)
    elif typ in ("inproceedings", "conference"):
        bt = _field(f, "booktitle")
        body = joiner(au, f'"{ti},"' if ti else "",
                      f"in \\textit{{{bt}}}" if bt else "",
                      _field(f, "address"), _field(f, "organization"),
                      yr, pg)
    elif typ == "incollection":
        bt = _field(f, "booktitle")
        body = joiner(au, f'"{ti},"' if ti else "",
                      f"in \\textit{{{bt}}}" if bt else "",
                      _field(f, "publisher"), yr, pg)
    elif typ == "phdthesis":
        body = joiner(au, f'"{ti},"' if ti else "", "Ph.D. dissertation",
                      _field(f, "school"), _field(f, "address"), yr)
    elif typ == "mastersthesis":
        body = joiner(au, f'"{ti},"' if ti else "", "Master's thesis",
                      _field(f, "school"), _field(f, "address"), yr)
    elif typ == "techreport":
        body = joiner(au, f'"{ti},"' if ti else "", _field(f, "institution"),
                      f"no. {num}" if num else "", yr)
    else:  # misc / online / unpublished / manual…
        body = joiner(au, f'"{ti},"' if ti else "",
                      _field(f, "howpublished", "note", "publisher"),
                      _field(f, "journal"), yr)
    if not body:
        body = _field(f, "title") or entry.get("key", "")
    return body.rstrip(", ") + "."


# ---------------------------------------------------------------- 主流程

def _sort_key(entry: dict) -> tuple:
    f = entry["fields"]
    return (f.get("author", "").lower(), f.get("year", ""), f.get("title", "").lower())


def expand_bibliography(text: str, base_dir: Path,
                        warnings: list[str]) -> str:
    """把 `\\bibliography{a,b}` 展开成 `\\begin{thebibliography}` 块。

    顺序按 `\\bibliographystyle` 走：unsrt/ieeetr → 引用顺序；
    plain/abbrv → 作者字母序。其他样式退回引用顺序并告警。
    """
    m = re.search(r"\\bibliography\s*\{([^}]*)\}", text)
    if not m:
        return text
    names = [n.strip() for n in m.group(1).split(",") if n.strip()]
    entries: dict[str, dict] = {}
    missing: list[str] = []
    for name in names:
        p = Path(name)
        cands = [base_dir / p, base_dir / (name + ".bib")]
        if not p.suffix:
            cands.append(base_dir / (name + ".bib"))
        path = next((c for c in cands if c.exists()), None)
        if path is None:
            missing.append(name)
            continue
        entries.update(parse_bib(path.read_text(encoding="utf-8", errors="replace")))
    if missing:
        warnings.append(f"找不到参考文献库 {', '.join(missing)}（.bib 路径要相对于主文件）")
        return text
    if not entries:
        warnings.append("参考文献库解析出 0 条记录，文献表会是空的")
        return text

    style_m = re.search(r"\\bibliographystyle\s*\{([^}]*)\}", text)
    style = (style_m.group(1).strip().lower() if style_m else "plain")

    # 引用顺序 = 正文里第一次出现的顺序（unsrt/ieeetr 的语义）
    order: list[str] = []
    for cm in CITE_RE.finditer(text):
        if cm.group(0).startswith(("\\nocite", "\\bibliography")):
            continue
        for k in cm.group(1).split(","):
            k = k.strip().lower()
            if k and k in entries and k not in order:
                order.append(k)
    if re.search(r"\\nocite\s*\{\s*\*\s*\}", text):
        order = list(entries) + [k for k in order if k not in entries]
    if style in ("plain", "abbrv"):
        order.sort(key=lambda k: _sort_key(entries[k]))
    elif style in ("alpha",):
        warnings.append("\\bibliographystyle{alpha} 的 [Smi20] 标签不支持，已退回数字编号")
        order.sort(key=lambda k: _sort_key(entries[k]))
    elif style not in ("unsrt", "ieeetr", "unsrtnat", "acm", "plainnat"):
        warnings.append(f"\\bibliographystyle{{{style}}} 未专门适配，按引用顺序编号（unsrt 规则）")

    uncited = [k for k in entries if k not in order]
    if uncited:
        warnings.append(f"{len(uncited)} 条 .bib 记录没被引用，未进文献表"
                        f"（要保留就在正文加 \\nocite{{key}}）")

    items = []
    for k in order:
        items.append(f"\\bibitem{{{entries[k]['key']}}} {format_entry(entries[k])}")
    block = ("\n\n\\begin{thebibliography}{99}\n" + "\n".join(items)
             + "\n\\end{thebibliography}\n\n")
    text = text[:m.start()] + block + text[m.end():]
    if style_m:
        text = text[:style_m.start()] + text[style_m.end():]
    return text
