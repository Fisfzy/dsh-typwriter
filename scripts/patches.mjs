#!/usr/bin/env node
// 可审计的上游补丁清单。
//
// 为什么需要它：之前每次改动都是临时字符串替换脚本，锚点没匹配也"静默成功"，
// 一旦上游代码变了就悄悄没打上（或打歪），最后表现为"稍微一改就全盘爆炸"。
//
// 这份清单的原则：
//   1. 每条补丁必须说明 file + 用 search 精确定位（不用行号，上游一挪就失效）
//   2. search 必须恰好命中 1 次；0 次或多次都视为失败并报出来
//   3. `npm run patch:check` 只校验不写，`patch:apply` 才写；幂等（已打过就跳过）
//
// 用法：
//   node scripts/patches.mjs --check    只校验
//   node scripts/patches.mjs --apply    应用（幂等）
//   node scripts/patches.mjs --list     列出全部补丁
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const APP = "apps/texpile-editor/src";

/** @type {{id:string, why:string, file:string, search:string, replace:string}[]} */
export const PATCHES = [
  // ---------- 品牌与语言 ----------
  {
    id: "brand.window-title",
    why: "窗口标题里的产品名：Texpile → Typwriter",
    file: `${APP}/views/workspace/WorkspaceView.svelte`,
    search: "${basename(workspaceRoot.current)} - Texpile`",
    replace: "${basename(workspaceRoot.current)} - Typwriter`"
  },
  {
    id: "i18n.default-locale",
    why: "新装默认简体中文",
    file: `${APP}/lib/settings.ts`,
    search: "uiLocale: 'en',",
    replace: "uiLocale: 'zh-Hans',"
  },

  // ---------- 宿主桥接（web 版必需） ----------
  {
    id: "bridge.file-url",
    why: "texfile:// 换成同源 HTTP 路由（web 宿主没有自定义协议）",
    file: `${APP}/lib/workspace/fileSystem.ts`,
    search: "return `texfile://local/?path=${encodeURIComponent(path)}`;",
    replace: "return `/typwriter/api/file?path=${encodeURIComponent(path)}`;"
  },

  // ---------- 代理（DSH） ----------
  {
    id: "agent.panel-presets",
    why: "把 dsh 加进 Agent 面板的预设清单",
    file: `${APP}/lib/ai/agentPanel/agentNames.ts`,
    search: "export const PANEL_PRESETS: PresetPanelAgent[] = ['codex', 'claude', 'opencode', 'copilot', 'gemini'];",
    replace: "export const PANEL_PRESETS: PresetPanelAgent[] = ['dsh', 'codex', 'claude', 'opencode', 'copilot', 'gemini'];"
  },
  {
    id: "agent.panel-type",
    why: "PanelAgent 联合类型加 dsh",
    file: `${APP}/lib/ai/agentPanel/agentPanel.types.ts`,
    search: "export type PanelAgent = 'codex' | 'claude' | 'opencode' | 'copilot' | 'gemini' | 'custom';",
    replace: "export type PanelAgent = 'codex' | 'claude' | 'opencode' | 'copilot' | 'gemini' | 'dsh' | 'custom';"
  },
  {
    id: "agent.refine-presets",
    why: "润色代理预设加 dsh",
    file: `${APP}/lib/ai/selectionRefiner.ts`,
    search: "export const PRESET_AGENTS: PresetAgent[] = ['claude', 'codex', 'agy'];",
    replace: "export const PRESET_AGENTS: PresetAgent[] = ['dsh', 'claude', 'codex', 'agy'];"
  },
  {
    id: "agent.refine-type",
    why: "PresetAgent 联合类型加 dsh",
    file: `${APP}/lib/ai/selectionRefiner.ts`,
    search: "export type PresetAgent = 'claude' | 'codex' | 'agy';",
    replace: "export type PresetAgent = 'claude' | 'codex' | 'agy' | 'dsh';"
  },

  // ---------- 布局：横向三栏 ----------
  {
    id: "layout.columns3-type",
    why: "新增 columns3 布局（三栏）",
    file: `${APP}/lib/workspace/groups/layouts.ts`,
    search: "export type EditorLayout = 'one' | 'columns' | 'rows' | 'grid';",
    replace: "export type EditorLayout = 'one' | 'columns' | 'columns3' | 'rows' | 'grid';"
  },
  {
    id: "layout.columns3-list",
    why: "布局列表加 columns3",
    file: `${APP}/lib/workspace/groups/layouts.ts`,
    search: "export const LAYOUTS: EditorLayout[] = ['one', 'columns', 'rows', 'grid'];",
    replace: "export const LAYOUTS: EditorLayout[] = ['one', 'columns', 'columns3', 'rows', 'grid'];"
  },

  // ---------- 本地化：Upstream 硬编码英文 ----------
  {
    id: "i18n.more-actions",
    why: "预览工具栏『…』的提示改成中文",
    file: `${APP}/lib/preview/PreviewToolbar.svelte`,
    search: "use:tip={'More actions'}",
    replace: "use:tip={'更多选项'}"
  },
  {
    id: "i18n.more-actions-aria",
    why: "同上，aria-label",
    file: `${APP}/lib/preview/PreviewToolbar.svelte`,
    search: 'aria-label="More actions"',
    replace: "aria-label={'更多选项'}"
  },
  {
    id: "i18n.invert-colors",
    why: "反转页面颜色按钮中文化",
    file: `${APP}/lib/preview/invertColors/InvertColorsItem.svelte`,
    search: "use:tip={'Invert page colors'}",
    replace: "use:tip={'反转页面颜色'}"
  }
];

/** 只校验：返回每条补丁的状态 */
export async function check(root) {
  const out = [];
  for (const p of PATCHES) {
    const abs = join(root, p.file);
    if (!existsSync(abs)) {
      out.push({ id: p.id, status: "MISSING_FILE", file: p.file });
      continue;
    }
    const text = await readFile(abs, "utf8");
    const hits = text.split(p.search).length - 1;
    const applied = text.includes(p.replace) && hits === 0;
    // 已经替换过（replace 在里面、search 不在）算 APPLIED
    if (hits === 1) out.push({ id: p.id, status: "PENDING", file: p.file });
    else if (applied) out.push({ id: p.id, status: "APPLIED", file: p.file });
    else if (hits === 0) out.push({ id: p.id, status: "ANCHOR_GONE", file: p.file, why: p.why });
    else out.push({ id: p.id, status: "AMBIGUOUS", hits, file: p.file });
  }
  return out;
}

/** 幂等应用 */
export async function apply(root) {
  const states = await check(root);
  const report = [];
  for (const p of PATCHES) {
    const st = states.find((s) => s.id === p.id)?.status;
    if (st === "APPLIED") {
      report.push({ id: p.id, did: "skip (already applied)" });
      continue;
    }
    if (st !== "PENDING") {
      report.push({ id: p.id, did: `FAILED (${st})`, file: p.file, why: p.why });
      continue;
    }
    const abs = join(root, p.file);
    const text = await readFile(abs, "utf8");
    await writeFile(abs, text.replace(p.search, p.replace), "utf8");
    report.push({ id: p.id, did: "applied" });
  }
  return report;
}

// CLI
if (process.argv[1]?.endsWith("patches.mjs")) {
  // 只有非 --flag 的参数才是根目录
  const root = process.argv.slice(2).find((a) => !a.startsWith("--")) || ".";
  const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--list") ? "list" : "check";
  if (mode === "list") {
    for (const p of PATCHES) console.log(`${p.id.padEnd(28)} ${p.file}`);
  } else if (mode === "check") {
    const r = await check(root);
    const bad = r.filter((x) => !["PENDING", "APPLIED"].includes(x.status));
    for (const x of r) console.log(`${x.status.padEnd(12)} ${x.id}`);
    console.log(`\n${r.length} 条补丁：${bad.length} 条异常`);
    process.exit(bad.length ? 1 : 0);
  } else {
    const r = await apply(root);
    for (const x of r) console.log(`${x.did.padEnd(24)} ${x.id}`);
    const failed = r.filter((x) => x.did.startsWith("FAILED"));
    console.log(`\n${r.length} 条：${failed.length} 条失败`);
    process.exit(failed.length ? 1 : 0);
  }
}
