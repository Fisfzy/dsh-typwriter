#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L2word-mathtype · 把转出的 PDF 和参考 PDF 对比，输出可判定的差异清单。

为什么需要它：
    "我看了觉得差不多" 不是验收标准。改一次脚本就要肉眼翻六页 PDF，
    既慢又会漏。这里把两件事自动化：

    1. 版面指标：纸张、版心、正文字号、行距、页数 —— 数值化对比，超阈值报警
    2. 文字内容：字符级 diff —— 少了哪句、多了什么、顺序错没错

用法:
    python compare_pdf.py 参考.pdf 转出.pdf [--json report.json] [--tol 0.5]
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import statistics
import sys
from pathlib import Path

CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def _round_half(x: float) -> float:
    return round(x * 2) / 2


def metrics(pdf: Path, max_pages: int = 12) -> dict:
    import fitz

    doc = fitz.open(str(pdf))
    n = min(doc.page_count, max_pages)
    pages = [doc[i] for i in range(n)]
    W, H = pages[0].rect.width, pages[0].rect.height
    pt2cm = 2.54 / 72.0

    blocks = []
    for pg in pages:
        for b in pg.get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            y0, y1 = b["bbox"][1], b["bbox"][3]
            if y0 < H * 0.05 or y1 > H * 0.96:
                continue
            txt = "".join(s["text"] for l in b.get("lines", []) for s in l["spans"])
            if not txt.strip():
                continue
            blocks.append((pg.number, b))
    if not blocks:
        raise RuntimeError(f"{pdf.name} 没有文字层")

    xs0 = [b["bbox"][0] for _, b in blocks]
    xs1 = [b["bbox"][2] for _, b in blocks]
    size_w: dict[float, int] = {}
    deltas: list[float] = []
    for pno, b in blocks:
        for l in b.get("lines", []):
            for s in l["spans"]:
                sz = _round_half(s["size"])
                size_w[sz] = size_w.get(sz, 0) + len(s["text"])
    body = max(size_w.items(), key=lambda kv: kv[1])[0] if size_w else 0
    page_h = []
    for pg in pages:
        bs = [b for b in pg.get_text("dict")["blocks"] if b.get("type") == 0]
        ys0 = [b["bbox"][1] for b in bs if b["bbox"][3] > H * 0.05]
        ys1 = [b["bbox"][3] for b in bs if b["bbox"][1] < H * 0.96]
        if ys0 and ys1 and max(ys1) > min(ys0):
            page_h.append(max(ys1) - min(ys0))
    for pno, b in blocks:
        ys = []
        for l in b.get("lines", []):
            # 只取正文字号的行：参考文献、题注、脚注用的是更小的字号和更紧的行距，
            # 混进来会把行距中位数拉低约 1pt，误报成"版式不一致"。
            if abs(max((s["size"] for s in l["spans"]), default=0) - body) > 0.6:
                continue
            ys.append(l["bbox"][1])
        ys.sort()
        for a, bb in zip(ys, ys[1:]):
            d = bb - a
            if 0.9 * body < d < 3.0 * body:
                deltas.append(d)

    return {
        "pages": doc.page_count,
        "page_cm": (round(W * pt2cm, 2), round(H * pt2cm, 2)),
        "text_cm": (round((max(xs1) - min(xs0)) * pt2cm, 2),
                    # 每页各自量内容高度再取中位；全局 min/max 会被首页/末页带偏
                    round(statistics.median(page_h) * pt2cm, 2) if page_h else 0.0),
        "last_cm": (round(max(0.0, page_h[-1]) * pt2cm, 2) if page_h else 0.0),
        "body_pt": body,
        "line_pt": _round_half(statistics.median(deltas)) if deltas else 0.0,
        "chars": sum(size_w.values()),
    }


def normalise(text: str) -> str:
    """去页眉页脚噪声、修断字、统一空白，只留能比较的正文。"""
    t = text.replace("\u00a0", " ").replace("~", " ")
    # LaTeX 会把 framework 断成 frame-\nwork，接回来再比
    t = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n\s*\n+", "\n", t)
    return t.strip()


def text_of(pdf: Path) -> str:
    import fitz
    doc = fitz.open(str(pdf))
    return normalise("\n".join(p.get_text() for p in doc))


def _tokens(text: str) -> list[str]:
    """按词切分；中文按字切（中文没有空格，按行比会把整页判成不同）。"""
    flat = re.sub(r"\s+", " ", text).strip()
    if not flat:
        return []
    cjk = len(CJK_RE.findall(flat))
    if cjk > len(flat) * 0.05:
        out, buf = [], ""
        for ch in flat:
            if CJK_RE.match(ch):
                if buf.strip():
                    out.extend(buf.split())
                buf = ""
                out.append(ch)
            else:
                buf += ch
        if buf.strip():
            out.extend(buf.split())
        return out
    return flat.split()


def paragraphs(pdf: Path) -> list[str]:
    """按 PDF 文本块取段落 —— 比按行/按页可靠得多。"""
    import fitz
    doc = fitz.open(str(pdf))
    out = []
    for pg in doc:
        for b in pg.get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            txt = "\n".join("".join(s["text"] for s in l["spans"])
                            for l in b.get("lines", []))
            txt = normalise(txt)
            if txt:
                out.append(txt)
    return out


MATH_HINT = re.compile(r"[∑∫∏√≤≥≠→⇒∈∀∃∂∇∞±×·]")


def _is_prose(s: str) -> bool:
    """公式段不参与覆盖检查：MathType 对象不是文字，转出侧天然抓不到。"""
    toks = s.split()
    if len(toks) < 6:
        return False
    letters = sum(ch.isalpha() for ch in s)
    if letters < len(s) * 0.45:
        return False
    if len(MATH_HINT.findall(s)) > 3:
        return False
    return True


def _prose_tokens(text: str) -> list[str]:
    """只留"真词"：长度≥2 的字母词 + 汉字。

    行内公式转成 MathType 对象后没有文字层，句子会被从中间切断。若按全词比，
    每句话都只能匹配到第一个公式之前，全部误判为"缺失"。把单字母变量和符号
    去掉后，剩下的骨架才是能比的东西。
    """
    flat = re.sub(r"\s+", " ", text)
    # Word 断行处会把 non-degenerate 拆成 non- / degenerate，落成 "nondegenerate"；
    # 参考 PDF 里它可能没断行仍是 "non-degenerate"。统一去连字符再比。
    flat = re.sub(r"(\w)-(\w)", r"\1\2", flat)
    out = []
    for w in re.findall(r"[A-Za-z]{3,}|[\u4e00-\u9fff]", flat):
        if w[0].isascii():
            # 排除公式残留：\mathbb{R} 提取成 "IR"、\mathbb{T}^2 成 "TZZ"、
            # 微分项成 "dtF"。它们的共同特征是"非词首字母也有大写"或全大写。
            if not (w[1:].islower() or w.islower()):
                continue
            out.append(w.lower())
        else:
            out.append(w)
    return out


def paragraph_coverage(ref_pdf: Path, out_text: str, threshold: float = 0.75) -> dict:
    """逐段确认参考 PDF 的正文段落在转出侧是否存在。

    这比整体字符 diff 有用：整体相似度会被"公式变成对象后没有文字层"拉低，
    但真正要防的是"整段丢了"或"整段重复"。这里对每段取最长公共片段覆盖率。
    """
    out_words = _prose_tokens(out_text)
    checked, missing = 0, []
    for para in paragraphs(ref_pdf):
        if not _is_prose(para):
            continue
        pw = _prose_tokens(para)
        if len(pw) < 4:
            continue
        checked += 1
        sm = difflib.SequenceMatcher(None, pw, out_words, autojunk=False)
        # 用"所有匹配块之和"而不是最长单块：段落里的行内公式把句子切成好几截，
        # 只取最长块会把整段判成缺失（实测 40 段里误报 10 段）。
        matched = sum(blk.size for blk in sm.get_matching_blocks())
        cover = matched / len(pw)
        if cover < threshold:
            missing.append({"cover": round(cover, 2), "text": para[:140]})
    return {"checked": checked, "missing": missing[:12],
            "missing_count": len(missing)}


def diff_report(a: str, b: str, limit: int = 8) -> dict:
    ta, tb = _tokens(a), _tokens(b)
    sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False)
    return {"similarity": round(sm.ratio(), 4),
            "tokens_ref": len(ta), "tokens_out": len(tb)}


def main() -> int:
    ap = argparse.ArgumentParser(description="参考 PDF vs 转出 PDF 的差异清单")
    ap.add_argument("ref")
    ap.add_argument("out")
    ap.add_argument("--json")
    ap.add_argument("--tol", type=float, default=0.5,
                    help="字号/行距允许偏差（pt），默认 0.5")
    args = ap.parse_args()

    ref, out = Path(args.ref), Path(args.out)
    for p in (ref, out):
        if not p.exists():
            print(f"文件不存在: {p}")
            return 1

    try:
        ma, mb = metrics(ref), metrics(out)
    except Exception as exc:  # noqa: BLE001
        print(f"量版面失败: {exc}")
        return 2
    out_text = text_of(out)
    d = diff_report(text_of(ref), out_text)
    cov = paragraph_coverage(ref, out_text)

    rows = [
        ("页数", ma["pages"], mb["pages"], ""),
        ("纸张 cm", f"{ma['page_cm'][0]}x{ma['page_cm'][1]}",
         f"{mb['page_cm'][0]}x{mb['page_cm'][1]}", ""),
        ("版心宽 cm", ma["text_cm"][0], mb["text_cm"][0], ""),
        ("正文字号 pt", ma["body_pt"], mb["body_pt"], "pt"),
        ("行距 pt", ma["line_pt"], mb["line_pt"], "pt"),
    ]
    print(f"参考: {ref}")
    print(f"转出: {out}\n")
    print(f"{'指标':<12}{'参考':>10}{'转出':>10}  判定")
    problems = []
    for name, va, vb, unit in rows:
        if va == 0 and vb == 0:
            # 单页短文里没有相邻行，行距量不出来，别报成 "0.0 OK"
            print(f"{name:<12}{'—':>10}{'—':>10}  跳过（样本不足）")
            continue
        if isinstance(va, float) and isinstance(vb, float):
            ok = abs(va - vb) <= args.tol
            tag = "OK" if ok else "差异"
            if not ok:
                problems.append(f"{name}: 参考 {va} / 转出 {vb}")
        elif va == vb:
            ok, tag = True, "OK"
        else:
            ok, tag = False, "差异"
            problems.append(f"{name}: 参考 {va} / 转出 {vb}")
        print(f"{name:<12}{str(va):>10}{str(vb):>10}  {tag}")

    print(f"\n正文段落覆盖：检查 {cov['checked']} 段，缺失 {cov['missing_count']} 段")
    for m in cov["missing"]:
        print(f"   缺少（覆盖 {m['cover']*100:.0f}%）{m['text']}")
    print(f"整体词相似度 {d['similarity']*100:.1f}%"
          f"（{d['tokens_ref']} 词 vs {d['tokens_out']} 词；"
          f"公式变成对象后没有文字层，这个数天然偏低，只作参考）")

    verdict = "通过" if not problems and cov["missing_count"] == 0 else "有差异"
    print(f"\n结论：{verdict}")
    for p in problems:
        print(f"  ! {p}")
    if ma["pages"] != mb["pages"]:
        # 页数不一致时给出溢出量：转出侧末页只堆了一两行，说明是排版松紧差
        # 累积出来的，不是丢内容；差一整页以上才需要回头查版式。
        more = mb["pages"] > ma["pages"]
        print(f"  · 溢出诊断：{'转出' if more else '参考'}侧多 {abs(mb['pages'] - ma['pages'])} 页，"
              f"末页内容高度 参考 {ma['last_cm']}cm / 转出 {mb['last_cm']}cm"
              f"（差 {abs(ma['last_cm'] - mb['last_cm']):.1f}cm）")
    if cov["missing_count"]:
        print(f"  ! {cov['missing_count']} 段正文在转出侧找不到")

    if args.json:
        Path(args.json).write_text(json.dumps(
            {"ref": ma, "out": mb, "diff": d, "coverage": cov,
             "problems": problems, "verdict": verdict},
            ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if verdict == "通过" else 3


if __name__ == "__main__":
    sys.exit(main())
