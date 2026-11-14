#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L2word-mathtype · 从论文自身推断版式，生成 reference.docx。

为什么需要它：
    以前 make_reference_docx.py 里的边距、字号、行距是从某一本期刊的 PDF 上
    手抄下来的，换一个模板就全废。要做到"任意 LaTeX 模板都能用"，版式就必须
    从输入本身推出来，而不是写死。

三级回退（能拿到哪一级用哪一级）：
    1. 有 PDF（--pdf 指定，或用 xelatex/pdflatex 现场编译）→ 直接量版面
       —— 最可靠，量到的就是模板自己的样子
    2. 没有 LaTeX 工具链 → 解析 .cls / .sty / 导言区的 geometry 参数
       —— 覆盖绝大多数正规模板
    3. 都没有 → 一套通用学术默认值（A4 / 10pt / 12pt 行距）

用法:
    python learn_style.py paper.tex -o ref.docx
    python learn_style.py paper.tex -o ref.docx --pdf 官方样例.pdf
    python learn_style.py paper.tex -o ref.docx --no-compile   # 只解析类文件
"""
from __future__ import annotations

import argparse
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_reference_docx import DEFAULTS, build_reference  # noqa: E402

CJK_RE = re.compile(r"[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]")

# PDF 里的字体名 → 本机可用的近似字体。LaTeX 常用 Latin Modern / Nimbus，
# Windows 上没有，取度量最接近的衬线体，否则排版会明显变形。
FONT_MAP = [
    ("minion", "Times New Roman"),
    ("nimbusrom", "Times New Roman"),
    ("nimbus roman", "Times New Roman"),
    ("times", "Times New Roman"),
    ("texgyretermes", "Times New Roman"),
    ("termes", "Times New Roman"),
    ("sfrm", "Times New Roman"),      # Computer Modern Roman
    ("cmr", "Times New Roman"),
    ("lmroman", "Times New Roman"),
    ("latinmodern", "Times New Roman"),
    ("roman", "Times New Roman"),
    ("palatino", "Palatino Linotype"),
    ("pagella", "Palatino Linotype"),
    ("pplr", "Palatino Linotype"),
    ("bookman", "Bookman Old Style"),
    ("georgia", "Georgia"),
    ("cambria", "Cambria"),
    ("helvetica", "Arial"),
    ("nimbussan", "Arial"),
    ("arial", "Arial"),
    ("sfs", "Arial"),
    ("ss", "Arial"),
    ("courier", "Consolas"),
    ("nimbusmon", "Consolas"),
    ("dejavu", "Times New Roman"),
]


def map_font(pdf_name: str) -> str:
    n = (pdf_name or "").lower()
    for key, win in FONT_MAP:
        if key in n:
            return win
    return DEFAULTS["font"]


# ---------------------------------------------------------------- 编译

LATEX_ENGINES = ("xelatex", "pdflatex", "lualatex")


def compile_pdf(tex: Path, timeout: int = 240) -> tuple[Path | None, str]:
    """在临时目录编译两遍，返回 (pdf, 说明)。失败不抛异常，交给调用方回退。"""
    import os

    tex = tex.resolve()
    engine = next((e for e in LATEX_ENGINES if shutil.which(e)), None)
    if engine is None:
        return None, "没找到 xelatex/pdflatex/lualatex"
    tmp = Path(tempfile.mkdtemp(prefix="l2w-style-"))
    cmd = [engine, "-interaction=nonstopmode", "-file-line-error",
           "-output-directory", str(tmp), tex.name]
    # 期刊模板常把 .cls/.sty 放在 templates/ 的兄弟目录（styles/ 之类），
    # 不把那些目录塞进 TEXINPUTS，xelatex 会直接报 "File `xxx.cls' not found"。
    search = []
    root = tex.parent
    for d in (root, root.parent):
        search.append(str(d))
        try:
            for sub in sorted(d.iterdir()):
                if sub.is_dir() and sub.name.lower() in (
                        "styles", "style", "cls", "tex", "latex", "template",
                        "templates", "support", "includes"):
                    search.append(str(sub))
        except OSError:
            pass
    env = dict(os.environ)
    old = env.get("TEXINPUTS", "")
    env["TEXINPUTS"] = os.pathsep.join(search + [""]) + (os.pathsep + old if old else "")
    for _ in range(2):
        try:
            subprocess.run(cmd, cwd=str(tex.parent), capture_output=True,
                           timeout=timeout, env=env)
        except subprocess.TimeoutExpired:
            return None, f"{engine} 编译超时（>{timeout}s）"
        except Exception as exc:  # noqa: BLE001
            return None, f"{engine} 启动失败: {exc}"
        pdf = tmp / (tex.stem + ".pdf")
        if pdf.exists() and pdf.stat().st_size > 2000:
            break
    pdf = tmp / (tex.stem + ".pdf")
    if not pdf.exists() or pdf.stat().st_size < 2000:
        # 把最后一段日志捞出来，方便判断是缺宏包还是缺图片
        log = tmp / (tex.stem + ".log")
        hint = ""
        if log.exists():
            txt = log.read_text(encoding="utf-8", errors="replace")
            errs = [ln for ln in txt.splitlines() if ln.startswith("!")]
            hint = f"：{errs[0][:120]}" if errs else ""
        return None, f"{engine} 没产出 PDF{hint}"
    return pdf, f"{engine} 编译成功（{pdf.stat().st_size // 1024} KB）"


# ---------------------------------------------------------------- 量版面

def _round_half(x: float) -> float:
    return round(x * 2) / 2


def measure_pdf(pdf: Path) -> dict:
    import fitz

    doc = fitz.open(str(pdf))
    n = min(doc.page_count, 10)
    pages = [doc[i] for i in range(n)]
    W, H = pages[0].rect.width, pages[0].rect.height
    pt2cm = 2.54 / 72.0

    # ---- 收集正文块（去掉页眉页脚区）----
    body_blocks = []
    for pg in pages:
        for b in pg.get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            y0, y1 = b["bbox"][1], b["bbox"][3]
            if y0 < H * 0.055 or y1 > H * 0.95:
                continue
            if not "".join(s["text"] for l in b.get("lines", [])
                           for s in l["spans"]).strip():
                continue
            body_blocks.append((pg.number, b))
    if not body_blocks:
        raise RuntimeError("PDF 里取不到文字层（扫描件？）")

    xs0 = [b["bbox"][0] for _, b in body_blocks]
    xs1 = [b["bbox"][2] for _, b in body_blocks]
    left_pt, right_pt = min(xs0), max(xs1)
    # 上下边距必须"每页取极值，再跨页取中位数"：直接对所有块的 y 取中位数
    # 得到的是页面中间某一段，会把上下边距算成 12cm 这种离谱值。
    per_page_top: dict[int, float] = {}
    per_page_bot: dict[int, float] = {}
    for pno, b in body_blocks:
        per_page_top[pno] = min(per_page_top.get(pno, 1e9), b["bbox"][1])
        per_page_bot[pno] = max(per_page_bot.get(pno, -1e9), b["bbox"][3])
    tops = list(per_page_top.values())
    # 末页常只有几行，底边不可信，剔除后再取中位数
    last_pno = max(per_page_bot) if per_page_bot else -1
    bottoms = [v for k, v in per_page_bot.items() if k != last_pno]
    if len(bottoms) < 2:
        bottoms = list(per_page_bot.values())
    margins = (max(1.0, statistics.median(tops) * pt2cm),
               max(1.0, (H - statistics.median(bottoms)) * pt2cm),
               max(1.0, left_pt * pt2cm),
               max(1.0, (W - right_pt) * pt2cm))

    # ---- 字号分布：按字符数加权 ----
    size_w: dict[float, int] = {}
    font_w: dict[str, int] = {}
    east_w: dict[str, int] = {}
    line_rows = []
    for pno, b in body_blocks:
        for l in b.get("lines", []):
            txt = "".join(s["text"] for s in l["spans"])
            if not txt.strip():
                continue
            for s in l["spans"]:
                sz = _round_half(s["size"])
                size_w[sz] = size_w.get(sz, 0) + len(s["text"])
                if CJK_RE.search(s["text"]):
                    east_w[s["font"]] = east_w.get(s["font"], 0) + len(s["text"])
                else:
                    font_w[s["font"]] = font_w.get(s["font"], 0) + len(s["text"])
            line_rows.append((pno, round(l["bbox"][1], 1), round(l["bbox"][0], 1),
                              round(l["bbox"][2], 1), _round_half(max(s["size"] for s in l["spans"])),
                              txt.strip(), bool(re.search(r"[A-Za-z]", txt))))
    if not size_w:
        raise RuntimeError("取不到字号信息")

    body_size = max(size_w.items(), key=lambda kv: kv[1])[0]
    # 众数附近合并（9.7 vs 10.0 这种抖动）
    near = [s for s in size_w if abs(s - body_size) <= 0.6]
    body_size = _round_half(sum(s * size_w[s] for s in near) / sum(size_w[s] for s in near))

    # ---- 行距：正文大小的行，块内相邻行基线差的中位数 ----
    deltas = []
    by_block: dict[tuple, list] = {}
    for pno, b in body_blocks:
        for l in b.get("lines", []):
            sz = max((s["size"] for s in l["spans"]), default=0)
            if abs(sz - body_size) <= 0.8:
                by_block.setdefault((pno, b["number"]), []).append(l["bbox"][1])
    for ys in by_block.values():
        ys = sorted(ys)
        for a, bb in zip(ys, ys[1:]):
            d = bb - a
            if 0.9 * body_size < d < 3.0 * body_size:
                deltas.append(d)
    line_pt = statistics.median(deltas) if deltas else body_size * 1.2

    # ---- 首行缩进 ----
    indents = []
    for pno, b in body_blocks:
        lines = [l for l in b.get("lines", [])
                 if abs(max((s["size"] for s in l["spans"]), default=0) - body_size) <= 0.8]
        if len(lines) < 2:
            continue
        x0_first = lines[0]["bbox"][0]
        rest = min(l["bbox"][0] for l in lines[1:])
        d = x0_first - rest
        if 3 < d < body_size * 4:
            indents.append(d)
    indent_pt = statistics.median(indents) if indents else 0.0

    # ---- 标题字号：比正文大或加粗的短行 ----
    head_sizes = []
    for pno, y, x0, x1, sz, txt, has_alpha in line_rows:
        if not has_alpha or len(txt) > 70:
            continue
        if sz > body_size + 0.8:
            head_sizes.append(sz)
    uniq = sorted(set(head_sizes), reverse=True)[:3]
    heading_sizes = uniq + [body_size] * (4 - len(uniq))

    # ---- 题注字号 ----
    cap_sizes = [sz for _, _, _, _, sz, txt, _ in line_rows
                 if re.match(r"^(Fig\.?|Figure|Table|图|表)\s*\d", txt)]
    caption_size = _round_half(statistics.median(cap_sizes)) if cap_sizes else max(
        8.0, body_size - 1)

    # ---- 字体 ----
    font = map_font(max(font_w.items(), key=lambda kv: kv[1])[0]) if font_w else DEFAULTS["font"]
    cjk = bool(east_w)
    east = DEFAULTS["east"]
    if cjk:
        cand = max(east_w.items(), key=lambda kv: kv[1])[0].lower()
        east = "SimHei" if ("hei" in cand or "sans" in cand or "gothic" in cand) else "SimSun"

    # ---- 纸张 ----
    paper = "a4"
    if abs(W - 595) < 12 and abs(H - 842) < 12:
        paper = "a4"
    elif abs(W - 612) < 12 and abs(H - 792) < 12:
        paper = "letter"
    else:
        paper = (round(W * pt2cm, 1), round(H * pt2cm, 1))

    # 双栏：正文起点明显分成两簇 → 版心仍取两簇并集（Word 输出走单栏）
    return {
        "paper": paper,
        "margins": tuple(round(m, 2) for m in margins),
        "size": body_size,
        "line": _round_half(line_pt),
        "indent": _round_half(indent_pt),
        "heading_sizes": [round(x, 1) for x in heading_sizes],
        "caption_size": caption_size,
        "font": font,
        "east": east,
        "cjk": cjk,
        "page_pt": (round(W, 1), round(H, 1)),
    }


# ---------------------------------------------------------------- 回退：解析类文件

def _len_to_cm(v: str) -> float | None:
    m = re.match(r"\s*(-?[\d.]+)\s*(cm|mm|in|pt|bp|pc)?\s*$", v)
    if not m:
        return None
    x = float(m.group(1))
    unit = (m.group(2) or "pt").lower()
    return {"cm": x, "mm": x / 10, "in": x * 2.54, "pt": x * 2.54 / 72.28,
            "bp": x * 2.54 / 72, "pc": x * 2.54 / 6}[unit]


def guess_from_source(tex: Path) -> dict:
    base = tex.parent
    raw = tex.read_text(encoding="utf-8", errors="replace")
    text = re.sub(r"(?<!\\)%[^\n]*", "", raw)
    spec: dict = {}

    # 类选项：\documentclass[a4paper,11pt,twocolumn]{article}
    m = re.search(r"\\documentclass\s*\[([^\]]*)\]", text)
    opts = [o.strip() for o in (m.group(1).split(",") if m else [])]
    if "letterpaper" in opts:
        spec["paper"] = "letter"
    for o in opts:
        if re.fullmatch(r"\d+(\.\d+)?pt", o):
            spec["size"] = float(o[:-2])
            spec["line"] = round(float(o[:-2]) * 1.2, 1)

    # geometry
    m = re.search(r"\\usepackage\s*\[([^\]]*)\]\s*\{geometry\}", text)
    if m:
        kv = {}
        for part in m.group(1).split(","):
            if "=" in part:
                k, v = part.split("=", 1)
                kv[k.strip()] = v.strip()
        mg = list(DEFAULTS["margins"])
        if "margin" in kv and (v := _len_to_cm(kv["margin"])):
            mg = [v, v, v, v]
        for key, idx in (("top", 0), ("bottom", 1), ("left", 2), ("right", 3),
                         ("lmargin", 2), ("rmargin", 3), ("tmargin", 0),
                         ("bmargin", 1)):
            if key in kv and (v := _len_to_cm(kv[key])):
                mg[idx] = v
        spec["margins"] = tuple(round(x, 2) for x in mg)

    # \setlength{\textwidth}{...} + 页面宽度反推左右边距
    tw = re.search(r"\\setlength\s*\{\\textwidth\}\s*\{", text)
    if tw and "margins" not in spec:
        k = text.find("}", tw.end())
        v = _len_to_cm(text[tw.end():k]) if k > 0 else None
        if v:
            pw = 21.0 if spec.get("paper", "a4") == "a4" else 21.59
            side = max(0.8, (pw - v) / 2)
            spec["margins"] = (spec.get("margins", DEFAULTS["margins"])[0],
                               spec.get("margins", DEFAULTS["margins"])[1],
                               side, side)

    # 行距系数 \linespread{1.1} / \renewcommand{\baselinestretch}{1.1}
    m = re.search(r"\\linespread\s*\{([\d.]+)\}", text) or \
        re.search(r"\\baselinestretch\}\s*\{([\d.]+)\}", text)
    if m:
        spec["line"] = round(float(spec.get("size", DEFAULTS["size"])) * 1.2
                             * float(m.group(1)), 1)

    # 中文字体
    if re.search(r"ctex|xeCJK|CJK", text):
        spec["cjk"] = True
        spec["east"] = "SimSun"
    if re.search(r"\\usepackage(?:\[[^\]]*\])?\{times\}|mathptmx|newtxtext", text):
        spec["font"] = "Times New Roman"
    return spec


# ---------------------------------------------------------------- 入口

def main() -> int:
    ap = argparse.ArgumentParser(description="从论文推断版式，生成 reference.docx")
    ap.add_argument("tex")
    ap.add_argument("-o", "--out", default="reference.docx")
    ap.add_argument("--pdf", help="已有的参考 PDF（官方样例/自己编好的），优先用它测绘")
    ap.add_argument("--no-compile", action="store_true", help="不现场编译，只解析类文件")
    ap.add_argument("--json", help="把推断结果另存为 json，便于复核")
    args = ap.parse_args()

    tex = Path(args.tex).resolve()
    if not tex.exists():
        print(f"文件不存在: {tex}")
        return 1

    spec: dict = {}
    source = ""
    pdf_path = Path(args.pdf).resolve() if args.pdf else None
    if pdf_path is not None and not pdf_path.exists():
        print(f"PDF 不存在: {pdf_path}")
        return 1

    if pdf_path is None and not args.no_compile:
        pdf_path, note = compile_pdf(tex)
        print(f"编译: {note}")
        source = "pdf" if pdf_path else ""

    if pdf_path is not None:
        try:
            spec = measure_pdf(pdf_path)
            source = "pdf"
        except Exception as exc:  # noqa: BLE001
            print(f"量版面失败，回退到解析类文件: {exc}")
            spec = {}

    if not spec:
        spec = guess_from_source(tex)
        source = "source"
        if not spec.get("size"):
            spec.setdefault("size", DEFAULTS["size"])
            spec.setdefault("line", DEFAULTS["line"])
        print("版式来源: 类文件解析（精度低于直接量 PDF）")

    # 缺的键用默认值补齐，保证 build_reference 拿到完整 spec
    full = {**DEFAULTS, **{k: v for k, v in spec.items() if v is not None}}
    out = build_reference(Path(args.out), full)

    print(f"→ {out}")
    print(f"  纸张 {full['paper']} / 边距 {' '.join(f'{m:.2f}' for m in full['margins'])} cm"
          f" / 版心宽 {_text_width(full):.2f} cm")
    print(f"  正文 {full['size']}pt / 行距 {full['line']}pt / 首行缩进 {full['indent']}pt")
    print(f"  标题字号 {full['heading_sizes']} / 题注 {full['caption_size']}pt")
    print(f"  字体 {full['font']}" + (f" + {full['east']}" if full.get("cjk") else ""))
    if args.json:
        import json
        Path(args.json).write_text(
            json.dumps({**full, "source": source}, ensure_ascii=False, indent=2),
            encoding="utf-8")
    return 0


def _text_width(spec: dict) -> float:
    p = spec["paper"]
    pw = 21.0 if str(p).lower() == "a4" else 21.59 if p == "letter" else float(p[0])
    return pw - float(spec["margins"][2]) - float(spec["margins"][3])


if __name__ == "__main__":
    sys.exit(main())
