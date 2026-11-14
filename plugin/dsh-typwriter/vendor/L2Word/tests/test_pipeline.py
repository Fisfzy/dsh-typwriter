#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""端到端自测：拿 fixtures 里的复杂样例跑完整条流水线并断言结果。

    python tests/test_pipeline.py

断言：退出码 0、生成 MathType 对象数 = 预期、无 OMML、无残留 LaTeX 分隔符。
换机器后先跑这个，比直接上论文省时间。
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "complex-paper" / "main.tex"


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="l2w-test-"))
    out = tmp / "paper.docx"
    cmd = [sys.executable, str(ROOT / "scripts" / "run.py"), str(FIXTURE),
           "-o", str(out), "--skip-doctor"]
    print("$ " + " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(r.stdout[-2500:])
    if r.returncode != 0:
        print("--- stderr ---")
        print(r.stderr[-1500:])
        print("✘ 流水线退出码非 0")
        return 1

    build = tmp / "paper_build"
    verify = json.loads((build / "verify.json").read_text(encoding="utf-8"))
    report = json.loads((build / "mathtype-report.json").read_text(encoding="utf-8"))
    manifest = json.loads((build / "filled.json").read_text(encoding="utf-8"))

    checks = [
        ("产出文件存在", out.exists()),
        ("无 OMML", verify["omml"] == 0),
        ("无残留分隔符", verify["residual_dollar"] == 0 and verify["residual_bracket"] == 0),
        ("对象数与落位公式数一致",
         verify["mathtype_objects"] == manifest["placed_total"]),
        ("转换无失败", report.get("failed_count", 0) == 0),
        ("编号域存在", verify["seq_equations"] >= 1),
    ]
    print()
    bad = 0
    for name, ok in checks:
        print(f"{'✔' if ok else '✘'} {name}")
        bad += 0 if ok else 1
    print(f"\n对象 {verify['mathtype_objects']}，落位 {manifest['placed_total']}，"
          f"未落位 {len(manifest['unplaced'])}，耗时 {report.get('seconds')}s")
    print(f"临时目录: {tmp}")
    print("PASS" if not bad else f"FAIL（{bad} 项）")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
