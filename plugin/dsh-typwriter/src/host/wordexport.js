// Word 导出（L2Word-mathtype 流水线）的宿主侧：
// - doctor 体检：spawn L2Word 的 doctor.py --json，把环境五项（Word/MathType/pandoc/python/pywin32）
//   的结构化结果交回给设置面板与导出入口。
// - skill 部署：把 vendor/L2Word 的 scripts/references 复制进 DSH 的技能目录，并生成一份
//   Typst 入口的 SKILL.md——AGENT 对话驱动导出时读的就是这份操作手册。
// L2Word（MIT）本体在 vendor/L2Word，随插件分发。
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(HERE, '..', '..', 'vendor', 'L2Word');
const SKILL_DIR_NAME = 'l2word-typst';

/** 跑一段 python 脚本收集 stdout；python 不在 PATH 时给可操作的错误 */
function runPython(args, cwd, timeoutMs = 60_000) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn('python', args, { cwd, shell: true });
		} catch (e) {
			resolve({ ok: false, error: `无法启动 python：${String(e?.message || e)}` });
			return;
		}
		let out = '';
		let err = '';
		const timer = setTimeout(() => {
			child.kill();
			resolve({ ok: false, error: '体检超时（60s）' });
		}, timeoutMs);
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (err += d));
		child.on('error', (e) => {
			clearTimeout(timer);
			resolve({ ok: false, error: `python 不可用（${e.code ?? 'ENOENT'}）。请在 PATH 提供 python，或在偏好设置确认。` });
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ ok: code === 0, code, out, err });
		});
	});
}

/** 环境体检：doctor.py --json 的结构化结果（mathType/word/python/deps 各项） */
export async function doctor() {
	if (!existsSync(join(VENDOR, 'scripts', 'doctor.py'))) {
		return { ok: false, error: 'vendor/L2Word 缺失（插件安装不完整）' };
	}
	const r = await runPython(['scripts/doctor.py', '--json'], VENDOR);
	if (!r.ok && !r.out) return { ok: false, error: r.error || r.err || `doctor 退出码 ${r.code}` };
	// doctor 在缺件时也会打印 JSON（--json 分支先于退出码判定），优先解析
	const jsonStart = r.out.indexOf('{');
	if (jsonStart >= 0) {
		try {
			const report = JSON.parse(r.out.slice(jsonStart));
			return { ok: true, report, blocked: !r.ok };
		} catch {
			/* 落到通用错误 */
		}
	}
	return { ok: false, error: (r.err || r.out || '').slice(-400) || `doctor 退出码 ${r.code}` };
}

/** Typst 入口的 SKILL.md：pandoc 语际转换 + L2Word 五阶段，步骤即 AGENT 的操作手册 */
function typstSkillMarkdown(vendorSkill) {
	const upstream = vendorSkill.split('\n').slice(2).join('\n'); // 去掉原 frontmatter，正文全保留
	return `---
name: l2word-typst
description: 把 Typst 论文转换成 Word（.docx），公式落地为可双击编辑的原生 MathType 对象，全程零 OMML。当用户要求"导出 Word"、"转 docx"、"论文转 Word 且公式要 MathType 格式"、"可编辑的 Word"时使用。先 pandoc 把 Typst 转成 LaTeX，再走 L2Word 五阶段流水线。
---

# Typst → Word（MathType 公式，无 OMML）

本技能是 L2word-mathtype（同目录上游文档见文末）的 Typst 前端。输入是 Typst 论文（.typ），
第一步先做语际转换，之后完全走 L2Word 的五阶段流水线。公式落地为 Equation.DSMT4 对象——
**任何中间产物都不允许出现 OMML；交付前 verify 的 OMML 计数必须为 0。**

## 流程

### 第 0 步 · Typst → LaTeX（语际转换）

\`\`\`bash
pandoc -f typst -t latex "<论文.typ>" -o build/paper.tex
\`\`\`

- 在论文所在目录执行，图片相对路径（如 ../figures/Fig01.png）会原样保留，S3 阶段继续用。
- 转换后**必须抽查**：打开 build/paper.tex，检查 (1) 数学宏（\\mathbf/\\mathrm/上下标）；
  (2) @ref/@eq 引用——pandoc 会把它们转成字面文本 [refX] 或空 \\hyperref，需要按
  references/ 里的对照表把引用文本补回（LaTeX 侧用 \\ref 或 L2Word 的域引用）。
- 已知无伤的转换差异：Typst 的 #scale/#h 等版式微调会被丢弃（docx 不追求像素级复刻）。

### 第 1-5 步 · L2Word 五阶段

按下方上游文档执行。入口命令（在 build/ 或论文目录）：

\`\`\`bash
python scripts/doctor.py --json        # 已由宿主跑过，结果见对话上下文
python scripts/run.py build/paper.tex -o <论文.docx> --auto-style --build-dir build
\`\`\`

- 版式模式三选一：--auto-style / --style-pdf <我们导出的 PDF> / --reference-doc <模板>。
  用户给了对照 PDF 时优先 --style-pdf（最准）。
- S4（MathType 落地）是分钟级：Word 窗口会被自动操作，提醒用户勿干预；
  **每落地约 50 个公式向用户报告一次计数（如 128/296）**。
- S4 结束后读 verify 产物，**必须**把交付判定卡贴进对话：
  MathType 对象数 / OMML 残留（必须 0）/ 残留分隔符 / 题注域数 / 文献条数对账。
  OMML 残留 > 0 判定失败：列出失败公式，给出"重跑 S4 仅失败项"的命令建议。

## 硬约束（上游原文，与本前端同等效力）

${upstream}
`;
}

/** 部署 skill 到 DSH 技能目录（幂等：内容一致则跳过）。返回给 UI 的说明。 */
export async function deploySkill(dshHome) {
	const src = VENDOR;
	const dest = join(dshHome(), 'skills', SKILL_DIR_NAME);
	if (!existsSync(join(src, 'SKILL.md'))) return { ok: false, error: 'vendor/L2Word 缺失' };
	const upstream = await readFile(join(src, 'SKILL.md'), 'utf8');
	await mkdir(join(dest, 'scripts'), { recursive: true });
	await cp(join(src, 'scripts'), join(dest, 'scripts'), { recursive: true });
	if (existsSync(join(src, 'references'))) {
		await mkdir(join(dest, 'references'), { recursive: true });
		await cp(join(src, 'references'), join(dest, 'references'), { recursive: true });
	}
	await writeFile(join(dest, 'SKILL.md'), typstSkillMarkdown(upstream), 'utf8');
	return { ok: true, skillDir: dest, name: SKILL_DIR_NAME };
}

/** skill 是否已部署 */
export function skillDeployed(dshHome) {
	return existsSync(join(dshHome(), 'skills', SKILL_DIR_NAME, 'SKILL.md'));
}
