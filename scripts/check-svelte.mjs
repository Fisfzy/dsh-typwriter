#!/usr/bin/env node
// 秒级 Svelte 结构校验。
//
// 上一轮我漏删一个 {/if}，`vite build` 跑了 75 秒才报
// `Unexpected block closing tag` —— 这类错误根本不需要完整构建就能发现。
// 这个脚本只做语法/结构 parse，几秒内把所有 .svelte 的问题列出来。
//
// 用法：node scripts/check-svelte.mjs [根目录]
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.argv[2] || "apps/texpile-editor/src";

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.name.endsWith(".svelte")) out.push(full);
  }
  return out;
}

// svelte/compiler 必须从 app 的 node_modules 解析（脚本本身在仓库根的 scripts/ 下）
import { createRequire } from "node:module";
const require_ = createRequire(join(process.cwd(), "apps/texpile-editor/package.json"));
let parse;
try {
  ({ parse } = require_("svelte/compiler"));
} catch (e) {
  console.error("找不到 svelte/compiler：", e.message);
  process.exit(2);
}

const files = await walk(root);
const bad = [];
for (const f of files) {
  const code = await readFile(f, "utf8");
  try {
    parse(code, { filename: f, modern: true });
  } catch (e) {
    bad.push({
      file: relative(process.cwd(), f),
      line: e.start?.line ?? e.line ?? "?",
      column: e.start?.column ?? e.column ?? "?",
      message: e.message
    });
  }
}

if (bad.length === 0) {
  console.log(`OK: ${files.length} 个 .svelte 文件全部通过结构校验`);
  process.exit(0);
}
console.error(`FAIL: ${bad.length}/${files.length} 个文件有问题\n`);
for (const b of bad) console.error(`  ${b.file}:${b.line}:${b.column}  ${b.message}`);
process.exit(1);
