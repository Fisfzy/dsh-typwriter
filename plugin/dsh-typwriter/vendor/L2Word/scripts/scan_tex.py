#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L2word-mathtype · LaTeX 复杂度审计

在动手转换之前，先回答三个问题：
  1. 这篇论文有多少公式？（决定 MathType 阶段的耗时）
  2. 用了哪些 Word 里没有对应物的构造？（决定必须降级什么）
  3. 有没有自定义宏 / 多文件 / 特殊字体？（决定前端要不要预处理）

用法:
    python scan_tex.py paper.tex
    python scan_tex.py paper.tex --json
    python scan_tex.py paper.tex --out audit.md
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

# 公式环境 -> 每个环境大概等价几个独立公式（用于估时）
MATH_ENVS = {
    "equation": 1, "equation*": 1,
    "align": 1, "align*": 1, "flalign": 1, "flalign*": 1,
    "gather": 1, "gather*": 1, "multline": 1, "multline*": 1,
    "eqnarray": 1, "eqnarray*": 1, "alignat": 1, "alignat*": 1,
    "split": 0, "aligned": 0, "cases": 0, "array": 0,
    "matrix": 0, "pmatrix": 0, "bmatrix": 0, "vmatrix": 0,
}

# 包 -> (风险等级, 说明, 建议)
PACKAGE_RISK = {
    "tikz": ("high", "矢量绘图，Word 无对应物", "预编译为 PDF/PNG 后按图插入"),
    "pgfplots": ("high", "数据绘图", "同上；或改用 Excel 图表"),
    "tcolorbox": ("high", "装饰性边框盒子", "降级为带边框的无框段落或表格"),
    "mdframed": ("high", "带框环境", "降级为段落底纹"),
    "shadethm": ("high", "定理环境底纹", "降级为普通定理样式"),
    "multicol": ("medium", "栏内分栏", "Word 分节重建，通常只保留正文单栏"),
    "longtable": ("low", "跨页表格", "tex2word 可直接转"),
    "tabularx": ("low", "自适应宽度表格", "支持"),
    "booktabs": ("low", "三线表", "支持，效果最好"),
    "algorithm2e": ("medium", "伪代码", "tex2word 支持 algorithmic，2e 需确认"),
    "algorithmic": ("low", "伪代码", "支持"),
    "listings": ("medium", "代码清单", "转等宽段落，行号可能丢"),
    "minted": ("high", "需要 pygments 编译的代码块", "先渲染成图片或预转 listings"),
    "biblatex": ("medium", "参考文献引擎", "建议先转成 bibtex + \\bibliography"),
    "natbib": ("medium", "引用", "\\cite 的数字编号可用；\\citet/\\citep 的作者-年文本模式会退化成 [n]"),
    "hyperref": ("low", "超链接", "支持"),
    "xeCJK": ("low", "中文字体映射", "tex2word 支持字体槽映射"),
    "ctex": ("low", "中文排版", "同上，注意字号/行距需模板控制"),
    "subcaption": ("medium", "子图", "子图题注已支持 (a)/(b)；\\linewidth 之类的相对尺寸可能按原图像素插入"),
    "subfigure": ("medium", "子图（旧包）", "只认 subfigure 环境；\\subfloat 会被丢弃"),
    "multirow": ("medium", "跨行合并单元格", "会被拍平成普通单元格，上刊前手工合并"),
    "mhchem": ("medium", "化学式", "MathType 的 TeX 子集可能不认 \\ce{}"),
    "siunitx": ("low", "单位", "tex2word 内置支持 \\SI"),
    "physics": ("low", "物理宏", "tex2word 内置常用宏"),
    "mathtools": ("low", "数学增强", "常用宏已内置"),
    "amsmath": ("low", "数学", "核心支持"),
    "amssymb": ("low", "符号", "核心支持"),
    "geometry": ("medium", "页面尺寸", "必须由 Word 模板接管，忽略 LaTeX 值"),
    "fancyhdr": ("medium", "页眉页脚", "Word 模板接管"),
    "setspace": ("low", "行距", "模板接管"),
    "titlesec": ("medium", "标题样式重定义", "模板接管，可能丢自定义格式"),
    "enumitem": ("low", "列表间距", "部分支持"),
    "wrapfig": ("high", "文字环绕图", "Word 浮动图位置会变，需手工调整"),
    "float": ("low", "浮动控制", "支持基本 H 选项"),
}

GRAPHICS_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".eps", ".ps", ".svg", ".tikz", ".pgf"}


def read_text(p: Path) -> str:
    for enc in ("utf-8", "utf-8-sig", "gb18030"):
        try:
            return p.read_text(encoding=enc)
        except UnicodeDecodeError:
            continue
    return p.read_text(encoding="utf-8", errors="replace")


def strip_comments(text: str) -> str:
    """去掉 % 注释，但保留 \\% 转义。"""
    out = []
    for line in text.splitlines():
        out.append(re.sub(r"(?<!\\)%.*$", "", line))
    return "\n".join(out)


def expand_inputs(path: Path, depth: int = 0, seen: set | None = None) -> tuple[str, list[str]]:
    """展开 \\input / \\include，返回合并后的正文和被包含的文件列表。"""
    seen = seen or set()
    if depth > 6 or path in seen or not path.exists():
        return "", []
    seen.add(path)
    text = strip_comments(read_text(path))
    included = [str(path)]
    base = path.parent

    def repl(m: re.Match) -> str:
        name = m.group(1).strip()
        cand = base / name
        if cand.suffix != ".tex":
            cand = cand.with_suffix(".tex")
        body, sub = expand_inputs(cand, depth + 1, seen)
        included.extend(sub)
        return body

    text = re.sub(r"\\(?:input|include)\{([^}]+)\}", repl, text)
    return text, included


def count_math(text: str) -> dict:
    """分别统计各类公式，避免 $$ 与 $ 互相误伤。"""
    counts: Counter = Counter()

    # 先摘掉数学环境，剩下的正文再数 $ 与 \[
    env_pat = re.compile(r"\\begin\{(" + "|".join(re.escape(e) for e in MATH_ENVS) + r")\}")
    for m in env_pat.finditer(text):
        counts["env:" + m.group(1)] += 1

    body = text
    # 只摘掉数学环境，绝不能顺手删 document 环境，否则正文里的 $ 全被吞掉
    body = re.sub(
        r"\\begin\{(" + "|".join(re.escape(e) for e in MATH_ENVS) + r")\}.*?\\end\{\1\}",
        " ", body, flags=re.S)

    counts["display_dollar"] = len(re.findall(r"\$\$(.+?)\$\$", body, re.S))
    body = re.sub(r"\$\$(.+?)\$\$", " ", body, flags=re.S)

    # \[ ... \]，排除 \\[6pt] 这类换行尺寸参数
    brackets = re.findall(r"\\\[((?![0-9.]+\s*[a-z]{2}\]).+?)\\\]", body, re.S)
    counts["display_bracket"] = len(brackets)
    body = re.sub(r"\\\[((?![0-9.]+\s*[a-z]{2}\]).+?)\\\]", " ", body, flags=re.S)

    counts["inline_paren"] = len(re.findall(r"\\\((.+?)\\\)", body, re.S))
    body = re.sub(r"\\\((.+?)\\\)", " ", body, flags=re.S)

    counts["inline_dollar"] = len(re.findall(r"(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)", body))

    display = sum(v for k, v in counts.items() if k.startswith("env:"))
    display += counts["display_dollar"] + counts["display_bracket"]
    inline = counts["inline_dollar"] + counts["inline_paren"]
    return {
        "by_kind": dict(counts),
        "display_total": display,
        "inline_total": inline,
        "total": display + inline,
    }


def analyze(root: Path) -> dict:
    text, files = expand_inputs(root)
    if not text:
        raise SystemExit(f"读不到内容或文件不存在: {root}")

    docclass = re.search(r"\\documentclass(?:\[([^\]]*)\])?\{([^}]+)\}", text)
    packages = []
    for m in re.finditer(r"\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}", text):
        for pkg in m.group(2).split(","):
            packages.append(pkg.strip())

    macros = []
    for m in re.finditer(
        r"\\(?:re)?newcommand\{?\\([A-Za-z@]+)\}?|\\def\\([A-Za-z@]+)|"
        r"\\DeclareMathOperator\*?\{\\([A-Za-z@]+)\}|\\newenvironment\{([^}]+)\}", text):
        macros.append(next(g for g in m.groups() if g))

    envs = Counter(re.findall(r"\\begin\{([A-Za-z*]+)\}", text))
    graphics = [
        Path(g).suffix.lower()
        for g in re.findall(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}", text)
    ]
    math = count_math(text)

    pkg_risk = []
    for pkg in sorted(set(packages)):
        if pkg in PACKAGE_RISK:
            level, desc, fix = PACKAGE_RISK[pkg]
            pkg_risk.append({"package": pkg, "level": level, "desc": desc, "fix": fix})

    flags = []
    opts = (docclass.group(1) or "") if docclass else ""
    if "twocolumn" in opts or envs.get("multicol"):
        flags.append({"level": "high", "item": "双栏/多栏排版",
                      "fix": "Word 里用分节重建，或干脆改单栏（多数期刊允许初稿单栏）"})
    if envs.get("tikzpicture") or "tikz" in packages:
        flags.append({"level": "high", "item": f"TikZ 图 {envs.get('tikzpicture', 0)} 个",
                      "fix": "用 xelatex 预编译成独立 PDF/PNG，正文改为 \\includegraphics"})
    if envs.get("tcolorbox") or "tcolorbox" in packages:
        flags.append({"level": "high", "item": "tcolorbox 装饰框",
                      "fix": "降级为带底纹的段落或单格表格"})
    if any(g in {".eps", ".ps"} for g in graphics):
        flags.append({"level": "medium", "item": "EPS/PS 图片",
                      "fix": "先转 PNG（300dpi）再插入"})
    if len(files) > 1:
        flags.append({"level": "low", "item": f"多文件工程（{len(files)} 个 .tex）",
                      "fix": "已自动展开；确保 \\input 路径相对主文件"})
    if len(macros) > 30:
        flags.append({"level": "medium", "item": f"自定义宏 {len(macros)} 个",
                      "fix": "检查是否全部能被前端展开，必要时手工替换为原命令"})
    if "biblatex" in packages:
        flags.append({"level": "medium", "item": "biblatex 参考文献",
                      "fix": "转 bibtex + \\bibliography 后再进转换"})
    if re.search(r"\\bibliography\s*\{", text) and not re.search(r"\\begin\{thebibliography\}", text):
        flags.append({"level": "low", "item": "bibtex 文献库（.bib）",
                      "fix": "已就地解析 .bib，按 \\bibliographystyle 排序编号；"
                             "复杂 .bst 样式（作者-年、缩写刊名）不还原"})
    if re.search(r"\\(?:multirow|multicolumn)(?![A-Za-z])", text):
        flags.append({"level": "medium", "item": "跨行/跨列单元格",
                      "fix": "会被拍平成普通单元格（合并是 Word 表格属性），上刊前手工合并"})
    if "\\tableofcontents" in text:
        flags.append({"level": "low", "item": "目录",
                      "fix": "转成 Word 的 TOC 域，打开后 Ctrl+A → F9 更新"})
    if re.search(r"\\appendix(?![A-Za-z])", text):
        flags.append({"level": "low", "item": "附录（\\appendix）",
                      "fix": "章节号改写成 A/B；附录图表编号沿用 LaTeX 的连续计数"})

    # MathType 阶段耗时：实测 Toggle TeX 整批约 0.3~0.5 秒/公式
    # （旧版 SDK 逐条插入是 11~17 秒/公式，慢两个数量级，已弃用）
    est_lo = max(1, round(math["total"] * 0.3 / 60))
    est_hi = max(1, round(math["total"] * 0.5 / 60))
    est = f"{est_lo}" if est_lo == est_hi else f"{est_lo}-{est_hi}"

    return {
        "source": str(root),
        "files": files,
        "documentclass": {"name": docclass.group(2) if docclass else None, "options": opts},
        "packages": sorted(set(packages)),
        "package_risks": pkg_risk,
        "custom_macros": {"count": len(macros), "names": macros[:40]},
        "environments": dict(envs.most_common(25)),
        "math": math,
        "graphics": {"count": len(graphics), "formats": dict(Counter(graphics))},
        "flags": flags,
        "estimate": {"mathtype_minutes": est},
    }


def to_markdown(r: dict) -> str:
    m = r["math"]
    L = []
    L.append(f"# LaTeX 审计报告\n")
    L.append(f"- 主文件：`{r['source']}`")
    L.append(f"- 文档类：`{r['documentclass']['name']}` {r['documentclass']['options']}")
    L.append(f"- 参与文件：{len(r['files'])} 个\n")

    L.append("## 公式规模（决定耗时）\n")
    L.append(f"| 项目 | 数量 |\n|---|---|")
    L.append(f"| 行间公式 | {m['display_total']} |")
    L.append(f"| 行内公式 | {m['inline_total']} |")
    L.append(f"| **合计** | **{m['total']}** |")
    L.append(f"| 预估 MathType 阶段 | **{r['estimate']['mathtype_minutes']} 分钟** |\n")
    L.append("明细：" + "，".join(f"{k}={v}" for k, v in sorted(m["by_kind"].items())) + "\n")

    if r["flags"]:
        L.append("## 必须先处理的阻塞项\n")
        L.append("| 等级 | 问题 | 处理方式 |\n|---|---|---|")
        for f in sorted(r["flags"], key=lambda x: {"high": 0, "medium": 1, "low": 2}[x["level"]]):
            L.append(f"| {f['level']} | {f['item']} | {f['fix']} |")
        L.append("")

    if r["package_risks"]:
        L.append("## 宏包兼容性\n")
        L.append("| 宏包 | 等级 | 问题 | 建议 |\n|---|---|---|---|")
        for p in sorted(r["package_risks"], key=lambda x: {"high": 0, "medium": 1, "low": 2}[x["level"]]):
            L.append(f"| `{p['package']}` | {p['level']} | {p['desc']} | {p['fix']} |")
        L.append("")

    L.append("## 结构统计\n")
    L.append(f"- 自定义宏：{r['custom_macros']['count']} 个")
    L.append(f"- 图片：{r['graphics']['count']} 张"
             + (f" {r['graphics']['formats']}" if r['graphics']['count'] else "（无）"))
    top = ", ".join(f"{k}×{v}" for k, v in list(r["environments"].items())[:12])
    L.append(f"- 常用环境：{top}\n")
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("tex", help="主 .tex 文件")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out", help="把 Markdown 报告写到文件")
    args = ap.parse_args()

    root = Path(args.tex).resolve()
    r = analyze(root)

    if args.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return 0
    md = to_markdown(r)
    if args.out:
        Path(args.out).write_text(md, encoding="utf-8")
        print(f"已写入 {args.out}")
        m = r["math"]
        print(f"公式 {m['total']} 个（行间 {m['display_total']} / 行内 {m['inline_total']}），"
              f"预估 MathType {r['estimate']['mathtype_minutes']} 分钟，"
              f"阻塞项 {sum(1 for f in r['flags'] if f['level'] == 'high')} 个")
    else:
        print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
