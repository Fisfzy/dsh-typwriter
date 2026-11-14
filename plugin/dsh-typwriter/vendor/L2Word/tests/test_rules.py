#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""规则单测：只测纯 Python 的归一化 / 拆分 / 白名单，不碰 Word，秒级可跑。

    python tests/test_rules.py

这里钉住的每一条都是真实稿上踩出来的坑，改代码时先跑这个再看端到端：

  · aligned / gathered / split / eqnarray MathType 不认 → 必须映射成 array
  · 换行的可选行距 `\\[-2pt]` 会让整条公式静默失败 → 必须删掉
  · 无结构的"原子串"（`kT` `1.2`）会被静默拒绝 → 必须补 `{}`
  · 顶层裸 `\\` 会被画成字面字符 → 必须包进 array
  · 超长公式按 `\\` 拆段，array 的列格式 `{rl}` 要跟着走
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from tex_macros import (  # noqa: E402
    MAX_DISPLAY_TEX,
    find_unsupported,
    normalize,
    split_long_display,
)

FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name}  {detail}")
        FAILS.append(name)


def env_of(tex: str) -> str:
    m = re.search(r"\\begin\{array\}(\{[^}]*\})?", tex)
    return m.group(0) if m else ""


def main() -> int:
    print("归一化 · 多行环境映射")
    a = normalize(r"\begin{aligned} a&=1\\ b&=2 \end{aligned}")
    check("aligned → array{rl}", env_of(a) == r"\begin{array}{rl}", a)
    check("aligned 名字不再出现", "aligned" not in a, a)

    g = normalize(r"\begin{gathered} a=1\\ b=2 \end{gathered}")
    check("gathered → array{c}", env_of(g) == r"\begin{array}{c}", g)

    s = normalize(r"\begin{split} a&=1\\ b&=2 \end{split}")
    check("split → array{rl}", env_of(s) == r"\begin{array}{rl}", s)

    e = normalize(r"\begin{eqnarray} a&=&1\\ b&=&2 \end{eqnarray}")
    check("eqnarray → array{rcl}", env_of(e) == r"\begin{array}{rcl}", e)

    m3 = normalize(r"\begin{aligned} a&=1&x\\ b&=2&y \end{aligned}")
    check("两处 & → 三列 array{rll}", env_of(m3) == r"\begin{array}{rll}", m3)

    keep = normalize(r"\begin{bmatrix} 1&2\\ 3&4 \end{bmatrix}")
    check("bmatrix 原样保留", r"\begin{bmatrix}" in keep, keep)

    print("归一化 · 换行写法")
    nb = normalize(r"\begin{aligned} a&=1\\[-2pt] b&=2 \end{aligned}")
    check("\\[-2pt] 被抹掉", "[-2pt]" not in nb, nb)

    tl = normalize(r"a=1\\ b=2")
    check("顶层裸 \\\\ 包进 array{l}",
          tl.startswith(r"\begin{array}{l}") and tl.endswith(r"\end{array}"), tl)

    mixed = normalize(r"\left\{ a \right\}\\ +x=0")
    check("整条无环境时整体包 array{l}",
          mixed.startswith(r"\begin{array}{l}") and r"\\ +x=0" in mixed, mixed)

    # 有环境、环境外还夹着换行：不能包 array（会把环境套进去），退化成 \quad
    with_env = normalize(r"\begin{bmatrix} 1 \end{bmatrix}\\ +x=0")
    check("有环境时顶层 \\\\ 退化成 \\quad",
          with_env.endswith(r"\end{bmatrix}\quad +x=0"), with_env)

    print("归一化 · 定界符与原子串")
    lr = normalize(r"\left\{ x \right.")
    check("\\left. / \\right. 不再被退化", r"\left\{" in lr and r"\right." in lr, lr)

    for raw, want in [("kT", "kT{}"), ("1.2", "1.2{}"), ("0.30", "0.30{}"),
                      ("u,v,w", "u,v,w{}"), ("H'", "H'{}")]:
        got = normalize(raw)
        check(f"{raw} → {want}", got == want, got)
    for keep_raw in ("u_x", r"\alpha", r"K_{\mathrm{I}}", "(a+b)"):
        got = normalize(keep_raw)
        check(f"{keep_raw} 不补组", not got.endswith("{}"), got)

    print("白名单 · 环境检查")
    bad = find_unsupported(r"\begin{aligned} a&=1 \end{aligned}")
    check("原始 aligned 会被报出来", r"\begin{aligned}" in bad, str(bad))
    ok = find_unsupported(normalize(r"\begin{aligned} a&=1 \end{aligned}"))
    check("归一化后不再报警", not ok, str(ok))

    print("拆分 · 超长行间公式")
    rows = [r"&(u_{(k)}-u_{(j)})[A_{11}g_{(kj)}^{20}+2A_{16}g_{(kj)}^{11}+A_{66}g_{(kj)}^{02}] \\"
            for _ in range(6)]
    long_tex = normalize(r"\sum_{k=1}^{N_{(j)}}V_{(k)}\left\{"
                         r"\begin{aligned} " + " ".join(rows) + r"\end{aligned}\right\}")
    check("样本确实超长", len(long_tex) > MAX_DISPLAY_TEX, str(len(long_tex)))
    segs = split_long_display(long_tex)
    check("拆成多段", len(segs) > 1, str(len(segs)))
    check("每段都不超限", all(len(x) <= MAX_DISPLAY_TEX for x in segs),
          str([len(x) for x in segs]))
    check("每段都带 array 列格式",
          all(env_of(x).startswith(r"\begin{array}{") for x in segs),
          str([env_of(x) for x in segs]))
    balanced = all(len(re.findall(r"\\left(?![A-Za-z])", x))
                   == len(re.findall(r"\\right(?![A-Za-z])", x)) for x in segs)
    check("每段 \\left/\\right 配平", balanced,
          str([(x.count(r"\left"), x.count(r"\right")) for x in segs]))
    check("首段有 \\right.，后续段有 \\left.",
          segs[0].endswith(r"\right.") and all(x.startswith(r"\left.") for x in segs[1:]),
          str([x[:12] for x in segs]))

    # 续段要带悬挂缩进，否则行首顶格、读者会以为这些行没被 \sum 乘进去。
    # \phantom 能精确对齐但 MathType 不支持，只能用固定 \quad 近似。
    check("续段带 \\quad 悬挂缩进",
          all(x.startswith(r"\left.\quad") for x in segs[1:]),
          str([x[:16] for x in segs[1:]]))

    short = normalize(r"\begin{aligned} a&=1 \end{aligned}")
    check("短公式不拆", split_long_display(short) == [short])

    # ---- 未知宏体检：换行符 `\\` 不能被当成宏的起始反斜杠 --------------
    # 真实稿 eq.47 的 Bmatrix 里 `\\K_{\mathrm{II}}` 被误报成"未知宏 \K"，
    # 原因是正则 `\\([A-Za-z]+)` 把换行符的前一个反斜杠当成了命令前缀。
    check("矩阵换行 \\\\K 不算未知宏",
          find_unsupported(r"\begin{Bmatrix}K\\K_{\mathrm{I}}\end{Bmatrix}") == [],
          str(find_unsupported(r"\begin{Bmatrix}K\\K_{\mathrm{I}}\end{Bmatrix}")))
    check("真的未知宏照样要报", find_unsupported(r"\foobar{x}") == [r"\foobar"],
          str(find_unsupported(r"\foobar{x}")))
    check("不支持的环境照样要报",
          find_unsupported(r"\begin{aligned}a\end{aligned}") == [r"\begin{aligned}"],
          str(find_unsupported(r"\begin{aligned}a\end{aligned}")))

    # ---- 结构：章节号 / 附录 / 定理计数器 / longtable ------------------
    # 这几条对应的是"静默错内容"：引用变 ??、附录编号接着数字走、
    # 子图题注没号、longtable 表头印两遍。都只靠纯文本就能测。
    from tex_struct import (mark_appendix, parse_newtheorems, sec_prefix,
                            strip_longtable_heads, TheoremNumbering, _alpha)
    from bibtex import format_entry, parse_bib

    print("结构 · 章节号与附录")
    check("附录字母 A/B/AA", (sec_prefix(1, True), sec_prefix(2, True),
                              sec_prefix(27, True)) == ("A", "B", "AA"),
          str([sec_prefix(i, True) for i in (1, 2, 27)]))
    check("普通章节仍是数字", sec_prefix(3, False) == "3")
    check("\\appendix 变成标记",
          "@@APX@@" in mark_appendix(r"\appendix" + "\n\\section{A}"),
          mark_appendix(r"\appendix\section{A}"))
    check("子图字母 a/aa", (_alpha(1), _alpha(26), _alpha(27)) == ("a", "z", "aa"))

    print("结构 · longtable 表头去重")
    lt = ("\\begin{longtable}{lc}\n\\caption{X}\\\\\nA & B \\\\\n"
          "\\endfirsthead\nA & B \\\\\n\\endhead\n1 & 2 \\\\\n\\end{longtable}")
    stripped = strip_longtable_heads(lt)
    check("重复表头只留一份", stripped.count("A & B") == 1, stripped)
    check("endfirsthead/endhead 清干净",
          "endfirsthead" not in stripped and "endhead" not in stripped, stripped)

    print("结构 · 定理计数器（按 \\newtheorem 声明）")
    decls = parse_newtheorems(
        r"\newtheorem{theorem}{Theorem}" "\n"
        r"\newtheorem{lemma}[theorem]{Lemma}" "\n"
        r"\newtheorem{thmx}{TheoremX}[section]")
    check("共享计数器被识别", decls["lemma"]["shared"] == "theorem", str(decls.get("lemma")))
    check("按节编号被识别", decls["thmx"]["within"] == "section", str(decls.get("thmx")))
    num = TheoremNumbering(decls)
    num.set_section(2)
    check("共享计数器连号",
          [num.next("theorem"), num.next("lemma")] == ["1", "2"])
    check("按节编号是 2.1", num.next("thmx") == "2.1", num.next("thmx"))

    print("结构 · bibtex")
    bib = parse_bib('@article{k1, author={Smith, John and Doe, Jane}, title={A {Study}}, '
                    'journal={J. Things}, year={2020}, volume={12}, pages={34--56}}')
    item = format_entry(bib["k1"])
    check("作者缩写成 J. Smith, J. Doe", "J. Smith, J. Doe" in item, item)
    check("页码破折号转 en dash", "34–56" in item, item)
    check("标题保留", "A Study" in item, item)

    print()
    if FAILS:
        print(f"{len(FAILS)} 条失败: {', '.join(FAILS)}")
        return 1
    print("全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
