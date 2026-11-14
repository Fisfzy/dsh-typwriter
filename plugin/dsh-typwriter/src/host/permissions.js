// AGENT 会话的权限预设读写：面板下拉（仅可查看 / 工作区内修改 / 完全权限）改的是
// DSH profile cordis.patch.yml 里 `id: permission` 条目的 `defaultPreset`——与 DSH web
// 设置界面「权限」下拉写的是同一处，新对话继承。web 与 desktop 两个 profile 同时写，
// 哪个在用都生效。完全权限（danger-full-access）由前端做确认框。
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PRESETS = ['read-only', 'workspace-write', 'danger-full-access'];

/** permission 条目的完整模板（与 DSH 设置界面写入的形态一致） */
function permissionEntry(preset) {
	return [
		'- id: permission',
		'  name: "@deepseek-ai/dsh-permission-presets"',
		'  config:',
		'    presets:',
		'      read-only:',
		'        sandbox: read-only',
		'        approval: ask',
		'      workspace-write:',
		'        sandbox: workspace-write',
		'        approval: ask',
		'      danger-full-access:',
		'        sandbox: danger-full-access',
		'        approval: never',
		`    defaultPreset: ${preset}`
	].join('\n');
}

/** 从 patch 文本解析 defaultPreset；无条目返回 null */
function readPreset(text) {
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		if (/^- id: permission\s*$/.test(lines[i])) {
			// 条目从这行到下一个同缩进 "- " 或文件尾
			for (let j = i + 1; j < lines.length; j++) {
				if (/^- / .test(lines[j])) break;
				const m = /^\s+defaultPreset:\s*(\S+)/.exec(lines[j]);
				if (m) return m[1];
			}
		}
	}
	return null;
}

/** 把 defaultPreset 写进已有 permission 条目；无条目则追加完整条目（带管理标记注释） */
function withPreset(text, preset) {
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		if (/^- id: permission\s*$/.test(lines[i])) {
			for (let j = i + 1; j < lines.length; j++) {
				if (/^- /.test(lines[j])) break;
				if (/^\s+defaultPreset:/.test(lines[j])) {
					lines[j] = `    defaultPreset: ${preset}`;
					return lines.join('\n');
				}
			}
			// 条目存在但没有 defaultPreset：插在条目块末尾（下一个 "- " 前）
			lines.splice(j, 0, `    defaultPreset: ${preset}`);
			return lines.join('\n');
		}
	}
	return `${text.replace(/\s*$/, '')}\n# Typwriter 写入：AGENT 会话的默认权限预设（写作台面板可调，新对话生效）\n${permissionEntry(preset)}\n`;
}

async function patchFor(profile, home) {
	const file = join(home, 'profiles', profile, 'cordis.patch.yml');
	let text = null;
	try {
		text = await readFile(file, 'utf8');
	} catch {
		return { file, text: null };
	}
	return { file, text };
}

/** 读当前预设：web profile 优先（面板会话随宿主），desktop 兜底 */
export async function permissionGet(home) {
	for (const profile of ['web', 'desktop']) {
		const { text } = await patchFor(profile, home);
		if (text !== null) {
			const preset = readPreset(text);
			if (preset) return { ok: true, preset, profile };
		}
	}
	return { ok: true, preset: 'workspace-write', profile: null };
}

/** 写预设到 web 与 desktop 两个 profile（存在 patch 文件的才写；无文件跳过——
 *  没装对应 profile 的机器不该凭空造文件） */
export async function permissionSet(home, preset) {
	if (!PRESETS.includes(preset)) return { ok: false, error: `未知预设 ${preset}` };
	const written = [];
	for (const profile of ['web', 'desktop']) {
		const { file, text } = await patchFor(profile, home);
		if (text === null) continue;
		await writeFile(file, withPreset(text, preset), 'utf8');
		written.push(file);
	}
	return { ok: written.length > 0, preset, written };
}
