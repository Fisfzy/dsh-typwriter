#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L2word-mathtype · 生成 pandoc 参考模板（reference.docx）。

为什么要这个文件：pandoc 的默认模板是 Calibri + 蓝色标题，投稿根本不能用；
把版式参数一次性写进 reference.docx，比事后逐个段落改格式可靠得多。

两种用法：
    1) 命令行给参数（默认值是一套通用学术版式：A4 / 10pt / 12pt 行距）
        python make_reference_docx.py -o ref.docx --size 10 --margins 3.27,6.45,4.76,4.04
    2) 由 learn_style.py 从论文自己的 PDF 里量出来，再调用这里的 build_reference()
       —— 这是"任意模板都能用"的关键，不要再把某本期刊的数值写死在代码里。
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

# 通用默认值：A4，正文 10pt，行距 12pt，版心约 16cm（IOP/Elsevier 常见量级）
DEFAULTS = {
    "font": "Times New Roman",
    "east": "SimSun",
    "size": 10.0,
    "line": 12.0,
    "paper": "a4",
    "margins": (2.54, 2.54, 2.5, 2.5),   # 上 下 左 右，cm
    "indent": 15.0,                       # 首行缩进 pt
    "heading_sizes": (12.0, 10.5, 10.0, 10.0),
    "caption_size": 9.0,
    "cjk": False,
}


def ensure(doc, name, base="Normal"):
    # 必须按「显示名」查找：python-docx 的 doc.styles["Body Text"] 会先按 style_id
    # 找，而 pandoc 模板里 Body Text 的 id 是 BodyText，按名字查不到就会新建一个
    # 重名样式，反而把 pandoc 的映射打乱。
    for st in doc.styles:
        if st.name == name:
            return st
    from docx.enum.style import WD_STYLE_TYPE
    names = {s.name for s in doc.styles}
    st = doc.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    if base in names:
        st.base_style = doc.styles[base]
    return st


def set_font(style, name, size=None, bold=None, italic=None, color=None, east=None):
    f = style.font
    f.name = name
    rpr = style.element.get_or_add_rPr()
    for tag in ("w:rFonts",):
        for old in rpr.findall(qn(tag)):
            rpr.remove(old)
    rf = OxmlElement("w:rFonts")
    for a in ("w:ascii", "w:hAnsi", "w:cs"):
        rf.set(qn(a), name)
    rf.set(qn("w:eastAsia"), east or name)
    rpr.insert(0, rf)
    if size is not None:
        f.size = Pt(size)
    if bold is not None:
        f.bold = bold
    if italic is not None:
        f.italic = italic
    if color is not None:
        from docx.shared import RGBColor
        f.color.rgb = RGBColor.from_string(color)


def set_par(style, *, align=None, first_indent=None, left=None, right=None,
            before=0, after=0, line=None, hang=None, keep_next=None):
    pf = style.paragraph_format
    if align is not None:
        pf.alignment = align
    if left is not None:
        pf.left_indent = left
    if right is not None:
        pf.right_indent = right
    if hang is not None:
        pf.first_line_indent = -hang
    elif first_indent is not None:
        pf.first_line_indent = first_indent
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    if line is not None:
        # 必须是「最小值」而不是「固定值」：固定行高会把行内公式（分式、积分）
        # 直接切掉或压到上一行上，Word 里表现为公式与正文重叠。
        pf.line_spacing_rule = WD_LINE_SPACING.AT_LEAST
        pf.line_spacing = Pt(line)
    if keep_next is not None:
        pf.keep_with_next = keep_next


def drop_borders(style):
    ppr = style.element.get_or_add_pPr()
    for old in ppr.findall(qn("w:pBdr")):
        ppr.remove(old)


def build_reference(out: Path, spec: dict | None = None) -> Path:
    """按 spec 生成 reference.docx。spec 缺的键用 DEFAULTS 补。"""
    s = dict(DEFAULTS)
    s.update({k: v for k, v in (spec or {}).items() if v is not None})
    out = Path(out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.stem + ".pandoc-base.docx")
    # 拿 pandoc 自带模板做底子，保证它期待的所有样式都存在
    r = subprocess.run(["pandoc", "-o", str(tmp), "--print-default-data-file",
                        "reference.docx"], capture_output=True)
    if r.returncode != 0 or not tmp.exists():
        raise RuntimeError("取 pandoc 默认模板失败："
                           + r.stderr.decode("utf-8", "replace")[:300])

    doc = Document(str(tmp))
    F, E, S, L = s["font"], s["east"], float(s["size"]), float(s["line"])
    small = float(s["caption_size"] or max(8.0, S - 1))

    # ---- 页面 ----
    top, bot, left, right = (float(x) for x in s["margins"])
    sec = doc.sections[0]
    if str(s["paper"]).lower() == "letter":
        sec.page_width, sec.page_height = Cm(21.59), Cm(27.94)
    elif isinstance(s["paper"], (tuple, list)):
        sec.page_width, sec.page_height = Cm(float(s["paper"][0])), Cm(float(s["paper"][1]))
    else:
        sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.top_margin, sec.bottom_margin = Cm(top), Cm(bot)
    sec.left_margin, sec.right_margin = Cm(left), Cm(right)
    sec.header_distance = Cm(max(1.2, top / 2))
    sec.footer_distance = Cm(max(1.2, bot / 2))

    # ---- 正文 ----
    normal = doc.styles["Normal"]
    set_font(normal, F, S, east=E)
    set_par(normal, align=WD_ALIGN_PARAGRAPH.JUSTIFY)
    # 关掉中英文自动间距，避免和 LaTeX 的字距感觉差太多
    ppr = normal.element.get_or_add_pPr()
    for old in ppr.findall(qn("w:autoSpaceDE")) + ppr.findall(qn("w:autoSpaceDN")):
        ppr.remove(old)

    body = ensure(doc, "Body Text")
    set_font(body, F, S, east=E)
    set_par(body, align=WD_ALIGN_PARAGRAPH.JUSTIFY, first_indent=Pt(float(s["indent"])),
            before=0, after=0, line=L)

    first = ensure(doc, "First Paragraph")
    set_font(first, F, S, east=E)
    set_par(first, align=WD_ALIGN_PARAGRAPH.JUSTIFY, first_indent=Pt(0),
            before=0, after=0, line=L)

    compact = ensure(doc, "Compact")
    set_font(compact, F, S, east=E)
    set_par(compact, align=WD_ALIGN_PARAGRAPH.LEFT, first_indent=Pt(0),
            before=0, after=0, line=L)

    # ---- 标题页 ----
    hs = list(s["heading_sizes"] or ())
    tsize = max([S + 2.0] + hs[:1])
    title = ensure(doc, "Title")
    set_font(title, F, tsize, bold=True, color="000000", east=E)
    set_par(title, align=WD_ALIGN_PARAGRAPH.CENTER, first_indent=Pt(0),
            before=14, after=12, line=tsize * 1.3)
    drop_borders(title)

    author = ensure(doc, "Author")
    set_font(author, F, S, color="000000", east=E)
    set_par(author, align=WD_ALIGN_PARAGRAPH.CENTER, first_indent=Pt(0),
            before=0, after=6, line=L)

    inst = ensure(doc, "Institute")
    set_font(inst, F, small, east=E)
    set_par(inst, align=WD_ALIGN_PARAGRAPH.CENTER, first_indent=Pt(0),
            before=0, after=2, line=small * 1.2)

    # ---- 摘要 / 关键词 ----
    for nm in ("Abstract",):
        st = ensure(doc, nm)
        set_font(st, F, small, east=E)
        set_par(st, align=WD_ALIGN_PARAGRAPH.JUSTIFY, first_indent=Pt(0),
                left=Cm(1.0), right=Cm(1.0), before=6, after=0, line=small * 1.2)
    kw = ensure(doc, "Keywords")
    set_font(kw, F, small, east=E)
    set_par(kw, align=WD_ALIGN_PARAGRAPH.LEFT, first_indent=Pt(0),
            left=Cm(1.0), right=Cm(1.0), before=4, after=8, line=small * 1.2)

    # ---- 章节标题：黑色、加粗、字号按模板实测值 ----
    for i, (before, after) in enumerate(((14, 7), (11, 5), (9, 4), (8, 3)), 1):
        sz = hs[i - 1] if i - 1 < len(hs) else S
        st = ensure(doc, f"Heading {i}")
        set_font(st, F, sz, bold=True, italic=False, color="000000", east=E)
        set_par(st, align=WD_ALIGN_PARAGRAPH.LEFT, first_indent=Pt(0),
                before=before, after=after, line=max(sz, S) * 1.2, keep_next=True)

    # 章节号与标题之间的距离：pandoc 在编号后面插一个 tab，默认会跳到 0.75cm
    # 之外，看起来像"1        正文"；这里按 LaTeX 的 ~0.5em 收窄
    from docx.enum.text import WD_TAB_ALIGNMENT
    for lvl, pos in ((1, Cm(0.62)), (2, Cm(0.86)), (3, Cm(1.10)), (4, Cm(1.34))):
        st = ensure(doc, f"Heading {lvl}")
        st.paragraph_format.tab_stops.add_tab_stop(pos, WD_TAB_ALIGNMENT.LEFT)

    # ---- 图表题注 ----
    for nm, al in (("Image Caption", WD_ALIGN_PARAGRAPH.JUSTIFY),
                   ("Table Caption", WD_ALIGN_PARAGRAPH.CENTER),
                   ("Caption", WD_ALIGN_PARAGRAPH.CENTER)):
        st = ensure(doc, nm)
        set_font(st, F, small, east=E)
        set_par(st, align=al, first_indent=Pt(0), before=4, after=6, line=small * 1.2)

    # ---- 参考文献 ----
    bib = ensure(doc, "Bibliography")
    set_font(bib, F, small, east=E)
    set_par(bib, align=WD_ALIGN_PARAGRAPH.JUSTIFY, left=Cm(0.55), hang=Cm(0.55),
            before=0, after=0, line=small * 1.2)

    # ---- 页眉 ----
    hdr = ensure(doc, "Header")
    set_font(hdr, F, small, east=E)
    set_par(hdr, align=WD_ALIGN_PARAGRAPH.LEFT, first_indent=Pt(0), before=0, after=0)

    doc.save(str(out))
    tmp.unlink(missing_ok=True)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="生成 pandoc reference.docx")
    ap.add_argument("-o", "--out", default="reference.docx")
    ap.add_argument("--font", default=DEFAULTS["font"])
    ap.add_argument("--east", default=DEFAULTS["east"], help="中文字体")
    ap.add_argument("--size", type=float, default=DEFAULTS["size"], help="正文字号 pt")
    ap.add_argument("--line", type=float, default=DEFAULTS["line"], help="行距 pt")
    ap.add_argument("--paper", default="a4", choices=["a4", "letter"])
    ap.add_argument("--margins", default="2.54,2.54,2.5,2.5", help="上,下,左,右（cm）")
    ap.add_argument("--indent", type=float, default=DEFAULTS["indent"], help="首行缩进 pt")
    ap.add_argument("--caption-size", type=float, default=DEFAULTS["caption_size"])
    ap.add_argument("--heading-sizes", default="12,10.5,10,10",
                    help="1-4 级标题字号，逗号分隔")
    args = ap.parse_args()

    spec = {
        "font": args.font, "east": args.east, "size": args.size, "line": args.line,
        "paper": args.paper,
        "margins": tuple(float(x) for x in args.margins.split(",")),
        "indent": args.indent, "caption_size": args.caption_size,
        "heading_sizes": [float(x) for x in args.heading_sizes.split(",")],
    }
    out = build_reference(Path(args.out), spec)
    print(f"已生成 {out}")
    print(f"  字体 {spec['font']} {spec['size']}pt / 行距 {spec['line']}pt"
          f" / 首行缩进 {spec['indent']}pt")
    print(f"  页面 {spec['paper']} / 边距 {spec['margins']} cm")
    return 0


if __name__ == "__main__":
    sys.exit(main())
