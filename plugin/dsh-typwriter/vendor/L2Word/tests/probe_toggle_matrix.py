#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""B 计划可行性：MathType 加载项的 Toggle TeX 对各语法结构的通过率。

做法：一篇文档里每段放一个 LaTeX 公式，整篇一次 Toggle TeX，
再逐段检查「$ / \\[ 是否消失」与「对象个数」，得到真实的支持清单。
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

DOTM = Path(r"D:\Program Files (x86)\Office Support\64\MathType Commands 2016.dotm")

CASES: list[tuple[str, str]] = [
    ("分式", r"\[ \frac{a}{b} \]"),
    ("根式(可选指数)", r"\[ \sqrt[3]{x+1} \]"),
    ("求和/积分", r"\[ \sum_{i=1}^{n} i^2 + \int_{0}^{\infty} e^{-x} dx \]"),
    ("希腊字母", r"\[ \alpha\beta\Gamma\Delta \]"),
    ("aligned 多行", r"\[ \begin{aligned} a &= b+c \\ d &= \frac{e}{f} \end{aligned} \]"),
    ("array 多行", r"\[ \begin{array}{cc} a & b \\ c & d \end{array} \]"),
    ("pmatrix", r"\[ \begin{pmatrix} a & b \\ c & d \end{pmatrix} \]"),
    ("cases", r"\[ \begin{cases} x & x>0 \\ -x & x<0 \end{cases} \]"),
    ("\\text", r"\[ f(x)=\begin{cases} 1 & \text{if } x>0 \\ 0 & \text{otherwise} \end{cases} \]"),
    ("粗体/花体/黑板体", r"\[ \mathbf{A}\mathcal{L}\mathbb{R} \]"),
    ("left-right 括号", r"\[ \left( \frac{a}{b} \right)^{2} \]"),
    ("hat/vec/bar", r"\[ \hat{x}+\vec{v}+\bar{z} \]"),
    ("上下标嵌套", r"\[ x_{ij}^{(k)} \]"),
    ("极限", r"\[ \lim_{x\to 0}\frac{\sin x}{x}=1 \]"),
    ("上划线", r"\[ \overline{AB} \]"),
    ("关系符", r"\[ a \leq b \neq c \approx d \]"),
    ("组合数", r"\[ \binom{n}{k} \]"),
    ("偏导", r"\[ \frac{\partial u}{\partial t}=\nabla^2 u \]"),
    ("公式内中文", r"\[ P_{\text{牛顿}} \]"),
    ("行内公式", r"速度 $v=\frac{dx}{dt}$ 是导数"),
    ("编号环境内容", r"\[ E=mc^{2} \]"),
]


def main() -> int:
    import win32com.client as win32

    word = win32.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    try:
        word.AutomationSecurity = 1
    except Exception:  # noqa: BLE001
        pass
    tpl = doc = None
    rows = []
    try:
        tpl = word.Documents.Open(str(DOTM), ReadOnly=True, AddToRecentFiles=False)
        doc = word.Documents.Add()
        for name, tex in CASES:
            doc.Content.InsertAfter(tex + "\r")
        total_chars_before = len(doc.Content.Text)
        doc.Content.Select()
        t0 = time.time()
        word.Run("MTCommand_TeXToggle")
        elapsed = round(time.time() - t0, 2)
        time.sleep(0.8)

        for i, (name, tex) in enumerate(CASES, 1):
            para = doc.Paragraphs(i)
            txt = para.Range.Text
            objs = para.Range.InlineShapes.Count
            residual = ("$" in txt) or ("\\[" in txt) or ("\\]" in txt)
            rows.append({"i": i, "name": name, "objects": objs,
                         "residual_delim": residual,
                         "ok": objs > 0 and not residual,
                         "text": txt.replace("\x01", "◊").strip()[:60]})
        print(f"整篇一次 Toggle TeX 耗时 {elapsed}s，"
              f"字符数 {total_chars_before}→{len(doc.Content.Text)}")
    finally:
        try:
            if doc is not None:
                doc.Close(SaveChanges=0)
        except Exception:  # noqa: BLE001
            pass
        try:
            if tpl is not None:
                tpl.Close(SaveChanges=0)
        except Exception:  # noqa: BLE001
            pass
        try:
            word.Quit()
        except Exception:  # noqa: BLE001
            pass

    ok = [r for r in rows if r["ok"]]
    for r in rows:
        mark = "✔" if r["ok"] else "✘"
        print(f"{mark} {r['name']:16s} 对象={r['objects']:<3} 残留={r['residual_delim']:<5} {r['text']}")
    print(f"\n通过 {len(ok)}/{len(rows)}")
    (Path(__file__).parent / "toggle_matrix.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if len(ok) == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main())
