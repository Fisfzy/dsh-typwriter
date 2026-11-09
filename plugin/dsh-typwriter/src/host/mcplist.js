// AGENT 对话外接 MCP 服务器的管理：配置的源头是插件设置（typwriter 的 settings.json），
// 派生物是 DSH 的 profile patch（<home>/profiles/acp/cordis.patch.yml）——每次增删改，
// 重新生成 patch 里 Typwriter 管理的那段 insert；profile 是 patchReload: startup，
// 面板里重启对话（restartAgentSession）即生效。
//
// 一个 MCP server = patch 里一条 @deepseek-ai/dsh-mcp-client 插件条目（streamable-http +
// Bearer 头）。Zotero 联动的 token 可从 llm-for-zotero 写在 Zotero prefs 里的值自动读出。
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** @typedef {{name: string, url: string, token: string}} McpServer */

const MANAGED_MARK = '# typwriter-mcp-managed';
const PATCH_FILE = ['profiles', 'acp', 'cordis.patch.yml'];

async function readJson(file) {
	try {
		return JSON.parse(await readFile(file, 'utf8'));
	} catch {
		return null;
	}
}

/** 设置里的服务器列表；缺省为空 */
export async function mcpList(settings) {
	const list = settings?.mcpServers;
	return Array.isArray(list)
		? list.filter((s) => s && typeof s.name === 'string' && typeof s.url === 'string').map((s) => ({ name: s.name, url: s.url, token: typeof s.token === 'string' ? s.token : '' }))
		: [];
}

/** 生成 DSH profile patch（Typwriter 管理段）并返回规范化后的列表；
 * 设置持久化由调用方（rpc 层）负责——设置是源头，patch 是派生物。 */
export async function mcpSet(servers, dshHome) {
	const clean = (Array.isArray(servers) ? servers : [])
		.filter((s) => s && typeof s.name === 'string' && s.name && typeof s.url === 'string' && s.url)
		.map((s) => ({ name: s.name.trim(), url: s.url.trim(), token: typeof s.token === 'string' ? s.token.trim() : '' }));
	const home = dshHome();
	const file = join(home, ...PATCH_FILE);
	const prev = await readFile(file, 'utf8').catch(() => null);
	// 接管规则：文件不存在 / 原是空列表 [] / 已带我们的管理标记，才整体生成；
	// 用户手写过其他 patch 的话先备份一份再接管，绝不静默吞掉。
	if (prev !== null && !prev.includes(MANAGED_MARK) && prev.trim() !== '[]') {
		await writeFile(file + '.bak-typwriter-mcp', prev, 'utf8');
	}
	const lines = [
		MANAGED_MARK,
		'# 本文件由 Typwriter 偏好设置（AI 助手 → MCP 服务器）生成管理：',
		'# 每个 MCP server 是一条 dsh-mcp-client 插件条目；改后重启 AGENT 对话生效。',
		'# 接管前的原内容（若有）备份在同目录 cordis.patch.yml.bak-typwriter-mcp。'
	];
	if (clean.length === 0) {
		lines.push('[]');
	} else {
		lines.push('- insert:');
		for (const s of clean) {
			lines.push(`    - id: mcp-${s.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`);
			lines.push(`      name: '@deepseek-ai/dsh-mcp-client'`);
			lines.push('      config:');
			lines.push(`        serverName: ${s.name}`);
			lines.push('        transport: streamable-http');
			lines.push(`        url: ${s.url}`);
			lines.push('        headers:');
			// token 走 YAML 单引号：内部单引号转义为两个单引号
			lines.push(`          Authorization: 'Bearer ${s.token.replaceAll("'", "''")}'`);
		}
	}
	await writeFile(file, lines.join('\n') + '\n', 'utf8');
	return { ok: true, servers: clean, patch: file };
}

/** 连通测试：对 streamable-http 端点做一次 MCP initialize 握手，返回 server 信息与工具数 */
export async function mcpTest(server) {
	const url = typeof server?.url === 'string' ? server.url : '';
	if (!url) return { ok: false, error: 'missing url' };
	const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
	if (server.token) headers.Authorization = `Bearer ${server.token}`;
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 6000);
	// streamable-http 的会话用 DELETE 收尾：initialize 建的 session 不关会在服务端
	// 堆积（实测把 llm-for-zotero 的服务池拖死过），测试必须自己清理
	let session = null;
	try {
		let res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'typwriter', version: '0.1.0' } } }),
			signal: ctrl.signal
		});
		session = res.headers.get('mcp-session-id');
		if (session) headers['mcp-session-id'] = session;
		const parse = (t) => {
			try {
				return JSON.parse(t);
			} catch {
				// streamable-http 可能以 SSE 帧返回：取 data: 行拼 JSON
				const m = /data:\s*(\{.*\})/.exec(t);
				return m ? JSON.parse(m[1]) : null;
			}
		};
		const init = parse(await res.text());
		if (!res.ok || !init?.result) return { ok: false, error: `HTTP ${res.status}` + (init?.error ? ` ${init.error.message}` : '') };
		let tools = null;
		if (session) {
			await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), signal: ctrl.signal }).catch(() => {});
			res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), signal: ctrl.signal });
			tools = parse(await res.text())?.result?.tools?.length ?? null;
		}
		return { ok: true, serverInfo: init.result.serverInfo ?? null, tools };
	} catch (e) {
		return { ok: false, error: e?.name === 'AbortError' ? '超时（服务器无响应）' : String(e?.message || e) };
	} finally {
		// 无论成败都关掉这次握手建立的会话
		if (session) await fetch(url, { method: 'DELETE', headers }).catch(() => {});
		clearTimeout(timer);
	}
}

/** llm-for-zotero 的 MCP token：它写在 Zotero prefs.js 里（codexZoteroMcpBearerToken）。
 * 找不到返回 null，UI 让用户手填。 */
export async function zoteroMcpToken() {
	const dir = join(homedir(), 'AppData', 'Roaming', 'Zotero', 'Zotero', 'Profiles');
	if (!existsSync(dir)) return null;
	let token = null;
	for (const p of await readdir(dir).catch(() => [])) {
		const prefs = await readFile(join(dir, p, 'prefs.js'), 'utf8').catch(() => '');
		const m = /llmforzotero\.codexZoteroMcpBearerToken",\s*"([0-9a-f]+)"/.exec(prefs);
		if (m) {
			token = m[1];
			break;
		}
	}
	return token;
}
