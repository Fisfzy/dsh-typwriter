#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L2word-mathtype · S2 预处理：把 LaTeX 公式抽成占位符，正文交给 pandoc。

为什么需要这一步：
    pandoc 读 LaTeX 时会把 $...$ 变成 OMML 写进 docx，而 OMML 是我们要
    彻底避开的（转完无法回退、格式受 Word 公式编辑器支配）。
    所以在 pandoc 之前就把公式整段抽走，用纯文本占位符顶上；
    pandoc 只处理正文骨架，永远见不到公式，也就永远不会生成 OMML。

产物：
    prepared.tex     公式已被占位符替换，可直接喂给 pandoc
    equations.json   每个占位符的 LaTeX 原文、编号、标签、行号

占位符形如 MTXd0007（行间）/ MTXi0012（行内）/ MTXr0003（引用），
纯字母数字，既能穿过 pandoc 的 LaTeX 解析，也不会被当成链接或引用语法。

用法:
    python prep_tex.py paper.tex -o build/
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from tex_macros import collect_macros_with_files, prepare_math, find_unsupported  # noqa: E402
from tex_struct import (restructure, THEOREM_ENVS, TheoremNumbering,  # noqa: E402
                        parse_newtheorems, sec_prefix)
from bibtex import expand_bibliography  # noqa: E402

NUMBERED_ENVS = {"equation", "align", "gather", "multline", "eqnarray",
                 "alignat", "flalign"}
STARRED = {name + "*" for name in NUMBERED_ENVS}
DISPLAY_ENVS = NUMBERED_ENVS | STARRED | {"displaymath", "math"}
MULTIROW_ENVS = {e for e in (NUMBERED_ENVS | STARRED)
                 if not e.startswith(("multline", "equation"))}
VERBATIM_ENVS = {"verbatim", "Verbatim", "lstlisting", "minted", "alltt", "comment"}

TOK_DISPLAY = "MTXd{:04d}"
TOK_INLINE = "MTXi{:04d}"
TOK_REF = "MTXr{:04d}"


# ---------------------------------------------------------------- 文本工具

def strip_comments(text: str) -> str:
    out: list[str] = []
    i, n = 0, len(text)
    in_verb: str | None = None
    while i < n:
        if in_verb:
            tag = f"\\end{{{in_verb}}}"
            if text.startswith(tag, i):
                out.append(tag)
                i += len(tag)
                in_verb = None
                continue
            out.append(text[i])
            i += 1
            continue
        if text.startswith("\\begin{", i):
            m = re.match(r"\\begin\{([A-Za-z*]+)\}", text[i:])
            if m and m.group(1) in VERBATIM_ENVS:
                in_verb = m.group(1)
                out.append(m.group(0))
                i += len(m.group(0))
                continue
        if text[i] == "%" and (i == 0 or text[i - 1] != "\\"):
            while i < n and text[i] != "\n":
                i += 1
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def match_brace(s: str, i: int) -> int:
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


def find_env_end(s: str, i: int, name: str) -> int:
    pat = re.compile(r"\\(begin|end)\{" + re.escape(name) + r"\}")
    depth = 0
    for m in pat.finditer(s, i):
        depth += 1 if m.group(1) == "begin" else -1
        if depth == 0:
            return m.end()
    return -1


def split_rows(body: str) -> list[str]:
    rows: list[str] = []
    buf: list[str] = []
    depth = 0
    i = 0
    while i < len(body):
        if body.startswith("\\\\", i):
            if depth == 0:
                rest = body[i + 2:]
                m = re.match(r"\s*\[[^\]]*\]", rest)
                i += 2 + (m.end() if m else 0)
                rows.append("".join(buf).strip())
                buf = []
                continue
            buf.append("\\\\")
            i += 2
            continue
        c = body[i]
        if c == "\\":
            buf.append(body[i:i + 2])
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        buf.append(c)
        i += 1
    rows.append("".join(buf).strip())
    return [r for r in rows if r]


def take_label(body: str) -> tuple[str, list[str]]:
    labels = re.findall(r"\\label\{([^}]*)\}", body)
    return re.sub(r"\\label\{[^}]*\}", "", body).strip(), labels


# ---------------------------------------------------------------- 数据结构

@dataclass
class Eq:
    id: int
    kind: str
    env: str
    tex: str
    number: str | None = None
    label: str | None = None
    row: int = 0
    rows: int = 1
    line: int = 0


@dataclass
class Ref:
    id: int
    label: str
    style: str
    line: int


@dataclass
class Doc:
    equations: list[Eq] = field(default_factory=list)
    refs: list[Ref] = field(default_factory=list)
    numbers: dict[str, str] = field(default_factory=dict)
    kinds: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- 编号推演

LABEL_RE = re.compile(r"[ \t\r\n]*\\label\s*\{([^}]*)\}")


def labels_after(s: str, pos: int) -> list[str]:
    """标题命令之后紧跟的 \\label。

    LaTeX 里 99% 的写法是 `\\section{Title}\\label{sec:x}`，甚至换个行再写。
    旧实现只在 `\\section{...}` 的花括号里找 `\\label`，于是所有正常写法都注册不上，
    正文里的 `\\ref` 全变成 `??`（探针里三个章节引用全废）。这里把花括号后面
    连续出现的 `\\label` 也收进来。
    """
    out: list[str] = []
    i = pos
    while True:
        m = LABEL_RE.match(s, i)
        if not m:
            return out
        label = m.group(1).strip()
        if label:
            out.append(label)
        i = m.end()


def scan_structure(text: str, thm_decls: dict | None = None
                   ) -> dict[str, tuple[str, str]]:
    """按文档顺序推演编号，建立 label → (编号, 类别)。

    类别（kind）用于 S3 决定交叉引用怎么渲染：公式用 REF 域指书签，
    图表要先知道自己是 figure 还是 table 才能补 "Figure"/"Table" 前缀，
    附录章节要给 "Appendix"（中文模板给"附录"）。

    图表编号不在这里算 —— 题注编号的唯一来源是 tex_struct.number_captions()，
    它和 S3 写进 Word 的 SEQ 域是同一套计数。这里再算一遍只会漂移
    （子图、longtable 就是这么对不上的）。
    """
    labels: dict[str, tuple[str, str]] = {}
    sec = sub = subsub = 0
    appendix = False
    thm_num = TheoremNumbering(thm_decls or {}, THEOREM_ENVS)
    # 内置常见名 ∪ 导言区 \newtheorem 声明的名字（自定义定理环境也得算）
    thm_names = "|".join(sorted(set(THEOREM_ENVS) | set(thm_decls or {}),
                                key=len, reverse=True))
    i = 0
    while i < len(text):
        matched = False
        if text.startswith("\\appendix", i) and not re.match(r"\\appendix[A-Za-z]", text[i:]):
            appendix = True
            sec = sub = subsub = 0
            thm_num.set_appendix(True)
            i += len("\\appendix")
            continue
        m = re.match(r"\\begin\{(" + thm_names + r")(\*?)\}", text[i:])
        if m:
            env, star = m.group(1), m.group(2)
            end = find_env_end(text, i, env + star)
            block = text[i:end] if end > 0 else ""
            lab = re.search(r"\\label\{([^}]*)\}", block)
            if not star:
                num = thm_num.next(env)
                if lab:
                    labels[lab.group(1)] = (num, env)
            i = end if end > 0 else i + 1
            continue
        for cmd, depth in (("section", 0), ("subsection", 1), ("subsubsection", 2)):
            m = re.match(r"\\" + cmd + r"\*?\s*\{", text[i:])
            if not m:
                continue
            starred = text[i + len(cmd) + 1:i + len(cmd) + 2] == "*"
            brace = i + m.end() - 1
            end = match_brace(text, brace)
            if end < 0:
                break
            body = text[brace + 1:end]
            # 星号标题不推进计数器（LaTeX 语义）：后面的小节仍挂在上一节下
            prefix = sec_prefix(sec, appendix)
            if not starred:
                if depth == 0:
                    sec += 1
                    sub = subsub = 0
                    thm_num.set_section(sec)
                    prefix = sec_prefix(sec, appendix)
                    num = prefix
                elif depth == 1:
                    sub += 1
                    subsub = 0
                    num = f"{prefix}.{sub}"
                else:
                    subsub += 1
                    num = f"{prefix}.{sub}.{subsub}"
                # 两种合法写法都要收：`\section{标题\label{x}}` 与
                # `\section{标题}\label{x}`（后者才是主流，旧版全漏）
                for lab in (re.findall(r"\\label\{([^}]*)\}", body)
                            + labels_after(text, end + 1)):
                    lab = lab.strip()
                    if not lab:
                        continue
                    kind = "appendix" if (appendix and depth == 0) else cmd
                    labels[lab] = (num, kind)
            i = end + 1
            matched = True
            break
        if matched:
            continue
        i += 1
    return labels


# ---------------------------------------------------------------- 主提取器

class Extractor:
    def __init__(self, doc: Doc, numberwithin: bool,
                 macros: dict[str, tuple[int, str]] | None = None):
        self.doc = doc
        self.numberwithin = numberwithin
        self.macros = macros or {}
        self.eq_id = 0
        self.eq_counter = 0
        self.sec = 0
        self.appendix = False

    def compound(self) -> str:
        self.eq_counter += 1
        if not self.numberwithin:
            return str(self.eq_counter)
        # \numberwithin{equation}{section} 的真实语义是"按节编号 + 每节清零"。
        # 旧实现只拼前缀不清零，于是 1.4 后面接着 2.5 而不是 2.1。
        return f"{sec_prefix(self.sec, self.appendix)}.{self.eq_counter}"

    def add(self, kind: str, env: str, tex: str, number: str | None,
            label: str | None, line: int, row: int = 0, rows: int = 1) -> str:
        self.eq_id += 1
        # \tag{n} 是作者手写的编号，优先于计数器
        m = re.search(r"\\tag\*?\{([^}]*)\}", tex)
        if m:
            number = m.group(1).strip()
            tex = re.sub(r"\\tag\*?\{[^}]*\}", "", tex)
        self.doc.equations.append(
            Eq(self.eq_id, kind, env, prepare_math(tex, self.macros).strip(),
               number, label, row, rows, line))
        return (TOK_DISPLAY if kind == "display" else TOK_INLINE).format(self.eq_id)

    def run(self, text: str) -> str:
        out: list[str] = []
        i, n = 0, len(text)

        def line_of(pos: int) -> int:
            return text.count("\n", 0, pos) + 1

        while i < n:
            # verbatim 整体保留
            if text.startswith("\\begin{", i):
                m = re.match(r"\\begin\{([A-Za-z*]+)\}", text[i:])
                if m and m.group(1) in VERBATIM_ENVS:
                    end = find_env_end(text, i, m.group(1))
                    end = end if end > 0 else n
                    out.append(text[i:end])
                    i = end
                    continue
                if m and m.group(1) in DISPLAY_ENVS:
                    name = m.group(1)
                    end = find_env_end(text, i, name)
                    if end < 0:
                        self.doc.warnings.append(f"第 {line_of(i)} 行 {name} 没有配对")
                        out.append(text[i])
                        i += 1
                        continue
                    body_start = i + len(m.group(0))
                    body_end = text.rfind("\\end", body_start, end)
                    body, labels = take_label(text[body_start:body_end])
                    label = labels[0] if labels else None
                    numbered = name in NUMBERED_ENVS
                    ln = line_of(i)
                    if name in MULTIROW_ENVS:
                        rows = split_rows(body)
                        toks = []
                        for r_i, row in enumerate(rows, 1):
                            skip = bool(re.search(r"\\(nonumber|notag)\b", row))
                            clean = re.sub(r"\\(nonumber|notag)\b", "", row)
                            clean = re.sub(r"(?<!\\)&", " ", clean).strip()
                            num = None if (skip or not numbered) else self.compound()
                            toks.append(self.add("display", name, clean, num,
                                                 label if r_i == 1 else None,
                                                 ln, row=r_i, rows=len(rows)))
                        out.append("\n\n" + "\n\n".join(toks) + "\n\n")
                    elif name.startswith("multline"):
                        rows = split_rows(body)
                        merged = "\\begin{aligned}" + " \\\\ ".join(rows) + "\\end{aligned}"
                        num = None if not numbered else self.compound()
                        out.append("\n\n" + self.add("display", name, merged, num, label, ln,
                                                    rows=len(rows)) + "\n\n")
                    else:  # equation / displaymath / 星号
                        num = None if (not numbered or name.endswith("*")) else self.compound()
                        out.append("\n\n" + self.add("display", name, body, num, label, ln) + "\n\n")
                    i = end
                    continue
                if (text.startswith("\\appendix", i)
                        and not re.match(r"\\appendix[A-Za-z]", text[i:])):
                    self.appendix = True
                    self.sec = 0
                    if self.numberwithin:
                        self.eq_counter = 0
                    out.append(text[i:i + len("\\appendix")])
                    i += len("\\appendix")
                    continue
                if re.match(r"\\section(?![a-zA-Z])", text[i:]) and not text.startswith("\\section*", i):
                    self.sec += 1
                    if self.numberwithin:
                        self.eq_counter = 0
                out.append(text[i:i + 2])
                i += 2
                continue

            m = re.match(r"\\(eqref|ref|autoref|cref|Cref|pageref)\{([^}]*)\}", text[i:])
            if m:
                style, body = m.group(1), m.group(2)
                # \cref{a,b} 是多目标引用，要拆成多个引用再拼回去
                keys = ([k.strip() for k in body.split(",") if k.strip()]
                        if style in ("cref", "Cref") else [body])
                toks = []
                for key in keys:
                    self.doc.refs.append(Ref(len(self.doc.refs) + 1, key, style, line_of(i)))
                    toks.append(TOK_REF.format(self.doc.refs[-1].id))
                out.append(", ".join(toks))
                i += m.end()
                continue

            if text.startswith("\\[", i) and not (i > 0 and text[i - 1] == "\\"):
                end = text.find("\\]", i + 2)
                if end < 0:
                    self.doc.warnings.append(f"第 {line_of(i)} 行 \\[ 没有配对")
                    out.append(text[i:i + 2])
                    i += 2
                    continue
                body, labels = take_label(text[i + 2:end])
                out.append("\n\n" + self.add("display", "bracket", body, None,
                                             labels[0] if labels else None,
                                             line_of(i)) + "\n\n")
                i = end + 2
                continue

            if text.startswith("\\(", i):
                end = text.find("\\)", i + 2)
                if end < 0:
                    out.append(text[i:i + 2])
                    i += 2
                    continue
                body, _ = take_label(text[i + 2:end])
                out.append(self.add("inline", "paren", body, None, None, line_of(i)))
                i = end + 2
                continue

            if text.startswith("$$", i):
                end = text.find("$$", i + 2)
                if end < 0:
                    out.append(text[i:i + 2])
                    i += 2
                    continue
                body, labels = take_label(text[i + 2:end])
                out.append("\n\n" + self.add("display", "dollar2", body, None,
                                             labels[0] if labels else None,
                                             line_of(i)) + "\n\n")
                i = end + 2
                continue

            if text[i] == "$":
                end = i + 1
                while end < n:
                    if text[end] == "\\":
                        end += 2
                        continue
                    if text[end] == "$":
                        break
                    end += 1
                if end >= n:
                    out.append("$")
                    i += 1
                    continue
                body, _ = take_label(text[i + 1:end])
                out.append(self.add("inline", "dollar", body, None, None, line_of(i)))
                i = end + 1
                continue

            out.append(text[i])
            i += 1

        return "".join(out)


# ---------------------------------------------------------------- 入口

def tex_escape(s: str) -> str:
    """把纯文本转成能在 LaTeX 里安全输出的形式（用于 \\verb 的降级）。"""
    table = {"\\": r"\textbackslash{}", "{": r"\{", "}": r"\}", "_": r"\_",
             "%": r"\%", "&": r"\&", "#": r"\#", "$": r"\$",
             "^": r"\^{}", "~": r"\~{}"}
    return "".join(table.get(ch, ch) for ch in s)


def demote_verb(text: str) -> str:
    """pandoc 不认识 \\verb，降级成 \\texttt{}（等宽样式在 Word 里本来就留不住）。"""
    return re.sub(r"\\verb\*?([^A-Za-z\s])(.*?)\1",
                  lambda m: "\\texttt{" + tex_escape(m.group(2)) + "}",
                  text, flags=re.S)


def inline_inputs(text: str, base: Path, depth: int = 0) -> str:
    if depth > 6:
        return text

    def repl(m):
        name = m.group(2).strip()
        p = base / (name if name.endswith(".tex") else name + ".tex")
        if not p.exists():
            return m.group(0)
        return inline_inputs(p.read_text(encoding="utf-8", errors="replace"), p.parent, depth + 1)

    return re.sub(r"\\(input|include)\{([^}]*)\}", repl, text)


def main() -> int:
    ap = argparse.ArgumentParser(description="抽出公式，生成 prepared.tex")
    ap.add_argument("tex")
    ap.add_argument("-o", "--out-dir", default="build")
    args = ap.parse_args()

    src = Path(args.tex).resolve()
    if not src.exists():
        print(f"文件不存在: {src}")
        return 1
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    raw = src.read_text(encoding="utf-8", errors="replace")
    text = strip_comments(inline_inputs(raw, src.parent))
    # pandoc 不认识 \verb，先降级成 \texttt{转义文本}
    text = demote_verb(text)
    numberwithin = bool(re.search(
        r"\\(numberwithin|counterwithin)\s*\{equation\}\s*\{section\}", text))

    doc = Doc()
    # bibtex：`.bib` 必须在抽公式之前展开，这样文献条目里的 $...$ 也能照常被抽走
    text = expand_bibliography(text, src.parent, doc.warnings)
    thm_decls = parse_newtheorems(text)
    for lab, (num, kind) in scan_structure(text, thm_decls).items():
        doc.numbers[lab] = num
        doc.kinds[lab] = kind
    macros, macro_files = collect_macros_with_files(text, src.parent)
    if macros:
        src_note = f"，来自 {', '.join(macro_files[:3])}" if macro_files else ""
        print(f"自定义宏 {len(macros)} 个{src_note}："
              + ", ".join(sorted(macros)[:6]))
    ex = Extractor(doc, numberwithin, macros)
    prepared = ex.run(text)

    # S2.5 结构重写：把 pandoc 读不懂的定理环境/引用/题注/标题页补回去
    meta: dict = {}
    prepared = restructure(prepared, meta, doc.warnings, macros)
    # 图表编号以 S2.5 的结果为准：它和 S3 写进 Word 的 SEQ 域是同一套计数，
    # 用 scan_structure 的值容易和题注实际显示的数字对不上。
    for lab, (num, kind) in (meta.get("captions") or {}).items():
        doc.numbers[lab] = num
        doc.kinds[lab] = kind
    # 子图：号是 "1a" 这种复合号，引用时得拆开——主图号走 REF 域（能跟着重排），
    # 子图字母只能是字面量（Word 没有"每图重置"的字母计数器）。
    sub_caps = meta.get("sub_captions") or {}
    for lab, info in sub_caps.items():
        parent, letter = info[0], info[1]
        kind = info[2] if len(info) > 2 else "figure"
        doc.numbers[lab] = parent + letter
        doc.kinds[lab] = kind

    # 公式里还残留 MathType 不认识的宏 → MathType 会把它们当普通文字印出来，
    # 且 S4 会照常报"成功"。必须在这里就拦住。
    for e in doc.equations:
        bad = find_unsupported(e.tex)
        if bad:
            doc.warnings.append(
                f"公式 #{e.id}（原文第 {e.line} 行）含 MathType 不认识的宏 "
                f"{', '.join(bad)}，转出来会是字面文本：{e.tex[:60]}")

    # 引用解析
    eq_by_label = {e.label: e for e in doc.equations if e.label}
    refs_out = []
    for r in doc.refs:
        target = eq_by_label.get(r.label)
        number = target.number if target and target.number else doc.numbers.get(r.label)
        if number is None and target is None:
            doc.warnings.append(f"引用 {r.label} 找不到对应编号（第 {r.line} 行）")
        sub = sub_caps.get(r.label)
        refs_out.append({"id": r.id, "token": TOK_REF.format(r.id), "label": r.label,
                         "style": r.style, "number": number,
                         "kind": ("equation" if target else doc.kinds.get(r.label)),
                         "is_equation": bool(target), "line": r.line,
                         "parent": sub[0] if sub else None,
                         "suffix": sub[1] if sub else None})

    (out_dir / "prepared.tex").write_text(prepared, encoding="utf-8")
    payload = {
        "source": str(src),
        "number_within_section": numberwithin,
        "equations": [e.__dict__ for e in doc.equations],
        "refs": refs_out,
        "label_numbers": doc.numbers,
        "label_kinds": doc.kinds,
        "meta": meta,
        "warnings": doc.warnings,
    }
    (out_dir / "equations.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    display = sum(1 for e in doc.equations if e.kind == "display")
    inline = len(doc.equations) - display
    numbered = sum(1 for e in doc.equations if e.number)
    print(f"公式 {len(doc.equations)} 个（行间 {display} / 行内 {inline}，"
          f"带编号 {numbered}）")
    print(f"引用 {len(doc.refs)} 处，标签 {len(doc.numbers)} 个")
    for w in doc.warnings[:10]:
        print(f"  ! {w}")
    print(f"→ {out_dir/'prepared.tex'}")
    print(f"→ {out_dir/'equations.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
