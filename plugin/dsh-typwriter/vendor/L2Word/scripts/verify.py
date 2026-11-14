#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L2word-mathtype · S5 校验：不打开 Word，直接读 docx 内部结构核对。

检查项：
    1. MathType 对象数（Equation.DSMT4）与期望公式数是否一致
    2. 是否残留 OMML（m:oMath 必须为 0，这是本技能的硬约束）
    3. 是否有残留的 $...$ / \\[...\\] 文本（说明转换失败）
    4. 公式是否被降级成图片（word/media 里出现大量公式图）
    5. SEQ / REF 域与书签是否就位

用法:
    python verify.py out.docx [--expect 16] [--json report.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

NS_M = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from tex_macros import KNOWN_MACROS  # noqa: E402
except Exception:  # noqa: BLE001
    KNOWN_MACROS = frozenset()


def scan_ole_macros(z: zipfile.ZipFile) -> tuple[dict, dict]:
    """扫 MathType 的 OLE 二进制里残留的 LaTeX 命令。

    MTEF 会把原始 TeX token 一起存进去（这也是为什么干净文件里能扫到 \\frac、\\left），
    所以判据不是"有没有命令"，而是"有没有 MathType 认识的命令之外的命令"。
    MathType 遇到不认识的宏不会报错，只会把它当普通字符印出来 ——
    这是整条链路里最隐蔽的失效方式，必须在最终产物上验一次。
    """
    hits: dict[str, int] = {}
    where: dict[str, list[str]] = {}
    for n in z.namelist():
        if not n.startswith("word/embeddings/"):
            continue
        raw = z.read(n)
        for m in re.finditer(rb"\\[A-Za-z]{2,}", raw):
            cmd = m.group().decode("latin1")
            if cmd[1:] in KNOWN_MACROS:
                continue
            # 真 TeX 命令名几乎全小写。带大写尾巴的多半是从二进制里误抓的噪声：
            # 反斜杠（0x5C）刚好是某个 MTEF 记录码，后面跟着随手可得的字母。
            # 实测 `\maE`、`\partiE`、`\theE` 在 OLE 里根本不存在，却能被正则"匹配"出来。
            if any(c.isupper() for c in cmd[2:]):
                continue
            hits[cmd] = hits.get(cmd, 0) + 1
            where.setdefault(cmd, []).append(n.rsplit("/", 1)[-1])
    return hits, where


CODE_RUN_HINT = re.compile(r"Verbatim|Code|HTML|Preformatted", re.I)
MONO_FONT_HINT = re.compile(r"Consolas|Courier|Mono|Menlo|Monaco", re.I)


def residual_commands(xml: str) -> list[str]:
    """正文里残留的 LaTeX 命令，跳过等宽/代码 run。

    `\\verb|\\foo|` 这种写法本来就会把命令字面印出来，而且 pandoc 会把它放进
    VerbatimChar 样式。只有出现在普通正文 run 里的命令才是泄漏。
    """
    out: list[str] = []
    for m in re.finditer(r"<w:r[ >].*?</w:r>", xml, re.S):
        run = m.group(0)
        if CODE_RUN_HINT.search(run) or MONO_FONT_HINT.search(run):
            continue
        txt = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", run))
        out.extend(re.findall(r"\\[A-Za-z]{2,}", txt))
    return out


BIB_HEADINGS = ("References", "Bibliography", "REFERENCES", "参考文献")


def count_bib_items(xml: str) -> int:
    """数参考文献条目：找到 References 标题，数它后面还有几段非空正文。

    为什么不能按样式 ID 数：Word 存盘时会把整个 styles.xml 的 styleId 重写
    （Normal→a、Heading1→1、Bibliography→aa），所以 `w:pStyle w:val="Bibliography"`
    在 S4 产物上一律是 0 —— 这条检查写完当晚就把 08-struct 判成了"文献全丢"。
    文字内容不会被改名，只能按结构数。
    """
    paras = ["".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", p))
             for p in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S)]
    start = None
    for i, t in enumerate(paras):
        if t.strip() in BIB_HEADINGS:
            start = i
            break
    if start is None:
        return 0
    return sum(1 for t in paras[start + 1:] if t.strip())


def analyse(docx: Path) -> dict:
    with zipfile.ZipFile(docx) as z:
        names = z.namelist()
        xml = z.read("word/document.xml").decode("utf-8", "replace")
        emb = [n for n in names if n.startswith("word/embeddings/")]
        media = [n for n in names if n.startswith("word/media/")]
        ole_bad, ole_where = scan_ole_macros(z)

    text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml))
    res_cmds = residual_commands(xml)
    dsmt4 = xml.count('ProgID="Equation.DSMT4"') or xml.count("Equation.DSMT4")
    return {
        "path": str(docx),
        "size_kb": round(docx.stat().st_size / 1024),
        "mathtype_objects": dsmt4,
        "embeddings": len(emb),
        "omml": xml.count("<m:oMath"),
        "media": len(media),
        "residual_dollar": len(re.findall(r"\$[^$\r\n]{1,200}\$", text)),
        "residual_bracket": text.count("\\[") + text.count("\\]"),
        "residual_commands": len(res_cmds),
        "residual_command_list": res_cmds[:6],
        "ole_unsupported": ole_bad,
        "ole_where": {k: v[:5] for k, v in ole_where.items()},
        "seq_equations": len(re.findall(r"SEQ\s+Equation", xml)),
        "seq_figures": len(re.findall(r"SEQ\s+Figure", xml)),
        "seq_tables": len(re.findall(r"SEQ\s+Table", xml)),
        "bib_items": count_bib_items(xml),
        "toc_fields": len(re.findall(r"TOC\s+\\o", xml)),
        "ref_fields": len(re.findall(r"\bREF\s+_Eq", xml)),
        "unresolved_refs": text.count("??"),
        "bookmarks": len(re.findall(r"<w:bookmarkStart", xml)),
        "text_chars": len(text),
    }


def content_problems(r: dict, manifest: dict | None, source: dict | None) -> list[str]:
    """内容完整性对账：光数公式对象是不够的，题注/文献/公式有没有整块丢才是要害。

    S5 以前只查 OMML、对象数、未知宏，于是：
        · longtable 题注没编号 —— 通过
        · 子图题注丢了一半 —— 通过
        · 整个参考文献表消失 —— 通过
        · \\tableofcontents 消失 —— 通过
    这些都是"静默丢内容"，不比公式出错轻。
    """
    out: list[str] = []
    if manifest:
        if manifest.get("unplaced"):
            out.append(f"{len(manifest['unplaced'])} 个公式没进文档"
                       f"（多半在 pandoc 不支持的环境里）")
        exp = manifest.get("captions_expected")
        if exp is not None and exp != manifest.get("captions"):
            out.append(f"题注对不上：源文件 {exp} 条，写进文档 {manifest.get('captions')} 条")
        bib = manifest.get("bib_expected") or 0
        if bib and r["bib_items"] != bib:
            out.append(f"参考文献 {r['bib_items']} 条，源文件有 {bib} 条")
        if manifest.get("refs_unresolved"):
            out.append(f"{manifest['refs_unresolved']} 个引用占位符没解析出来")
    if source:
        meta = source.get("meta") or {}
        caps = len(meta.get("captions") or {})
        got = r["seq_figures"] + r["seq_tables"]
        if caps and got < caps:
            out.append(f"题注编号域只有 {got} 个，源文件有 {caps} 条题注（有题注丢了编号）")
        bib = int(meta.get("bib_count") or 0)
        if bib and r["bib_items"] != bib:
            out.append(f"参考文献 {r['bib_items']} 条，源文件 \\bibitem/.bib 有 {bib} 条")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("docx")
    ap.add_argument("--expect", type=int, help="期望的 MathType 对象数")
    ap.add_argument("--manifest", help="S3 的 filled.json，用于内容对账")
    ap.add_argument("--source", help="S2 的 equations.json，用于内容对账")
    ap.add_argument("--json")
    args = ap.parse_args()

    p = Path(args.docx)
    if not p.exists():
        print(f"文件不存在: {p}")
        return 1
    r = analyse(p)

    manifest = None
    if args.manifest and Path(args.manifest).exists():
        manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    source = None
    if args.source and Path(args.source).exists():
        source = json.loads(Path(args.source).read_text(encoding="utf-8"))

    def mark(ok: bool) -> str:
        return "✔" if ok else "✘"

    ole_n = sum(r["ole_unsupported"].values()) if r["ole_unsupported"] else 0
    ole_desc = "，".join(f"{k}×{v}" for k, v in
                         sorted(r["ole_unsupported"].items(), key=lambda kv: -kv[1])[:5])
    lines = [
        f"文件: {r['path']}  ({r['size_kb']} KB)",
        f"{mark(r['mathtype_objects'] > 0)} MathType 对象: {r['mathtype_objects']} 个，"
        f"嵌入流: {r['embeddings']}",
        f"{mark(r['omml'] == 0)} 残留 OMML: {r['omml']}（必须为 0）",
        f"{mark(r['residual_dollar'] == 0 and r['residual_bracket'] == 0)} "
        f"残留 LaTeX 分隔符: $×{r['residual_dollar']}  \\[×{r['residual_bracket']}",
        f"{mark(ole_n == 0)} 公式内未知宏: {ole_n} 处"
        + (f"（{ole_desc}）" if ole_n else ""),
        f"{mark(r['unresolved_refs'] == 0)} 未解析交叉引用（??）: {r['unresolved_refs']} 个",
        f"{mark(r['residual_commands'] == 0)} 正文残留 LaTeX 命令: {r['residual_commands']} 处",
        f"{mark(True)} 图片数: {r['media']}"
        f"（其中约 {max(0, r['media'] - r['mathtype_objects'])} 张是真实插图；"
        f"MathType 会为每个对象额外存一张预览图）",
        f"· 编号域 SEQ: {r['seq_equations']}，交叉引用 REF: {r['ref_fields']}，"
        f"书签: {r['bookmarks']}",
        f"· 题注 SEQ 域: 图 {r['seq_figures']} / 表 {r['seq_tables']}，"
        f"文献条目: {r['bib_items']}，目录域: {r['toc_fields']}",
    ]

    problems = []
    if r["omml"]:
        problems.append(f"存在 {r['omml']} 个 OMML 公式")
    if r["residual_dollar"] or r["residual_bracket"]:
        problems.append("有公式没被转换，文本里还留着 $ 或 \\[")
    if ole_n:
        problems.append(
            f"公式里有 {ole_n} 处 MathType 不认识的宏（{ole_desc}），"
            f"会原样印成字面文本；到 tex_macros.py 里补映射后重跑 S2")
    if r["unresolved_refs"]:
        problems.append(f"有 {r['unresolved_refs']} 处交叉引用没解析出来，正文里显示为 ??")
    if r["residual_commands"]:
        problems.append(f"正文里残留 {r['residual_commands']} 处 LaTeX 命令（pandoc 没展开）")
    if args.expect is not None and r["mathtype_objects"] != args.expect:
        problems.append(f"对象数 {r['mathtype_objects']} 与期望 {args.expect} 不符")
    if r["mathtype_objects"] == 0:
        problems.append("没有任何 MathType 对象")
    problems.extend(content_problems(r, manifest, source))

    print("\n".join(lines))
    if problems:
        print("\n结论：不通过")
        for x in problems:
            print(f"  ! {x}")
    else:
        print("\n结论：通过")

    if args.json:
        Path(args.json).write_text(
            json.dumps({**r, "problems": problems}, ensure_ascii=False, indent=2),
            encoding="utf-8")
    return 0 if not problems else 3


if __name__ == "__main__":
    sys.exit(main())
