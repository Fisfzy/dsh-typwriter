#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L2word-mathtype · 回归测试：把已知会踩的坑变成断言。

为什么要有：
    以前每改一次脚本，都要手动跑一遍、再翻 PDF 肉眼确认，慢而且会漏。
    这里把历史上真实踩过的坑（类文件宏、图表引用、纯 token 公式、
    MathType 静默降级……）写成固定用例，一条命令全跑。

用法:
    python run_tests.py                # 只跑到 S3（快，不需要 MathType）
    python run_tests.py --with-mathtype # 含 S4/S5（慢，但能验最终产物）
    python run_tests.py -k floats       # 只跑名字含 floats 的用例
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent          # tests/
SCRIPTS = HERE.parent / "scripts"               # skill 的脚本目录
CASES = HERE / "cases"
OUT = HERE / "_out"

# 内容断言：只验"没崩""没丢公式"抓不到两类问题 ——
#   1) 语言措辞错（中文稿印出 Abstract./Keywords:/References）；
#   2) 整块内容被吞（\abstract{...} 命令形式、\begin{IEEEkeywords} 环境）。
# 这两类都不报错、不影响计数，S5 也查不出来，只能对文本断言。
EXPECT = {
    "09-ieee": {
        "must": ["This abstract is written with the command form",
                 "latex to word, mathtype, equation object",
                 "Theorem 1", "Lemma 2", "References"],
        "must_not": ["\\markboth", "IEEE Transactions on Testing",
                     "\\begin{IEEEkeywords}"],
    },
    "10-cjk-full": {
        "must": ["摘要：", "关键词：", "参考文献", "定理 1", "引理 2"],
        "must_not": ["Abstract.", "Keywords:", "References", "\\begin{abstract}"],
    },
}


def run(cmd: list, timeout: int = 300) -> tuple[int, str, str]:
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=timeout)
    return r.returncode, r.stdout or "", r.stderr or ""


def text_of(docx: Path) -> str:
    with zipfile.ZipFile(docx) as z:
        xml = z.read("word/document.xml").decode("utf-8", "replace")
    import re
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml))


def check_case(tex: Path, ref: Path, with_mathtype: bool) -> dict:
    name = tex.stem
    work = OUT / name
    work.mkdir(parents=True, exist_ok=True)
    py = sys.executable
    res = {"case": name, "ok": True, "notes": [], "seconds": 0.0,
           "equations": 0, "refs": 0, "captions": 0}
    t0 = time.time()

    code, out, err = run([py, SCRIPTS / "prep_tex.py", tex, "-o", work])
    if code != 0:
        res["ok"] = False
        res["notes"].append(f"S2 失败: {(err or out).strip()[:160]}")
        return res

    data = json.loads((work / "equations.json").read_text(encoding="utf-8"))
    res["equations"] = len(data["equations"])
    res["refs"] = len(data["refs"])
    unresolved = [r["label"] for r in data["refs"] if r["number"] is None]
    if unresolved:
        res["ok"] = False
        res["notes"].append("引用没解析: " + ", ".join(unresolved[:4]))
    warn = [w for w in data.get("warnings", [])]
    if warn:
        res["notes"].append(f"S2 警告 {len(warn)}: {warn[0][:70]}")

    base = work / "base.docx"
    code, out, err = run([py, SCRIPTS / "build_docx.py", work / "prepared.tex",
                          "-o", base, "--equations", work / "equations.json",
                          "--size", "10",
                          "--reference-doc", ref] if ref.exists() else
                         [py, SCRIPTS / "build_docx.py", work / "prepared.tex",
                          "-o", base, "--equations", work / "equations.json"])
    if code != 0 or not base.exists():
        res["ok"] = False
        res["notes"].append(f"S3 失败: {(err or out).strip()[-160:]}")
        return res

    manifest = json.loads((work / "filled.json").read_text(encoding="utf-8"))
    res["captions"] = manifest.get("captions", 0)
    if manifest.get("unplaced"):
        res["ok"] = False
        res["notes"].append(f"{len(manifest['unplaced'])} 个公式没进文档")
    body = text_of(base)
    if "??" in body:
        res["ok"] = False
        res["notes"].append("正文出现未解析引用 ??")
    if "MTX" in body:
        res["ok"] = False
        res["notes"].append("有占位符没被替换")

    exp = EXPECT.get(name) or {}
    miss = [s for s in exp.get("must", []) if s not in body]
    leak = [s for s in exp.get("must_not", []) if s in body]
    if miss:
        res["ok"] = False
        res["notes"].append("缺内容: " + " | ".join(miss[:3]))
    if leak:
        res["ok"] = False
        res["notes"].append("不该出现: " + " | ".join(leak[:3]))

    if with_mathtype and res["equations"]:
        mt = work / "mt.docx"
        code, out, err = run([py, SCRIPTS / "to_mathtype.py", base, "-o", mt,
                              "--report", work / "mt.json"], timeout=900)
        rep = {}
        if (work / "mt.json").exists():
            rep = json.loads((work / "mt.json").read_text(encoding="utf-8"))
        if code != 0:
            res["ok"] = False
            res["notes"].append(f"S4 有失败 {rep.get('failed_count')} 个: "
                                + str(rep.get("failures", [])[:1])[:120])
        code, out, err = run([py, SCRIPTS / "verify.py", mt,
                              "--manifest", work / "filled.json",
                              "--source", work / "equations.json"])
        if code != 0:
            res["ok"] = False
            bad = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("!")]
            res["notes"].append("S5 不通过: " + (bad[0][:120] if bad else ""))

    res["seconds"] = round(time.time() - t0, 1)
    return res


def main() -> int:
    ap = argparse.ArgumentParser(description="latex2word 回归测试")
    ap.add_argument("--with-mathtype", action="store_true",
                    help="连 S4/S5 一起跑（慢，需要 MathType）")
    ap.add_argument("-k", "--filter", help="只跑文件名含该关键字的用例")
    ap.add_argument("--keep", action="store_true", help="保留中间产物")
    args = ap.parse_args()

    # 先跑纯规则单测（秒级、不依赖 Word）。归一化/拆分出错时，
    # 端到端用例只会表现出"公式数对不上"，很难定位，这里先把原因钉住。
    if not args.filter:
        code, out, err = run([sys.executable, Path(__file__).with_name("test_rules.py")])
        print(out.rstrip())
        if code != 0:
            print("\n规则单测未通过，先修 tex_macros 再跑端到端\n")
            return code
        print()

    cases = sorted(CASES.glob("*.tex"))
    if args.filter:
        cases = [c for c in cases if args.filter.lower() in c.name.lower()]
    if not cases:
        print("没有找到用例")
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    ref = OUT / "reference.docx"
    if not ref.exists():
        code, out, err = run([sys.executable, SCRIPTS / "make_reference_docx.py",
                              "-o", ref])
        if code != 0:
            print("生成 reference.docx 失败，用例将裸跑（版式取默认 A4）")

    print(f"用例 {len(cases)} 个"
          + ("（含 MathType 转换）" if args.with_mathtype else "（只到 S3）") + "\n")
    rows, bad = [], 0
    for tex in cases:
        r = check_case(tex, ref, args.with_mathtype)
        rows.append(r)
        if not r["ok"]:
            bad += 1
        flag = "PASS" if r["ok"] else "FAIL"
        print(f"[{flag}] {r['case']:<16} 公式 {r['equations']:>3}  "
              f"引用 {r['refs']:>2}  题注 {r['captions']:>2}  {r['seconds']:>5.1f}s")
        for n in r["notes"]:
            print(f"        · {n}")

    print(f"\n{len(rows) - bad}/{len(rows)} 通过")
    (OUT / "report.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"明细: {OUT/'report.json'}")
    return 0 if bad == 0 else 3


if __name__ == "__main__":
    sys.exit(main())
