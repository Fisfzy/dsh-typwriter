#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""L2word-mathtype · S4 落地 MathType：用官方宏批量转换 LaTeX 文本。

为什么不用 SDK 的 MTSetEqnFromLangStr：
    本机实测它在「没有 Word 加载项」的上下文里状态不确定，同一份代码
    时而返回 0、时而 -9999，还会 access violation。不适合无人值守批量跑。
    真正稳定的是 MathType 自己的 Word 宏 MTCommand_TeXToggle（等于菜单里
    的 Toggle TeX），它把选区里的 $...$ / \\[...\\] 原地换成 MathType 对象。

机制：
    1. Word 以 AutomationSecurity=1 启动（允许宏），隐藏窗口；
    2. 若 STARTUP 里没有加载项，就把 .dotm 当文档载入，让宏在当前会话可见；
    3. 第一轮「整段」：倒序逐段整段 toggle，跳过已经含对象的段落（快）；
    4. 第二轮起「精确」：只框住段落里最后一个还没转的公式，转完重取边界再迭代，
       可以反复调用直到收敛（概率性失败靠多轮吃掉）；
    5. 最后按"还剩多少 $..."核对，如实报告。

为什么不是"全选转一次"：`MTCommand_TeXToggle` 是**切换**语义——对已经转好的
内容再运行一次会把 MathType 对象还原成 LaTeX 文本。整篇全选实测 140 条只吃下
66 条；再跑一轮不但不收敛，还会把已转的又打回原形（残留从 74 涨到 140）。

为什么第二轮按分隔符定位、而不是按文本下标算 Range：Range.Text 里一个 MathType
对象会展开成" Embedded Equation.DSMT4 \\x01" 三十来个字符，但在 Word 的位置空间
里只占 1 个位置单位——实测 5 个对象、len=22、跨度=152，每个多占 26。段内已有
对象时，"下标 + 偏移"必然算歪，而选歪的后果是把隔壁已经转好的对象 toggle 回
LaTeX（旧实现实测：精确轮 ok 计数 3+4+5=12，残留却从 4 涨到 5）。

已知限制：单条公式有长度上限（实测 452 字过、508 字挂，而且失败是静默的）。
超长的多行公式在 S3 已由 `tex_macros.split_long_display()` 拆成几段。

用法:
    python to_mathtype.py base.docx -o out.docx
    python to_mathtype.py base.docx -o out.docx --report report.json --limit 5
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

DOTM_CANDIDATES = [
    Path(os.environ.get("APPDATA", "")) / "Microsoft/Word/STARTUP/MathType Commands 2016.dotm",
    Path(r"D:\Program Files (x86)\Office Support\64/MathType Commands 2016.dotm"),
    Path(r"C:\Program Files (x86)\Office Support\64/MathType Commands 2016.dotm"),
    Path(r"D:\Program Files (x86)\Office Support/MathType Commands 2016.dotm"),
]
MACRO = "MTCommand_TeXToggle"

FORMULA_RE = re.compile(r"\$[^$]+\$|\\\[[\s\S]+?\\\]")

# 段落/单元格的收尾控制符：\r 段落标记、\x07（\a）单元格标记、\x0b 手动换行。
# 表格单元格里的段落 Range.Text 是 "公式\r\x07"，整段操作会让 Word 报
# 「此操作对行结尾无效」，把 \x07 原样写回去还会被当成单元格标记。
CTRL_TAIL = re.compile(r"[\r\x07\x0b\x0c]+$")

# 行间公式的段前/段后留白（pt）。必须与 build_docx.DISPLAY_SPACE 一致：
# LaTeX 10pt 正文下 \abovedisplayskip / \belowdisplayskip 各约 10pt。
DISPLAY_SPACE_PT = 10.0

# "整段就是一条公式"的段落：除了制表符、公式对象（\x01）、编号数字和括号，没有别的字
_DISPLAY_ONLY = re.compile(r"^[\t \d()（）]*$")


def count_formulas(text: str) -> int:
    return len(FORMULA_RE.findall(text))


def find_dotm() -> Path | None:
    for p in DOTM_CANDIDATES:
        if p.exists():
            return p
    return None


def word_safe(path: Path, must_exist: bool = True) -> Path:
    """Word 拒绝打开含“.”开头目录的路径（报“不是有效文件名”），先转到临时目录。"""
    if any(part.startswith(".") and part not in (".", "..") for part in path.parts[:-1]):
        import shutil
        import tempfile
        tmp = Path(tempfile.mkdtemp(prefix="l2w-")) / path.name
        if must_exist:
            shutil.copy2(path, tmp)
        return tmp
    return path


def has_formula(p) -> bool:
    t = p.Range.Text
    return ("$" in t) or ("\\[" in t)


def startup_dotm() -> Path | None:
    p = DOTM_CANDIDATES[0]
    return p if p.exists() else None


def convert(src: Path, dest: Path, report: dict, limit: int | None,
            macro_retry: bool) -> dict:
    import win32com.client as win32

    tpl = None
    doc = None
    word = win32.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    try:
        word.AutomationSecurity = 1          # 允许宏，避免安全提示阻塞
    except Exception:  # noqa: BLE001
        pass

    t0 = time.time()
    staged_src = word_safe(src)
    staged_dest = word_safe(dest, must_exist=False)
    if staged_src != src:
        report["staged_src"] = str(staged_src)
    try:
        # STARTUP 里的模板会随 Word 启动自动加载；没装才显式打开 .dotm。
        # 不能"先空跑一次 Run 试探"——没有文档时 Run 会弹框，导致隐藏窗口卡死。
        if startup_dotm() is not None:
            report["macro_loaded_by"] = "STARTUP"
        else:
            dotm = find_dotm()
            if dotm is None:
                raise RuntimeError("找不到 MathType Commands *.dotm，先跑 doctor.py")
            tpl = word.Documents.Open(str(dotm), ReadOnly=True, AddToRecentFiles=False)
            report["dotm"] = str(dotm)
            report["macro_loaded_by"] = "explicit-open"

        doc = word.Documents.Open(str(staged_src), ReadOnly=False, AddToRecentFiles=False)

        # 1) 快照：哪些段落有公式、各应产生几个对象
        todo = []
        total_paras = doc.Paragraphs.Count
        for i in range(1, total_paras + 1):
            para = doc.Paragraphs(i)
            text = para.Range.Text
            n = count_formulas(text)
            if n:
                todo.append({"index": i, "count": n,
                             "text": CTRL_TAIL.sub("", text)})
        if limit:
            todo = todo[:limit]
        report["paragraphs"] = len(todo)
        report["expected"] = sum(t["count"] for t in todo)
        if not todo:
            report["note"] = "文档里没有找到 $...$ 或 \\[...\\] 公式"
            dest.parent.mkdir(parents=True, exist_ok=True)
            doc.SaveAs2(str(staged_dest), FileFormat=16)
            doc.Close(SaveChanges=0)
            doc = None
            if staged_dest != dest:
                dest.parent.mkdir(parents=True, exist_ok=True)
                Path(staged_dest).replace(dest)
            return report

        # 2) 两段式转换
        #    MathType 的 Toggle 是**切换**语义：对已经转好的内容再运行一次，
        #    会把 MathType 对象还原成 LaTeX 文本。所以任何"整篇重跑"的写法
        #    都在自相残杀——实测整篇全选一次 140 条只吃下 66 条，再跑一轮
        #    反而把已转的又打回原形（残留从 74 涨到 140）。
        #    这里拆成两轮：干净段落整段 toggle（快），残留段落逐条精确选区。
        skip: set[str] = set()
        passes = []

        a = convert_pass(doc, word, 0.5)
        left = count_formulas(doc.Content.Text)
        passes.append({"round": "整段", "ok": a["ok"], "bad": a["bad"], "left": left})

        # MathType 会概率性失败（同一份内容时过时不过），所以精确轮跑多轮收敛。
        # 每轮只碰还没转的 `$...$`，不会重复 toggle 已转换的对象。
        if left:
            rounds = 3 if macro_retry else 1
            for rnd in range(1, rounds + 1):
                b = precise_pass(doc, word, 0.5)
                new_left = count_formulas(doc.Content.Text)
                passes.append({"round": f"精确{rnd}", "ok": b["ok"],
                               "bad": b["bad"], "left": new_left})
                left = new_left
                if new_left == 0:
                    break

        report["passes"] = passes
        report["skipped"] = sorted(skip)[:20]
        report["seconds_pass1"] = round(time.time() - t0, 1)

        # 2.5) 补回行间公式的段前/段后（Toggle 会把 S3 设的间距清掉）
        report["display_paragraphs_respaced"] = restore_display_spacing(doc)

        # 3) 核对：只认"还留在正文里的 $..."，不认段落序号
        #    MathType 转换行间公式时会把公式段并进上一段，段落总数会变；
        #    拿转换前的 index 回头核对会张冠李戴（实测把已经转好的判成失败，
        #    报告写"成功 3 / 失败 3"，其实 6 个全转好了）。
        residual = scan_todo(doc)
        converted = report["expected"] - sum(r["count"] for r in residual)
        report["converted_pass1"] = converted
        report["converted"] = converted
        report["failed_count"] = report["expected"] - converted
        report["failures"] = [{"left": r["count"], "text": r["text"][:160]}
                              for r in residual][:20]

        dest.parent.mkdir(parents=True, exist_ok=True)
        doc.SaveAs2(str(staged_dest), FileFormat=16)
        # 必须先关文档再搬文件，否则 Word 仍持有句柄（WinError 32）
        doc.Close(SaveChanges=0)
        doc = None
        if staged_dest != dest:
            dest.parent.mkdir(parents=True, exist_ok=True)
            Path(staged_dest).replace(dest)
        # SaveAs2 失败时 Word 也可能不抛异常，只是没写出文件。这里硬校验一次，
        # 否则调用方会拿到"成功"却找不到产物。
        if not dest.exists():
            raise RuntimeError(f"Word 报告保存成功，但文件不存在：{dest}")
        report["saved"] = str(dest)
    finally:
        if doc is not None:
            try:
                doc.Close(SaveChanges=0)
            except Exception:  # noqa: BLE001
                pass
        if tpl is not None:
            try:
                tpl.Close(SaveChanges=0)
            except Exception:  # noqa: BLE001
                pass
        try:
            word.Quit()
        except Exception:  # noqa: BLE001
            pass
        report["seconds"] = round(time.time() - t0, 1)
    return report


def scan_todo(doc) -> list[dict]:
    """当前文档里所有还含 `$...$` / `\\[...\\]` 的段落（序号是**当下**的）。"""
    out = []
    for i in range(1, doc.Paragraphs.Count + 1):
        text = doc.Paragraphs(i).Range.Text
        n = count_formulas(text)
        if n:
            out.append({"index": i, "count": n, "text": CTRL_TAIL.sub("", text)})
    return out


def _formula_paras(doc) -> list[int]:
    """当前还含 `$...$` / `\\[...\\]` 的段落号（现取现用，不缓存）。"""
    out = []
    for i in range(1, doc.Paragraphs.Count + 1):
        try:
            if FORMULA_RE.search(doc.Paragraphs(i).Range.Text):
                out.append(i)
        except Exception:  # noqa: BLE001
            continue
    return out


# wdAlignParagraphCenter / Left
_ALIGN_CENTER, _ALIGN_LEFT = 1, 0


def _uncenter(para) -> bool:
    """转换前把居中的段落临时改成左对齐，返回是否改过。

    这是本机踩出来的坑：**居中的表格单元格里 TeXToggle 一定失败**，而且失败时
    还会往正文插一个句点。同一份 `$u_x$ (m)` 放在左对齐的单元格里立刻成功
    （对象 1 个），改回居中后对象也还在。所以只是在转换那一刻避开居中，
    转完立刻还原，最终版式不受影响。
    """
    try:
        if para.Alignment == _ALIGN_CENTER:
            para.Alignment = _ALIGN_LEFT
            return True
    except Exception:  # noqa: BLE001
        pass
    return False


def _recenter(doc, idx: int) -> None:
    try:
        p = doc.Paragraphs(idx)
        if p.Range.Information(12):      # 只还原表格里的段落
            p.Alignment = _ALIGN_CENTER
    except Exception:  # noqa: BLE001
        pass


def convert_pass(doc, app, delay: float) -> dict:
    """第一轮：倒序逐段整段 toggle。

    为什么倒序：转换行间公式会把公式段并进上一段，正序处理时段号会整体漂移。
    倒序时处理段 i 只影响 i 之前，待处理的 i-1 段号不变。

    为什么跳过"段里已经有对象"的段落：Toggle 是**切换**语义，
    对含 MathType 对象的段落再跑一次会把那些对象还原成 LaTeX 文本
    （实测一段 14 个对象被整段还原成 15 条 $...$）。这类段落留给第二轮。
    """
    ok = bad = 0
    for i in reversed(_formula_paras(doc)):
        try:
            para = doc.Paragraphs(i)
            rng = para.Range
            if rng.InlineShapes.Count:
                continue
            if not FORMULA_RE.search(rng.Text):
                continue
            changed = _uncenter(para)
            try:
                rng.Select()
                app.Run(MACRO)
            finally:
                if changed:
                    _recenter(doc, i)
        except Exception:  # noqa: BLE001
            bad += 1
            continue
        ok += 1
        if delay:
            time.sleep(delay)
    return {"ok": ok, "bad": bad}


def _find_last(doc, needle: str, lo: int, hi: int):
    """在 [lo, hi) 里找 needle **最后一次**出现的位置，找不到返回 None。

    用 Find 而不是算字符下标：Range.Text 里一个 MathType 对象只占 1 个 \x01，
    但在 Word 的位置空间里占 27 个（实测 5 个对象、len=22、跨度=152，
    每个多占 26）。段内已经有对象时，任何"文本下标 + 偏移"都会算歪，
    选歪的后果不是失败，而是把隔壁已经转好的对象又 toggle 回 LaTeX。
    Find 直接返回真实位置，没有这个坑。

    Wrap=0 也不保险——实测它会绕回文首，所以命中位置越界时按"没找到"处理。
    """
    r = doc.Range(lo, hi)
    f = r.Find
    f.ClearFormatting()
    f.Text = needle
    f.Forward = False              # 倒着找：先办靠后的公式，前面的位置不受影响
    f.Wrap = 0
    f.MatchCase = True
    f.MatchWildcards = False
    try:
        if not f.Execute():
            return None
    except Exception:  # noqa: BLE001
        return None
    if r.Start < lo or r.Start >= hi:
        return None
    return r.Start


def _last_formula_range(doc, lo: int, hi: int):
    """定位段落里**最后一个**公式的 Range。

    只找分隔符（`$` / `\\[` / `\\]`）不碰公式正文：正文里的 `^` 会被 Word 的
    Find 当成特殊字符（`^p`、`^9` 之类），拿整条公式当查找串并不可靠，
    而且 Find.Text 有 255 字上限。分隔符本身没有这些麻烦。
    """
    pd = _find_last(doc, "$", lo, hi)
    pb = _find_last(doc, "\\]", lo, hi)
    if pd is None and pb is None:
        return None
    if pb is not None and (pd is None or pb > pd):
        p_open = _find_last(doc, "\\[", lo, pb)
        if p_open is None:
            return None
        return doc.Range(p_open, pb + 2)
    p_open = _find_last(doc, "$", lo, pd)
    if p_open is None:
        return None
    return doc.Range(p_open, pd + 1)


def precise_pass(doc, app, delay: float) -> dict:
    """第二轮：对仍然残留的公式逐条精确选区重转。

    每轮只框住"最后一个还没转的公式"，转完重新取一遍段落边界再来一次，
    直到这一段里再没有 `$...$` / `\\[...\\]`。倒序处理既保证靠前公式的位置
    不受影响，也天然适配"同一段里有重复公式"的情况。

    为什么选中的范围必须精确到公式本身：Toggle 是**切换**语义，选区只要蹭到
    已经转好的对象，那个对象就会被还原成 LaTeX 文本。旧实现按"文本下标 ×
    26 偏移"硬算位置，蹭错是常态——实测三轮精确轮 ok 计数 3+4+5=12，
    残留却从 4 涨到 5，等于每轮都在自相残杀。改成按分隔符定位后就不再蹭边。

    失败是概率性的（同一份内容时过时不过），所以这一轮可以被反复调用，
    靠多轮收敛；重试是安全的，因为它只会碰还没转的那些。
    """
    ok = bad = 0
    for i in reversed(_formula_paras(doc)):
        try:
            para = doc.Paragraphs(i)
            changed = _uncenter(para)
            before = count_formulas(doc.Paragraphs(i).Range.Text)
        except Exception:  # noqa: BLE001
            continue
        try:
            for _ in range(60):                      # 防御：单段公式数上限
                try:
                    para = doc.Paragraphs(i)
                    lo, hi = para.Range.Start, para.Range.End
                except Exception:  # noqa: BLE001
                    break
                rng = _last_formula_range(doc, lo, hi)
                if rng is None:
                    break
                try:
                    rng.Select()
                    app.Run(MACRO)
                except Exception:  # noqa: BLE001
                    bad += 1
                    break
                if delay:
                    time.sleep(delay)
                try:
                    after = count_formulas(doc.Paragraphs(i).Range.Text)
                except Exception:  # noqa: BLE001
                    after = before - 1
                if after < before:
                    ok += 1
                    before = after
                else:
                    bad += 1
                    break
        finally:
            if changed:
                _recenter(doc, i)
    return {"ok": ok, "bad": bad}


def restore_display_spacing(doc, space_pt: float = DISPLAY_SPACE_PT) -> int:
    """把行间公式段的段前/段后补回来，返回处理的段数。

    **Toggle TeX 会重写公式段的段落属性**：S3 在 base.docx 里设好的 10pt 段前/段后，
    转完 MathType 就变成"继承样式"，而 MTDisplayEquation 样式自带只有段后 3pt。
    不补的话整篇比参考 PDF 短 5cm 左右，刚好差一整页（实测 153cm vs 158cm）。

    连续几段其实是同一个超长公式被拆开的，只在首段留"段前"、末段留"段后"，
    中间贴紧——否则一个公式内部会冒出 20pt 的空档。
    """
    total = doc.Paragraphs.Count
    is_disp: dict[int, bool] = {}
    for i in range(1, total + 1):
        try:
            p = doc.Paragraphs(i)
            text = CTRL_TAIL.sub("", p.Range.Text).replace("\x01", "")
            is_disp[i] = bool(p.Range.InlineShapes.Count) and bool(_DISPLAY_ONLY.match(text))
        except Exception:  # noqa: BLE001
            is_disp[i] = False

    n = 0
    for i, disp in is_disp.items():
        if not disp:
            continue
        try:
            p = doc.Paragraphs(i)
            p.SpaceBefore = 0 if is_disp.get(i - 1) else space_pt
            p.SpaceAfter = 0 if is_disp.get(i + 1) else space_pt
            n += 1
        except Exception:  # noqa: BLE001
            continue
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description="把 docx 里的 LaTeX 文本批量转成 MathType")
    ap.add_argument("docx")
    ap.add_argument("-o", "--out")
    ap.add_argument("--report")
    ap.add_argument("--limit", type=int,
                    help="只核对前 N 个含公式段落（整篇仍会一次转换，只是抽样验收）")
    ap.add_argument("--no-retry", action="store_true",
                    help="只跑一轮（默认对失败的会换更长间隔再试一次）")
    args = ap.parse_args()

    src = Path(args.docx).resolve()
    if not src.exists():
        print(f"文件不存在: {src}")
        return 1
    # 必须 resolve：Word 的 SaveAs2 是按 Word 自己的当前目录解析相对路径的，
    # 传 "out.docx" 会悄悄存到「我的文档」里，脚本还照常打印成功。
    dest = (Path(args.out).resolve() if args.out
            else src.with_name(src.stem + "-MathType.docx"))

    report: dict = {"src": str(src), "dest": str(dest)}
    try:
        report = convert(src, dest, report, args.limit, not args.no_retry)
    except Exception as exc:  # noqa: BLE001
        print(f"中止: {type(exc).__name__}: {exc}")
        if args.report:
            Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2),
                                         encoding="utf-8")
        return 2

    if args.report:
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2),
                                     encoding="utf-8")

    print(f"含公式段落 {report.get('paragraphs', 0)} 个，"
          f"应转 {report.get('expected', 0)} 个公式")
    print(f"成功 {report.get('converted', 0)}，失败 {report.get('failed_count', 0)}，"
          f"耗时 {report.get('seconds')}s")
    if report.get("failures"):
        print("失败样例（仍留有 LaTeX 分隔符的段落）：")
        for f in report["failures"][:5]:
            print(f"  剩{f.get('left', '?')} 条: {f['text'][:80]}")
    if report.get("saved"):
        print(f"→ {report['saved']}")
    return 0 if not report.get("failed_count") else 3


if __name__ == "__main__":
    sys.exit(main())
