#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""验证 MathType 加载项里的 TeX 切换宏（MTCommand_TeXToggle）能否批量转换。

不写注册表：只用 Documents.Open 把 .dotm 载入当前 Word 会话，
宏随之可见，Application.Run 即可调用。会话结束即失效。

这关系到「不经过 OMML、直接把 LaTeX 源码变成 MathType 对象」是否成立。
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

DOTM = Path(r"D:\Program Files (x86)\Office Support\64\MathType Commands 2016.dotm")
SAMPLES = [
    "$E=mc^2$",
    r"$\frac{-b\pm\sqrt{b^2-4ac}}{2a}$",
    r"$\sum_{i=1}^{n}i^2$",
    r"$\begin{array}{c}a=b\\ c=d\end{array}$",
]


def count_ole(doc) -> tuple[int, list[str]]:
    n, progs = 0, []
    for s in doc.InlineShapes:
        try:
            if s.Type == 1:  # wdInlineShapeEmbeddedOLEObject
                p = s.OLEFormat.ProgID
                progs.append(p)
                if p == "Equation.DSMT4":
                    n += 1
        except Exception:  # noqa: BLE001
            pass
    return n, progs


def main() -> int:
    import win32com.client as win32

    if not DOTM.exists():
        print(f"模板不存在: {DOTM}")
        return 1
    word = win32.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    try:
        word.AutomationSecurity = 1  # 允许宏运行，避免弹出安全提示
    except Exception as exc:  # noqa: BLE001
        print(f"设置 AutomationSecurity 失败: {exc}")

    tpl = None
    doc = None
    result = {"dotm": str(DOTM), "macros": [], "steps": []}
    try:
        tpl = word.Documents.Open(str(DOTM), ReadOnly=True, AddToRecentFiles=False)
        result["tpl_opened"] = True
        # 列出可用宏（VBProject 只支持 .docm/.dotm）
        try:
            comps = [c.Name for c in tpl.VBProject.VBComponents]
            result["components"] = comps
            mods = [m.Name for m in tpl.VBProject.VBComponents]
            result["modules"] = mods
        except Exception as exc:  # noqa: BLE001
            result["vbproject_error"] = str(exc)

        doc = word.Documents.Add()
        doc.Content.Text = "公式：" + " 与 ".join(SAMPLES)
        doc.Content.Select()
        before, _ = count_ole(doc)
        result["before_ole"] = before

        for macro in ("MTCommand_TeXToggle", "MathTypeCommands.MTCommand_TeXToggle",
                      "MTCommand_TeXToMathType"):
            try:
                word.Run(macro)
                time.sleep(1.0)
                after, progs = count_ole(doc)
                result["steps"].append({"macro": macro, "after_ole": after, "progs": progs})
                if after > before:
                    result["works"] = macro
                    break
            except Exception as exc:  # noqa: BLE001
                result["steps"].append({"macro": macro, "error": f"{type(exc).__name__}: {exc}"})
        result["text_after"] = doc.Content.Text[:200]
    except Exception as exc:  # noqa: BLE001
        result["fatal"] = f"{type(exc).__name__}: {exc}"
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

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("works") else 1


if __name__ == "__main__":
    sys.exit(main())
