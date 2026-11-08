// 读取本机 DSH 的技能与插件清单，供偏好设置的「论文助手预设」选择。
// - 技能：<home>/skills/<id>/SKILL.md 的 frontmatter（name/description）
// - 插件：<home>/profiles/desktop/package.json 的 dependencies；是否在 bundles 里 = 是否启用
// - 模型：settings.yaml.imported 快照的 providers 目录 + settings.json 的当前选择（dsh-settings-file 格式）
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const DESC_LIMIT = 240;

/** 简易 YAML frontmatter：只要顶层的 key: value 行，够用且不引依赖 */
function frontmatter(md) {
  const out = {};
  const m = FRONTMATTER.exec(md);
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

/** @returns {Promise<{id:string,name:string,description:string}[]>} */
export async function listSkills(home) {
  const dir = join(home, 'skills');
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const skills = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const md = await readFile(join(dir, e.name, 'SKILL.md'), 'utf8').catch(() => null);
    // 没有 SKILL.md 的目录不是技能（可能是杂物），跳过
    if (md === null) continue;
    const fm = frontmatter(md);
    skills.push({
      id: e.name,
      name: fm.name || e.name,
      description: (fm.description || '').slice(0, DESC_LIMIT)
    });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

/** @returns {Promise<{name:string,version:string,enabled:boolean}[]>} */
export async function listPlugins(home) {
  const file = join(home, 'profiles', 'desktop', 'package.json');
  const raw = await readFile(file, 'utf8').catch(() => null);
  if (raw === null) return [];
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return [];
  }
  const deps = pkg?.dependencies || {};
  const bundles = new Set(pkg?.dsh?.profile?.bundles || []);
  const list = Object.entries(deps).map(([name, version]) => ({
    name,
    version: String(version),
    enabled: bundles.has(name)
  }));
	// 启用的排前面；同名内保持字母序
	list.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
	return list;
}

// ---- 模型选择（AGENT 对话的工具栏） ----
// 目录来自 settings.yaml.imported（迁移快照，用户配好的 providers 全在里面）；当前选择与
// 写入都走 <home>/settings.json —— dsh-settings-file 认这个格式，落盘即 live 生效，
// 之后新建的 agent（包括我们重启的 ACP 会话）就跑在选定的模型上。

/** @typedef {{provider: string, id: string, name: string, contextWindow: number | null}} ModelEntry */
/** @typedef {{provider: string | null, model: string | null, reasoningEffort: string | null}} ModelSelection */

const EFFORTS = ['minimal', 'low', 'medium', 'high'];

/** 迷你解析：只认 settings.yaml.imported 里 providers 段的形状（llm-pi-ai: 下的两级缩进 + models 列表） */
function parseProvidersYaml(text) {
	const models = [];
	let baseIndent = -1; // providers: 行的缩进；-1 = 还没进入这一段
	let currentProvider = null;
	let item = null;
	for (const raw of text.split(/\r?\n/)) {
		if (!raw.trim()) continue;
		const indent = raw.length - raw.trimStart().length;
		const line = raw.trim();
		if (baseIndent < 0) {
			if (/^providers:$/.test(line)) baseIndent = indent;
			continue;
		}
		if (indent <= baseIndent) {
			// 段结束：回到 providers: 的层级或更外，最后一个模型随之落袋
			if (item) models.push(item);
			baseIndent = -1;
			currentProvider = null;
			item = null;
			continue;
		}
		if (indent === baseIndent + 2 && line.endsWith(':')) {
			if (item) models.push(item); // 上一个 provider 的最后一个模型，随段切换落袋
			currentProvider = line.slice(0, -1);
			item = null;
		} else if (currentProvider && line.startsWith('- id:')) {
			if (item) models.push(item);
			item = { provider: currentProvider, id: line.slice(5).trim().replace(/^["']|["']$/g, ''), name: '', contextWindow: null };
		} else if (item && line.startsWith('name:')) {
			item.name = line.slice(6).trim().replace(/^["']|["']$/g, '');
		} else if (item && line.startsWith('contextWindow:')) {
			const n = Number(line.slice(14).trim());
			if (Number.isFinite(n)) item.contextWindow = n;
		}
	}
	if (item) models.push(item);
	return models.map((m) => ({ ...m, name: m.name || m.id }));
}

async function readJson(file) {
	try {
		return JSON.parse(await readFile(file, 'utf8'));
	} catch {
		return null;
	}
}

/** @returns {Promise<{models: ModelEntry[], current: ModelSelection, efforts: string[]}>} */
export async function modelInfo(home) {
	const models = parseProvidersYaml(await readFile(join(home, 'settings.yaml.imported'), 'utf8').catch(() => ''));
	const user = (await readJson(join(home, 'settings.json'))) || {};
	// 当前选择：settings.json 优先，没有则回落快照开头的 agent-default-model 段
	let current = { provider: null, model: null, reasoningEffort: null };
	const pick = (sel) => {
		if (!sel || typeof sel !== 'object') return;
		if (typeof sel.provider === 'string') current.provider = sel.provider;
		if (typeof sel.model === 'string') current.model = sel.model;
		if (typeof sel.reasoningEffort === 'string') current.reasoningEffort = sel.reasoningEffort;
	};
	pick(user['agent-default-model']);
	if (current.provider === null) {
		// settings.yaml.imported 是 YAML：迷你解析开头的 agent-default-model 三行
		const head = await readFile(join(home, 'settings.yaml.imported'), 'utf8').then((t) => t.split(/\r?\n/).slice(0, 12)).catch(() => []);
		const seg = {};
		let inSeg = false;
		for (const l of head) {
			if (/^agent-default-model:/.test(l)) { inSeg = true; continue; }
			if (inSeg && /^\S/.test(l)) break;
			if (inSeg) {
				const m = /^\s+(provider|model|reasoningEffort):\s*(\S+)/.exec(l);
				if (m) seg[m[1]] = m[2];
			}
		}
		pick(seg);
	}
	// 当前选择可能是 provider 未广告的模型（如 kimi 的 k3）：也进列表，让下拉有可勾选项
	if (current.provider && current.model && !models.some((m) => m.provider === current.provider && m.id === current.model)) {
		models.unshift({ provider: current.provider, id: current.model, name: current.model, contextWindow: null });
	}
	return { models, current, efforts: EFFORTS };
}

/** 写 <home>/settings.json 的 agent-default-model 段（dsh-settings-file 的用户层，live 生效） */
export async function setModel(home, selection) {
	const file = join(home, 'settings.json');
	const user = (await readJson(file)) || {};
	const next = { ...user };
	const seg = { ...(next['agent-default-model'] || {}) };
	if (selection.provider !== undefined) seg.provider = selection.provider;
	if (selection.model !== undefined) seg.model = selection.model;
	// 思考强度允许显式清掉（不写 = 跟随 provider 默认）
	if (selection.reasoningEffort === null) delete seg.reasoningEffort;
	else if (selection.reasoningEffort !== undefined) seg.reasoningEffort = selection.reasoningEffort;
	next['agent-default-model'] = seg;
	await mkdir(join(home), { recursive: true });
	await writeFile(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
	return { ok: true, current: seg };
}
