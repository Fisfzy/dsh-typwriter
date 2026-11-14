#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L2word-mathtype · S3 构建 docx：pandoc 出骨架，再回填公式为 LaTeX 纯文本。

关键设计：
    pandoc 只负责章节、段落、图表、参考文献这些"骨架"。
    公式从头到尾没有被 pandoc 看到，因此文档里不会出现任何 OMML。
    回填后的公式是字面量 $...$ / \\[...\\]，下一步交给 MathType 的 Toggle TeX。

    pandoc 不会给公式编号，编号由 prep_tex.py 事先算好，
    这里用 Word 的 SEQ 域写进去（可按 F9 重排），交叉引用用 REF 域。

用法:
    python build_docx.py build/prepared.tex -o build/base.docx \
        --equations build/equations.json [--reference-doc 模板.docx]
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import subprocess
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt
from docx.text.paragraph import Paragraph
from docx.text.run import Run

from tex_macros import split_long_display
from tex_struct import sec_prefix

TOKEN_RE = re.compile(r"MTX([dir])(\d{4})")
# S2.5 留下的题注编号标记：@@FG0003@@ / @@TB0002@@
CAPTION_RE = re.compile(r"@@(FG|TB)(\d{4})@@")
CAPTION_SEQ = {"FG": ("SEQ Figure \\* ARABIC", "_Fig"),
               "TB": ("SEQ Table \\* ARABIC", "_Tab")}

# 行间公式前后留白（pt）。LaTeX 10pt 正文下 \abovedisplayskip 与
# \belowdisplayskip 各约 10pt；pandoc 给的 MTDisplayEquation 只有段后 3pt，
# 照抄会让整篇比 PDF 短十几厘米（真实稿 153cm vs 168cm，页数直接少一页）。
DISPLAY_SPACE = 10


# ---------------------------------------------------------------- XML 小工具

def split_run(run: Run, offset: int) -> Run | None:
    """在 offset 处把 run 一分为二，返回右半部分。"""
    text = run.text
    if offset <= 0 or offset >= len(text):
        return None
    new_el = copy.deepcopy(run._r)
    run._r.addnext(new_el)
    new_run = Run(new_el, run._parent)
    new_run.text = text[offset:]
    run.text = text[:offset]
    return new_run


def rpr_of(run: Run):
    rpr = run._r.find(qn("w:rPr"))
    return copy.deepcopy(rpr) if rpr is not None else None


def make_run(text: str, rpr, *, size_halfpt: int | None = None):
    r = OxmlElement("w:r")
    if rpr is not None:
        r.append(copy.deepcopy(rpr))
    if size_halfpt:
        rp = r.find(qn("w:rPr"))
        if rp is None:
            rp = OxmlElement("w:rPr")
            r.insert(0, rp)
        for old in rp.findall(qn("w:sz")):
            rp.remove(old)
        sz = OxmlElement("w:sz")
        sz.set(qn("w:val"), str(size_halfpt))
        rp.append(sz)
    t = OxmlElement("w:t")
    t.set(qn("xml:space"), "preserve")
    t.text = text
    r.append(t)
    return r


def make_tab(rpr):
    r = OxmlElement("w:r")
    if rpr is not None:
        r.append(copy.deepcopy(rpr))
    r.append(OxmlElement("w:tab"))
    return r


def make_field(instr: str, placeholder: str, rpr):
    out = []
    for tag, body in (("begin", None), ("instr", instr), ("separate", None)):
        r = OxmlElement("w:r")
        if rpr is not None:
            r.append(copy.deepcopy(rpr))
        if tag == "instr":
            it = OxmlElement("w:instrText")
            it.set(qn("xml:space"), "preserve")
            it.text = f" {instr} "
            r.append(it)
        else:
            fc = OxmlElement("w:fldChar")
            fc.set(qn("w:fldCharType"), tag)
            r.append(fc)
        out.append(r)
    out.append(make_run(placeholder, rpr))
    r = OxmlElement("w:r")
    if rpr is not None:
        r.append(copy.deepcopy(rpr))
    fc = OxmlElement("w:fldChar")
    fc.set(qn("w:fldCharType"), "end")
    r.append(fc)
    out.append(r)
    return out


def make_bookmark(name: str, bm_id: int):
    s = OxmlElement("w:bookmarkStart")
    s.set(qn("w:id"), str(bm_id))
    s.set(qn("w:name"), name)
    e = OxmlElement("w:bookmarkEnd")
    e.set(qn("w:id"), str(bm_id))
    return s, e


# ---------------------------------------------------------------- 段落操作

def para_text(p) -> str:
    return "".join(r.text for r in p.runs)


def replace_span(p, a: int, b: int, elements) -> None:
    """把段落文本 [a,b) 换成给定 XML 元素，跨 run 也能处理。"""
    for boundary in (a, b):
        runs = p.runs
        pos = 0
        for r in runs:
            n = len(r.text)
            if pos < boundary < pos + n:
                split_run(r, boundary - pos)
                break
            pos += n

    runs = p.runs
    pos = 0
    target = []
    for r in runs:
        n = len(r.text)
        if n and pos >= a and pos + n <= b:
            target.append(r)
        pos += n
    if not target:
        anchor = None
        pos = 0
        for r in runs:
            if pos == a:
                anchor = r
                break
            pos += len(r.text)
        if anchor is None:
            return
        for el in elements:
            anchor._r.addprevious(el)
        return
    for el in elements:
        target[0]._r.addprevious(el)
    for r in target:
        r._r.getparent().remove(r._r)


def clear_content(p) -> None:
    for child in list(p._p):
        if child.tag != qn("w:pPr"):
            p._p.remove(child)


def set_display_tabs(p, width_twips: int) -> None:
    pPr = p._p.get_or_add_pPr()
    for old in pPr.findall(qn("w:tabs")):
        pPr.remove(old)
    tabs = OxmlElement("w:tabs")
    for kind, pos in (("center", width_twips // 2), ("right", width_twips)):
        tab = OxmlElement("w:tab")
        tab.set(qn("w:val"), kind)
        tab.set(qn("w:pos"), str(pos))
        tabs.append(tab)
    pPr.append(tabs)


# ---------------------------------------------------------------- 版式精修

STY_MARK_RE = re.compile(r"^@@STY:([A-Za-z]+)@@")


def ensure_style(doc, name: str):
    """按「显示名」拿样式；没有就基于 Normal 造一个，避免 KeyError。"""
    for st in doc.styles:
        if st.name == name:
            return st
    from docx.enum.style import WD_STYLE_TYPE
    st = doc.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    st.base_style = doc.styles["Normal"]
    return st


def apply_style_markers(doc) -> int:
    """S2.5 留下的 @@STY:样式名@@ 标记：删掉标记，段落套上同名样式。"""
    n = 0
    for p in doc.paragraphs:
        text = para_text(p)
        m = STY_MARK_RE.match(text)
        if not m:
            continue
        p.style = ensure_style(doc, m.group(1))
        replace_span(p, 0, m.end(), [])
        n += 1
    return n


def italic_lead(p, word: str) -> bool:
    """把段首的 word（如 "Proof."）设成斜体。"""
    text = para_text(p)
    if not text.startswith(word):
        return False
    pos = 0
    for r in p.runs:
        n = len(r.text)
        if pos >= len(word):
            break
        if pos + n > 0 and pos < len(word):
            r.italic = True
        pos += n
    return True


def style_bibliography(doc, headings=("References", "Bibliography", "参考文献")) -> int:
    """文献标题之后的所有段落套 Bibliography 样式（悬挂缩进 + 小字号）。

    headings 要带上目标语言的实际标题——只认 "References" 的话，中文稿的
    「参考文献」匹配不上，整段文献会静默拿不到样式（正文里看着像普通段落）。
    """
    st = ensure_style(doc, "Bibliography")
    started = False
    n = 0
    for p in doc.paragraphs:
        if not started:
            if para_text(p).strip() in headings:
                started = True
            continue
        if para_text(p).strip():
            p.style = st
            n += 1
    return n


def three_line_table(doc) -> int:
    """学术表格三线：顶线、表头下线、底线，无竖线。"""
    def set_borders(el_pr, spec):
        name = "w:tcBorders" if el_pr.tag == qn("w:tcPr") else "w:tblBorders"
        for old in el_pr.findall(qn(name)):
            el_pr.remove(old)
        bd = OxmlElement(name)
        for edge, sz in spec:
            e = OxmlElement("w:" + edge)
            e.set(qn("w:val"), "single" if sz else "nil")
            e.set(qn("w:sz"), str(sz))
            e.set(qn("w:color"), "000000")
            bd.append(e)
        el_pr.append(bd)

    n = 0
    for tbl in doc.tables:
        tblPr = tbl._tbl.tblPr
        # 整表去边框
        for old in tblPr.findall(qn("w:tblBorders")):
            tblPr.remove(old)
        bd = OxmlElement("w:tblBorders")
        for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
            e = OxmlElement("w:" + edge)
            e.set(qn("w:val"), "nil")
            bd.append(e)
        tblPr.append(bd)

        rows = tbl.rows
        if not rows:
            continue
        for ci, cell in enumerate(rows[0].cells):
            set_borders(cell._tc.get_or_add_tcPr(),
                        [("top", 8), ("bottom", 4), ("left", 0), ("right", 0)])
        if len(rows) > 1:
            for cell in rows[-1].cells:
                set_borders(cell._tc.get_or_add_tcPr(),
                            [("bottom", 8), ("top", 0), ("left", 0), ("right", 0)])
        # 底线别贴着字：末行单元格给一点下方留白；表格后面那段也留一点
        for row in rows[-1:]:
            for cell in row.cells:
                for p in cell.paragraphs:
                    p.paragraph_format.space_after = Pt(3)
        nxt = tbl._tbl.getnext()
        if nxt is not None and nxt.tag == qn("w:p"):
            nxt_p = Paragraph(nxt, tbl._parent)
            nxt_p.paragraph_format.space_before = Pt(9)
        n += 1
    return n


def add_running_head(doc, author: str, title: str | None = None,
                     width_twips: int | None = None) -> None:
    """页眉：页码 + 运行栏（首页不显示，与 LaTeX 的 \\thispagestyle{empty} 一致）。

    有短标题（`\\titlerunning` / `\\shorttitle` / `\\titlemark` 等）时按双面排，
    这是学术期刊的通行惯例：**偶数页印页次 + 作者名，奇数页印短标题 + 页次**。
    只给了作者、没有短标题时退化成"每页都印页码 + 作者名"。
    """
    sec = doc.sections[0]
    try:
        sec.different_first_page_header_footer = True
    except Exception:  # noqa: BLE001
        pass

    two_sided = bool(title)
    if two_sided:
        # python-docx 没有暴露这个开关，只能往 settings.xml 里塞 evenAndOddHeaders。
        # 不开它的话，even_page_header 写了也不会被 Word 用上。
        try:
            settings = doc.settings.element
            if settings.find(qn("w:evenAndOddHeaders")) is None:
                settings.append(OxmlElement("w:evenAndOddHeaders"))
        except Exception:  # noqa: BLE001
            two_sided = False

    def fill(header, tab_title: str | None) -> None:
        header.is_linked_to_previous = False
        p = header.paragraphs[0] if header.paragraphs else header.add_paragraph()
        clear_content(p)
        p.style = ensure_style(doc, "Header")
        if width_twips:
            # 不显式设制表位的话，Word 的 Header 样式默认位在不同模板下差别很大，
            # 页次会掉在中间（实测落在 11.1cm，而版心右边界是 19cm）。
            set_display_tabs(p, width_twips)
        rpr = None
        if tab_title:                     # 奇数页：短标题居中、页次靠右
            p._p.append(make_tab(rpr))
            p._p.append(make_run(tab_title, rpr))
            p._p.append(make_tab(rpr))    # 第二个制表位把页次推到右边距
        for el in make_field("PAGE", "1", rpr):
            p._p.append(el)
        if not tab_title:                 # 偶数页：页次靠左、作者名随后
            p._p.append(make_run("    " + author, rpr))

    fill(sec.header, title if two_sided else None)
    if two_sided:
        try:
            fill(sec.even_page_header, None)
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------- 题注编号

def fill_caption_numbers(doc, start_bm: int = 9000) -> dict:
    """把 @@FG0003@@ 换成「书签 + SEQ 域」，这样题注号也能随增删自动重排。"""
    done = {"fig": 0, "tab": 0, "bookmarks": {}}
    bm = start_bm
    for p_el in list(doc.element.body.iter(qn("w:p"))):
        p = Paragraph(p_el, doc)
        text = para_text(p)
        if "@@" not in text:
            continue
        for m in reversed(list(CAPTION_RE.finditer(text))):
            kind, num = m.group(1), m.group(2)
            instr, prefix = CAPTION_SEQ[kind]
            rpr = None
            pos = 0
            for r in p.runs:
                if pos <= m.start() < pos + len(r.text):
                    rpr = rpr_of(r)
                    break
                pos += len(r.text)
            name = prefix + str(int(num))
            bs, be = make_bookmark(name, bm)
            els = [bs] + make_field(instr, str(int(num)), rpr) + [be]
            replace_span(p, m.start(), m.end(), els)
            bm += 1
            done["bookmarks"][name] = int(num)
            done["fig" if kind == "FG" else "tab"] += 1
    # pandoc 还会把题注塞进表格/图形的辅助属性（无障碍朗读用），一并清掉标记
    for el in doc.element.body.iter(qn("w:tblCaption")):
        v = el.get(qn("w:val"))
        if v and "@@" in v:
            el.set(qn("w:val"), CAPTION_RE.sub(lambda m: str(int(m.group(2))), v))
    for el in doc.element.body.iter(qn("w:description")):
        v = el.get(qn("w:val"))
        if v and "@@" in v:
            el.set(qn("w:val"), CAPTION_RE.sub(lambda m: str(int(m.group(2))), v))
    return done


# ---------------------------------------------------------------- 回填

APX_MARK = "@@APX@@"
HEADING_STYLES = {"Heading 1", "Heading 2", "Heading 3", "Heading1", "Heading2", "Heading3"}


def fix_appendix(doc) -> int:
    """把 @@APX@@ 之后的章节号换成 A / A.1。

    章节号是 pandoc 用 --number-sections 自己印的（带 SectionNumber 字符样式的
    文本 run + 制表符），`\\appendix` 它不认，所以附录会接着编 3、4。
    这里在 pandoc 排完之后改那几个 run，纯文本替换，不动版式。
    """
    started = False
    sec = 0
    changed = 0
    for p in doc.paragraphs:
        if not started:
            if para_text(p).strip() == APX_MARK:
                started = True
                p._p.getparent().remove(p._p)
            continue
        num_run = None
        for r in p.runs:
            rp = r._r.find(qn("w:rPr"))
            if rp is None:
                continue
            rs = rp.find(qn("w:rStyle"))
            if rs is not None and rs.get(qn("w:val")) == "SectionNumber":
                num_run = r
                break
        if num_run is None:
            continue
        m = re.match(r"(\d+)(.*)", num_run.text)
        if not m:
            continue
        if p.style.name in ("Heading 1", "Heading1"):
            sec += 1
        if not sec:
            continue
        num_run.text = (sec_prefix(sec, True) + m.group(2))
        changed += 1
    return changed


def insert_toc(doc) -> int:
    """把 @@TOC@@ 段落换成 Word 的目录域。

    Word 的目录必须由 Word 自己排版（TOC 域 + 标题样式），所以这里只放域。
    """
    for p in doc.paragraphs:
        if para_text(p).strip() != "@@TOC@@":
            continue
        clear_content(p)
        for el in make_field('TOC \\o "1-3" \\h \\z \\u',
                             "（全选后按 F9 生成目录）", None):
            p._p.append(el)
        return 1
    return 0


def page_bookmark(ref: dict, eq_by_label: dict) -> str | None:
    """\\pageref 要指到的书签。只有公式和图表有我们自己的书签。

    章节的书签名是 pandoc 按 \\label 原样写的（可能带冒号），Word 的域不认，
    所以章节 \\pageref 退回字面号。
    """
    if ref.get("is_equation"):
        target = eq_by_label.get(ref.get("label"))
        return f"_Eq{target['id']}" if target else None
    kind = ref.get("kind")
    if ref.get("parent"):
        return ("_Fig" if kind == "figure" else "_Tab") + str(ref["parent"])
    if kind in ("figure", "table"):
        return ("_Fig" if kind == "figure" else "_Tab") + str(ref.get("number"))
    return None


def build(base_docx: Path, data: dict, out: Path, size_pt: float,
          plain_numbers: bool, default_a4: bool = False) -> dict:
    doc = Document(str(base_docx))
    eqs = {e["id"]: e for e in data["equations"]}
    eq_by_label = {e["label"]: e for e in data["equations"] if e.get("label")}
    refs = {r["id"]: r for r in data["refs"]}
    half = int(round(size_pt * 2))
    cap_names = (data.get("meta") or {}).get("caption_names") or {}
    doc_lang = (data.get("meta") or {}).get("lang")
    if doc_lang == "zh" or cap_names.get("figure") == "图":
        auto_word = {"figure": "图", "table": "表", "section": "节", "subsection": "节",
                     "subsubsection": "节", "appendix": "附录", "equation": "式"}
    else:
        auto_word = {"figure": "Figure", "table": "Table", "section": "Section",
                     "subsection": "Section", "subsubsection": "Section",
                     "appendix": "Appendix", "equation": "Equation"}

    sec = doc.sections[0]
    # 没给参考模板时，pandoc 生成的 docx 是 Letter + 1 英寸边距，国内投稿会错纸。
    # 这里统一成 A4 + 2.5cm，保证裸跑也是能交出去的样子。
    if default_a4:
        sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
        sec.top_margin, sec.bottom_margin = Cm(2.7), Cm(2.7)
        sec.left_margin, sec.right_margin = Cm(2.5), Cm(2.5)
    # pandoc 生成的 docx 常常不写页面尺寸，取 A4 + 1 英寸边距兜底
    page_w = sec.page_width.twips if sec.page_width else 11906
    left = sec.left_margin.twips if sec.left_margin else 1440
    right = sec.right_margin.twips if sec.right_margin else 1440
    width_twips = int(page_w - left - right)

    stats = {"display": 0, "inline": 0, "refs": 0, "numbered": 0,
             "unknown": [], "seen": set(), "split": []}
    bm_id = 900

    # 用 XML 遍历，这样表格单元格、文本框里的段落也能覆盖到
    for p_el in list(doc.element.body.iter(qn("w:p"))):
        p = Paragraph(p_el, doc)
        text = para_text(p)
        if "MTX" not in text:
            continue
        matches = list(TOKEN_RE.finditer(text))
        if not matches:
            continue

        # 整段只有一个行间公式 → 做成居中 + 右编号的公式段
        alone = (len(matches) == 1 and matches[0].group(1) == "d"
                 and text.strip() == matches[0].group(0))
        if alone:
            eq = eqs.get(int(matches[0].group(2)))
            if eq is None:
                stats["unknown"].append(matches[0].group(0))
                continue
            base_rpr = rpr_of(p.runs[0]) if p.runs else None
            # MathType 的 TeX 翻译器对单条公式有长度上限（实测 455 字过、525 字挂，
            # 挂了不报错、原文原样留下）。真实论文章节里一个 Equation 写六七行很常见，
            # 所以这里超长的先按换行拆成几段，每段各自转成一个对象。
            segs = split_long_display(eq["tex"])
            nodes = [p._p]
            for _ in segs[1:]:
                dup = copy.deepcopy(p._p)
                nodes[-1].addnext(dup)
                nodes.append(dup)
            n_seg = len(segs)
            for si, (node, seg) in enumerate(zip(nodes, segs)):
                pp = Paragraph(node, p._parent)
                is_last = si == n_seg - 1
                clear_content(pp)
                set_display_tabs(pp, width_twips)
                # 行间公式上下留白：pandoc 给的 MTDisplayEquation 样式只有"段后 3pt、
                # 段前 0"，比 LaTeX 紧一大截。LaTeX 在 10pt 正文下是
                # \abovedisplayskip / \belowdisplayskip 各 ~10pt，这里按 10pt 对齐，
                # 否则整篇会少掉十几厘米、硬生生少一页（真实稿实测 153cm vs 168cm）。
                # 拆开的段之间贴紧（0pt），视觉上仍是一个公式。
                pp.paragraph_format.space_before = Pt(DISPLAY_SPACE if si == 0 else 0)
                pp.paragraph_format.space_after = Pt(DISPLAY_SPACE if is_last else 0)
                body_run = make_run("\\[" + seg + "\\]", base_rpr, size_halfpt=half)
                if eq.get("number"):
                    pp._p.append(make_tab(base_rpr))
                    pp._p.append(body_run)
                    if is_last:
                        pp._p.append(make_tab(base_rpr))
                        pp._p.append(make_run("(", base_rpr))
                        # 书签必须只包住编号本身。包到括号外面的话 REF 域返回的是 "(7)"，
                        # 与正文里 LaTeX 自带的括号叠成 "((7))"。
                        if eq.get("label"):
                            bs, be = make_bookmark("_Eq" + str(eq["id"]), bm_id)
                            bm_id += 1
                            pp._p.append(bs)
                        if plain_numbers:
                            pp._p.append(make_run(eq["number"], base_rpr))
                        else:
                            for el in make_field("SEQ Equation \\* ARABIC", eq["number"], base_rpr):
                                pp._p.append(el)
                        if eq.get("label"):
                            pp._p.append(be)
                        pp._p.append(make_run(")", base_rpr))
                else:
                    pp._p.append(body_run)
                pp.alignment = None
            if eq.get("number"):
                stats["numbered"] += 1
            if n_seg > 1:
                stats["split"].append({"id": eq["id"], "segments": n_seg})
            stats["display"] += n_seg
            stats["seen"].add(eq["id"])
            continue

        # 其余情况：从右往左逐个替换，避免偏移失效
        for m in reversed(matches):
            kind, idx = m.group(1), int(m.group(2))
            a, b = m.start(), m.end()
            anchor_rpr = None
            pos = 0
            for r in p.runs:
                if pos <= a < pos + len(r.text):
                    anchor_rpr = rpr_of(r)
                    break
                pos += len(r.text)

            if kind == "d":
                eq = eqs.get(idx)
                if eq is None:
                    stats["unknown"].append(m.group(0))
                    continue
                els = [make_run("\\[" + eq["tex"] + "\\]", anchor_rpr, size_halfpt=half)]
                stats["display"] += 1
                stats["seen"].add(idx)
            elif kind == "i":
                eq = eqs.get(idx)
                if eq is None:
                    stats["unknown"].append(m.group(0))
                    continue
                els = [make_run("$" + eq["tex"] + "$", anchor_rpr, size_halfpt=half)]
                stats["inline"] += 1
                stats["seen"].add(idx)
            else:
                ref = refs.get(idx)
                if ref is None or ref.get("number") is None:
                    stats["unknown"].append(m.group(0))
                    els = [make_run("??", anchor_rpr)]
                else:
                    num = str(ref["number"])
                    kind = ref.get("kind") or ""
                    style = ref["style"]
                    parent = ref.get("parent")
                    suffix = ref.get("suffix") or ""
                    # \autoref/\cref 要自带类别词，\ref 只给数字
                    lead = ""
                    if style in ("autoref", "cref", "Cref"):
                        lead = auto_word.get(kind, "")
                        if lead:
                            lead += " "
                    if style == "pageref" and not plain_numbers:
                        # \pageref 变成 PAGEREF 域：公式/图表有我们自己的书签，能给页码。
                        # 章节引用退回字面号（pandoc 写的书签名带冒号，Word 的域不认）。
                        bm = page_bookmark(ref, eq_by_label)
                        els = (make_field(f"PAGEREF {bm} \\h", num, anchor_rpr) if bm
                               else [make_run(num, anchor_rpr)])
                        stats["refs"] += 1
                    elif ref.get("is_equation") and not plain_numbers:
                        target = eq_by_label.get(ref["label"])
                        if target is None:
                            els = [make_run(lead + num, anchor_rpr)]
                        else:
                            inner = make_field(f"REF _Eq{target['id']} \\h",
                                               num, anchor_rpr)
                            if ref["style"] == "eqref":
                                els = ([make_run("(", anchor_rpr)] + inner
                                       + [make_run(")", anchor_rpr)])
                            else:
                                els = (([make_run(lead, anchor_rpr)] if lead else [])
                                       + inner)
                        stats["refs"] += 1
                    elif kind in ("figure", "table") and not plain_numbers:
                        # 图表题注号是 SEQ 域，引用用 REF 指到题注上的书签。
                        # 子图引用 = REF 主图号 + 字面字母（"1a"），主图重排时数字会跟着走。
                        base = parent or num
                        bm_name = ("_Fig" if kind == "figure" else "_Tab") + base
                        els = ([make_run(lead, anchor_rpr)] if lead else []) + \
                            make_field(f"REF {bm_name} \\h", base, anchor_rpr)
                        if suffix:
                            els = els + [make_run(suffix, anchor_rpr)]
                        stats["refs"] += 1
                    else:
                        els = [make_run(lead + num, anchor_rpr)]
                        stats["refs"] += 1
            replace_span(p, a, b, els)

    cap_stats = fill_caption_numbers(doc)
    stats["captions"] = cap_stats["fig"] + cap_stats["tab"]
    stats["caption_bookmarks"] = cap_stats["bookmarks"]
    stats["toc"] = insert_toc(doc)
    stats["appendix_headings"] = fix_appendix(doc)

    out.parent.mkdir(parents=True, exist_ok=True)
    stats["styled"] = apply_style_markers(doc)
    stats["proofs"] = sum(1 for p in doc.paragraphs if italic_lead(p, "Proof."))

    meta = data.get("meta") or {}
    headings = {"References", "Bibliography", "参考文献"}
    if meta.get("bib_title"):
        headings.add(str(meta["bib_title"]))
    stats["bib_items"] = style_bibliography(doc, tuple(headings))

    stats["tables"] = three_line_table(doc)
    rh = meta.get("running_head")
    if rh and not meta.get("no_running_head"):
        add_running_head(doc, rh, meta.get("title_running"), width_twips)
        stats["running_head"] = rh
    doc.save(str(out))
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description="pandoc 生成骨架并回填公式")
    ap.add_argument("prepared_tex")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--equations", required=True)
    ap.add_argument("--reference-doc")
    ap.add_argument("--size", type=float, default=10.5, help="公式字号(pt)")
    ap.add_argument("--no-number-sections", action="store_true")
    ap.add_argument("--plain-numbers", action="store_true",
                    help="编号写成死文本，不用 SEQ 域")
    ap.add_argument("--keep-base", action="store_true")
    args = ap.parse_args()

    src = Path(args.prepared_tex).resolve()
    out = Path(args.out).resolve()
    eq_path = Path(args.equations).resolve()
    if not src.exists():
        print(f"不存在: {src}")
        return 1
    data = json.loads(eq_path.read_text(encoding="utf-8"))

    base = out.with_name(out.stem + ".pandoc.docx")
    cmd = ["pandoc", str(src), "-f", "latex", "-t", "docx", "-o", str(base)]
    if not args.no_number_sections:
        cmd.append("--number-sections")
    if args.reference_doc:
        cmd += ["--reference-doc", str(Path(args.reference_doc).resolve())]
    print("pandoc:", " ".join(cmd[1:]))
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(f"pandoc 失败:\n{r.stderr[:2000]}")
        return 2
    if r.stderr.strip():
        warn = r.stderr.strip().splitlines()
        print(f"pandoc 警告 {len(warn)} 条，前 3 条：")
        for line in warn[:3]:
            print("  ", line[:160])

    stats = build(base, data, out, args.size, args.plain_numbers,
                  default_a4=(args.reference_doc is None))
    if not args.keep_base:
        base.unlink(missing_ok=True)

    # 清单：哪些公式真的进了文档，哪些被 pandoc 丢掉了（通常落在算法/自定义环境里）
    all_ids = {e["id"] for e in data["equations"]}
    unplaced = sorted(all_ids - stats["seen"])
    manifest = {
        "docx": str(out),
        "display": stats["display"],
        "inline": stats["inline"],
        "refs": stats["refs"],
        "numbered": stats["numbered"],
        "captions": stats.get("captions", 0),
        # display 记的是**实际填进去的段数**（超长公式被拆成多段），
        # placed_total 用它算，S5 的 --expect 才对得上 MathType 对象数
        "placed_total": stats["display"] + stats["inline"],
        "split": stats.get("split", []),
        # 给 S5 的内容对账用：题注/文献的"应该有多少"，与产物里实际数出来的比
        "captions_expected": len((data.get("meta") or {}).get("captions") or {}),
        "bib_expected": int((data.get("meta") or {}).get("bib_count") or 0),
        "refs_unresolved": len(stats["unknown"]),
        "toc": stats.get("toc", 0),
        "appendix_headings": stats.get("appendix_headings", 0),
        "unplaced": [{"id": e["id"], "env": e["env"], "line": e["line"],
                      "tex": e["tex"][:80]}
                     for e in data["equations"] if e["id"] in set(unplaced)],
    }
    (out.with_name("filled.json")).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"回填完成：行间 {stats['display']}、行内 {stats['inline']}、"
          f"引用 {stats['refs']}、编号 {stats['numbered']}、图表题注 {stats.get('captions', 0)}")
    if stats["unknown"]:
        print(f"未解析占位符 {len(stats['unknown'])} 个：{stats['unknown'][:8]}")
    if unplaced:
        lines = sorted({e["line"] for e in data["equations"] if e["id"] in set(unplaced)})
        print(f"有 {len(unplaced)} 个公式没进文档（原文第 {lines[:6]} 行附近，"
              f"多半在 pandoc 不支持的环境里）")
    print(f"→ {out}")
    return 0 if not stats["unknown"] else 3


if __name__ == "__main__":
    sys.exit(main())
