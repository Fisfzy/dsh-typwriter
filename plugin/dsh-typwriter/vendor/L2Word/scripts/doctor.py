#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L2word-mathtype · 环境体检

回答一个问题：这台机器现在能走到流水线的第几步。
只读，不修改任何系统状态。

用法:
    python doctor.py
    python doctor.py --json
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

try:
    import winreg
except ImportError:  # pragma: no cover - 非 Windows
    winreg = None


def _roots() -> list[Path]:
    roots = []
    for env in ("ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"):
        v = os.environ.get(env)
        if v:
            roots.append(Path(v))
    for drive in "CDEFG":
        p = Path(f"{drive}:/")
        if p.exists():
            roots.append(p)
    seen, uniq = set(), []
    for r in roots:
        if r not in seen:
            seen.add(r)
            uniq.append(r)
    return uniq


def find_mathtype() -> Path | None:
    """定位 MathType 安装根目录（含 MathType.exe 的那一层）。"""
    # 1) 注册表优先
    if winreg:
        for hive, key in (
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Classes\Equation.DSMT4\shell\Open\command"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Classes\Equation.DSMT4\shell\Open\command"),
        ):
            try:
                with winreg.OpenKey(hive, key) as k:
                    cmd = winreg.QueryValueEx(k, "")[0]
                exe = Path(cmd.strip('"').split('"')[0])
                if exe.exists():
                    return exe.parent
            except OSError:
                pass
    # 2) 常见路径
    for root in _roots():
        if root.name in {"Program Files", "Program Files (x86)"}:
            cand = root / "MathType"
            if (cand / "MathType.exe").exists():
                return cand
        # 3) 浅层递归兜底（MathType.exe 直接装在盘根的情况）
        try:
            for exe in root.glob("*/MathType.exe"):
                return exe.parent
            for exe in root.glob("MathType.exe"):
                return exe.parent
        except OSError:
            continue
    return None


def find_sdk_dll(mt_dir: Path | None) -> tuple[Path | None, str]:
    """返回 (dll 路径, 位数说明)。位数必须和 Python 一致。"""
    if mt_dir is None:
        return None, "unknown"
    py_bits = struct.calcsize("P") * 8
    candidates = [
        (mt_dir / "System" / "64" / "MT6.dll", 64),
        (mt_dir / "System" / "32" / "MT6.dll", 32),
        (mt_dir / "System" / "MT6.dll", None),  # 老版本布局
    ]
    found = []
    for p, bits in candidates:
        if p.exists():
            found.append((p, bits))
    for p, bits in found:
        if bits == py_bits or bits is None:
            return p, f"{bits or '?'}-bit"
    if found:
        return found[0][0], f"{found[0][1]}-bit (与 Python {py_bits}-bit 不匹配)"
    return None, "missing"


def word_info() -> dict:
    info = {"registered": False, "version": None, "addin": False}
    if not winreg:
        return info
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Classes\Word.Application\CurVer") as k:
            info["version"] = winreg.QueryValueEx(k, "")[0]
            info["registered"] = True
    except OSError:
        pass
    appdata = os.environ.get("APPDATA")
    if appdata:
        startup = Path(appdata) / "Microsoft" / "Word" / "STARTUP"
        if startup.exists():
            info["addin"] = any("MathType" in f.name for f in startup.iterdir())
            info["startup_dir"] = str(startup)
            info["startup_files"] = [f.name for f in startup.iterdir()]
    return info


def module_ok(*names: str) -> bool:
    """任一模块可导入即通过（fitz / pymupdf 这类改名的包）。"""
    import importlib.util

    return any(importlib.util.find_spec(n) is not None for n in names)


def find_interpreters() -> list[dict]:
    """这台机器上所有 Python，以及各自能不能跑 COM。

    机器上常有好几套 Python：编辑器/IDE 自带的那套往往没装 pywin32，
    系统装的才有。流水线必须用后者，否则 win32com 直接崩。
    """
    cands: list[Path] = [Path(sys.executable)]
    for root in _roots():
        if root.name in {"Program Files", "Program Files (x86)"}:
            cands.extend(root.glob("Python3*/python.exe"))
    local = os.environ.get("LOCALAPPDATA")
    if local:
        cands.extend((Path(local) / "Programs" / "Python").glob("Python3*/python.exe"))
    out, seen = [], set()
    for p in cands:
        try:
            key = p.resolve()
        except OSError:
            continue
        if key in seen or not p.exists():
            continue
        seen.add(key)
        try:
            res = subprocess.run(
                [str(p), "-c", "import sys,importlib.util as u;"
                 "print(sys.version.split()[0]+'|'+str(sys.maxsize>2**32));"
                 "print(','.join(m for m in ('win32com','lxml','docx') if u.find_spec(m)))"],
                capture_output=True, text=True, timeout=20,
            )
            lines = (res.stdout or "").strip().splitlines()
            mods = lines[1].split(",") if len(lines) > 1 and lines[1] else []
            out.append({
                "path": str(p),
                "version": lines[0].split("|")[0] if lines else "?",
                "bit64": lines[0].endswith("True") if lines else None,
                "pywin32": "win32com" in mods,
                "ready": len(mods) == 3,
            })
        except Exception as exc:  # noqa: BLE001
            out.append({"path": str(p), "version": "?", "error": str(exc)})
    return out


def cli_version(cmd: str, args: list[str]) -> str | None:
    exe = shutil.which(cmd)
    if not exe:
        return None
    try:
        out = subprocess.run([exe, *args], capture_output=True, text=True, timeout=15)
        return (out.stdout or out.stderr).strip().splitlines()[0]
    except Exception:
        return exe


def find_addin_dotm(mt_dir: Path | None) -> Path | None:
    """MathType 自带的 Word 加载项模板（Toggle TeX / Convert Equations 的实现）。"""
    cands: list[Path] = []
    if mt_dir:
        # 版本号大的优先（2016 > 2013 > 2010），避免误报旧模板
        cands += sorted((mt_dir / "Office Support").glob("**/MathType Commands*.dotm"),
                        reverse=True)
        cands += sorted((mt_dir / "Office Support").glob("MathType Commands*.dotm"),
                        reverse=True)
    return cands[0] if cands else None


def collect() -> dict:
    mt = find_mathtype()
    dll, dll_bits = find_sdk_dll(mt)
    py_bits = struct.calcsize("P") * 8
    report = {
        "mathType": {
            "dir": str(mt) if mt else None,
            "sdk_dll": str(dll) if dll else None,
            "sdk_bitness": dll_bits,
            "prog_id": None,
            "addin_dotm": str(find_addin_dotm(mt)) if find_addin_dotm(mt) else None,
        },
        "python": {"version": sys.version.split()[0], "bitness": py_bits, "executable": sys.executable},
        "word": word_info(),
        "deps": {
            "pywin32": module_ok("win32com"),
            "lxml": module_ok("lxml"),
            "python-docx": module_ok("docx"),
            "PyMuPDF": module_ok("fitz", "pymupdf"),
        },
        "interpreters": find_interpreters(),
        "tools": {
            "pandoc": cli_version("pandoc", ["--version"]),
            "xelatex": cli_version("xelatex", ["--version"]),
            "tex2word": cli_version("tex2word", ["--version"]),
        },
    }
    if winreg:
        try:
            with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r"Equation.DSMT4\shell\Open\command") as k:
                report["mathType"]["prog_id"] = winreg.QueryValueEx(k, "")[0]
        except OSError:
            pass
    return report


def verdict(r: dict) -> tuple[list[str], list[str]]:
    ok, block = [], []
    if r["mathType"]["dir"]:
        ok.append(f"MathType 已安装: {r['mathType']['dir']}")
    else:
        block.append("未找到 MathType 安装 —— 后端无法落地，必须先装 MathType 7 桌面完整版")

    if r["mathType"]["prog_id"]:
        ok.append("ProgID Equation.DSMT4 已注册（可创建 MathType OLE 对象）")
    else:
        block.append("Equation.DSMT4 未注册 —— Word 无法创建 MathType OLE 对象")

    if r["word"]["registered"]:
        ok.append(f"Word 已注册: {r['word']['version']}")
    else:
        block.append("未检测到桌面版 Word（LibreOffice/WPS 不替代）")

    # 加载项是 S4 的唯一稳定通道：Toggle TeX 宏必须在会话里可见
    if r["mathType"].get("addin_dotm"):
        ok.append(f"加载项模板存在: {Path(r['mathType']['addin_dotm']).name}")
    else:
        block.append("MathType 安装目录里没有 Office Support\\*\\MathType Commands*.dotm —— "
                     "安装不完整，需要修复安装")

    if r["word"].get("addin"):
        ok.append("加载项已在 Word STARTUP 中（Toggle TeX / Convert Equations 菜单可用）")
    else:
        dotm = r["mathType"].get("addin_dotm")
        hint = (f'把 "{dotm}" 复制到 {r["word"].get("startup_dir", "%APPDATA%\\Microsoft\\Word\\STARTUP")}'
                if dotm else "先修复 MathType 安装")
        block.append("加载项不在 Word STARTUP 中 —— S4 无法调用 Toggle TeX。" + hint)

    for m, v in r["deps"].items():
        if v:
            ok.append(f"当前解释器依赖 {m} 就绪")
        elif m == "PyMuPDF":
            ok.append("PyMuPDF 未装（仅影响 PDF 抽查，可选）")
        elif m == "pywin32":
            alts = [i for i in r.get("interpreters", []) if i.get("ready")] or \
                   [i for i in r.get("interpreters", []) if i.get("pywin32")]
            if alts:
                block.append(f"当前解释器没有 pywin32；改用 {alts[0]['path']} 运行流水线")
            else:
                block.append("全机找不到装了 pywin32 的 Python（pip install pywin32）")
        else:
            block.append(f"缺少 Python 依赖 {m}（pip install {m}）")

    if r["tools"]["pandoc"]:
        ok.append(f"pandoc 就绪（{r['tools']['pandoc']}）—— S3 骨架转换必需")
    else:
        block.append("未找到 pandoc —— S3 无法生成 docx（winget install JohnMacFarlane.Pandoc）")

    if r["tools"]["xelatex"]:
        ok.append("xelatex 就绪（TikZ 预渲染 / 排版核对用）")
    if r["mathType"].get("sdk_dll"):
        ok.append(f"SDK DLL 也在（{r['mathType']['sdk_bitness']}）：仅作备用，"
                  "本流水线不依赖它")
    return ok, block


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="只输出 JSON")
    args = ap.parse_args()

    r = collect()
    if args.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return 0

    ok, block = verdict(r)
    print("=" * 62)
    print(" L2word-mathtype · 环境体检")
    print("=" * 62)
    for line in ok:
        print(f"  [OK]   {line}")
    for line in block:
        print(f"  [STOP] {line}")
    print("-" * 62)
    if block:
        print(f" 结论：{len(block)} 项阻塞，先修复再跑流水线。")
        return 1
    print(" 结论：S1 审计 / S2 抽公式 / S3 建 docx / S4 转 MathType / S5 校验 全部可执行。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
