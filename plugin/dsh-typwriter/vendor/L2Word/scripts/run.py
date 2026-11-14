#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L2word-mathtype · 一键跑完 S1→S5。

    python run.py paper.tex -o paper-MathType.docx [--reference-doc 模板.docx]

每一步失败都会停在原地并给出下一步提示，不会带着错误往下走。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run_step(label: str, cmd: list[str], *, allow_fail: bool = False) -> tuple[int, str]:
    print(f"\n=== {label} ===")
    print("  " + " ".join(str(c) for c in cmd))
    t0 = time.time()
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    out = (r.stdout or "").strip()
    err = (r.stderr or "").strip()
    for line in out.splitlines()[-12:]:
        print("  " + line)
    if r.returncode != 0 and err:
        for line in err.splitlines()[-6:]:
            print("  ! " + line)
    print(f"  （{time.time()-t0:.1f}s，退出码 {r.returncode}）")
    if r.returncode != 0 and not allow_fail:
        raise SystemExit(f"{label} 失败，退出码 {r.returncode}")
    return r.returncode, out


def export_pdf(docx: Path, pdf: Path) -> bool:
    """用 Word 把 docx 导成 PDF。纯粹为了能给 compare_pdf.py 提供输入。"""
    try:
        import win32com.client as win32  # noqa: F401
    except ImportError:
        print("  ! 没装 pywin32，跳过 PDF 导出")
        return False
    pdf.parent.mkdir(parents=True, exist_ok=True)
    if pdf.exists():
        pdf.unlink()
    word = None
    try:
        import win32com.client as win32
        word = win32.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0
        d = word.Documents.Open(str(docx.resolve()), ReadOnly=True,
                                AddToRecentFiles=False)
        d.ExportAsFixedFormat(str(pdf.resolve()), 17)
        d.Close(0)
        return pdf.exists()
    except Exception as exc:  # noqa: BLE001
        print(f"  ! 导出 PDF 失败: {exc}")
        return False
    finally:
        if word is not None:
            try:
                word.Quit()
            except Exception:  # noqa: BLE001
                pass


def main() -> int:
    ap = argparse.ArgumentParser(description="LaTeX → Word（MathType 公式）全流程")
    ap.add_argument("tex")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--reference-doc", help="目标 Word 模板 .docx（最准，优先用）")
    ap.add_argument("--auto-style", action="store_true",
                    help="自动推断版式：现场编译论文并量版面（无 LaTeX 工具链时解析类文件）")
    ap.add_argument("--style-pdf", help="用这份 PDF 推断版式（官方样例/自己编好的），最准")
    ap.add_argument("--no-compile", action="store_true",
                    help="推断版式时不现场编译，只解析 .cls/.sty")
    ap.add_argument("--build-dir", help="中间产物目录（默认 <输出名>_build）")
    ap.add_argument("--size", type=float, default=10.5)
    ap.add_argument("--limit", type=int,
                    help="抽样验收前 N 个含公式段落（整篇仍会一次转换）")
    ap.add_argument("--skip-doctor", action="store_true")
    ap.add_argument("--pdf-out", help="顺带导出 PDF 到该路径（需要本机装 Word）")
    ap.add_argument("--compare", help="与这份参考 PDF 对比版式和正文覆盖，出差异清单")
    args = ap.parse_args()

    tex = Path(args.tex).resolve()
    out = Path(args.out).resolve()
    build = Path(args.build_dir) if args.build_dir else out.with_name(out.stem + "_build")
    build.mkdir(parents=True, exist_ok=True)
    py = sys.executable

    if not args.skip_doctor:
        run_step("S0 环境体检", [py, HERE / "doctor.py"])

    run_step("S1 复杂度审计", [py, HERE / "scan_tex.py", tex,
                              "--out", build / "audit.md"], allow_fail=True)

    run_step("S2 抽取公式", [py, HERE / "prep_tex.py", tex, "-o", build])

    prep_tex = build / "prepared.tex"
    equations = build / "equations.json"
    if not prep_tex.exists():
        raise SystemExit("S2 没有产出 prepared.tex")

    base = build / "base.docx"
    if not args.reference_doc and (args.auto_style or args.style_pdf):
        ref = build / "reference.docx"
        style_json = build / "style.json"
        cmd = [py, HERE / "learn_style.py", tex, "-o", ref, "--json", style_json]
        if args.style_pdf:
            cmd += ["--pdf", str(Path(args.style_pdf).resolve())]
        if args.no_compile:
            cmd += ["--no-compile"]
        run_step("S2.5 推断版式", cmd, allow_fail=True)
        if ref.exists():
            args.reference_doc = str(ref)
            # 公式字号跟正文一致，否则公式明显比正文大/小一圈
            try:
                learned = json.loads(style_json.read_text(encoding="utf-8"))
                if learned.get("size"):
                    args.size = float(learned["size"])
            except Exception:  # noqa: BLE001
                pass
    cmd = [py, HERE / "build_docx.py", prep_tex, "-o", base, "--equations", equations,
           "--size", args.size]
    if args.reference_doc:
        cmd += ["--reference-doc", str(Path(args.reference_doc).resolve())]
    run_step("S3 生成 docx 骨架并回填 LaTeX", cmd)

    mt = build / "mathtype.docx"
    cmd = [py, HERE / "to_mathtype.py", base, "-o", mt,
           "--report", build / "mathtype-report.json"]
    if args.limit:
        cmd += ["--limit", str(args.limit)]
    run_step("S4 转成 MathType 对象", cmd, allow_fail=True)

    expect = None
    manifest = build / "filled.json"
    if manifest.exists():
        m = json.loads(manifest.read_text(encoding="utf-8"))
        expect = m.get("placed_total")
        if m.get("unplaced"):
            print(f"\n注意：{len(m['unplaced'])} 个公式没进文档（pandoc 不支持的环境），"
                  f"例如第 {[u['line'] for u in m['unplaced'][:5]]} 行")
    cmd = [py, HERE / "verify.py", mt, "--json", build / "verify.json"]
    # 内容对账：题注/文献/公式块有没有整块丢，光数公式对象查不出来
    if manifest.exists():
        cmd += ["--manifest", str(manifest)]
    eq_json = build / "equations.json"
    if eq_json.exists():
        cmd += ["--source", str(eq_json)]
    # 用了 --limit 时 S4 只核对了前几段，全篇对象数仍应是完整的；
    # 这时不传 --expect，避免拿"抽样数"去卡"总数"造成假失败。
    if expect and not args.limit:
        cmd += ["--expect", str(expect)]
    code, _ = run_step("S5 校验", cmd, allow_fail=True)

    # 可选：导出 PDF，并和参考 PDF 比版式与正文覆盖
    pdf_out = (Path(args.pdf_out).resolve() if args.pdf_out
               else (out.with_suffix(".pdf") if args.compare else None))
    if pdf_out is not None and mt.exists():
        print("\n=== S6 导出 PDF ===")
        if export_pdf(mt, pdf_out):
            print(f"  → {pdf_out}")
            if args.compare:
                run_step("S6 与参考 PDF 对比", [
                    py, HERE / "compare_pdf.py", Path(args.compare).resolve(),
                    pdf_out, "--json", build / "compare.json"], allow_fail=True)

    if mt.exists():
        out.parent.mkdir(parents=True, exist_ok=True)
        if out != mt:
            out.write_bytes(mt.read_bytes())
        print(f"\n交付文件: {out}")
    print(f"中间产物: {build}")
    if code != 0:
        print("校验未通过，先看 build/audit.md 与 mathtype-report.json 里的失败清单")
    return code


if __name__ == "__main__":
    sys.exit(main())
