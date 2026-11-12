// AGENT 的"代理工作区"：默认是写作台打开的文件目录，也可以在设置里固定为自定义目录。
// 这个路径同时是 DSH Workspace（会话归属、侧栏可见）与 Agent 的 cwd——必须和 session 的
// workspaceId 指向同一个目录，否则会话会变成"有目录、无工作区"的孤儿。
import { fileService } from '$lib/files/service/fileService';
import { settings } from '$lib/settings';

export type AgentWorkspace = {
	/** 实际给 Agent / DSH Workspace 用的目录（正斜杠，便于与 DSH 的 cwd 比较） */
	path: string;
	/** 自定义目录不可用时回退到论文文件夹 */
	fallback: boolean;
	reason?: string;
};

function normalize(p: string): string {
	return (p ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
}

/** 设置里选的是论文文件夹还是自定义目录（字段不在 AppSettings 类型里，按扩展字段读） */
export function agentWorkspaceSetting(): { mode: 'paper' | 'custom'; customPath: string } {
	const extra = settings.current as Record<string, unknown>;
	const mode = extra.agentWorkspaceMode === 'custom' ? 'custom' : 'paper';
	const customPath = typeof extra.agentWorkspacePath === 'string' ? extra.agentWorkspacePath.trim() : '';
	return { mode, customPath };
}

/** 解析 AGENT 真正应该绑定的目录：自定义目录有效就用它，否则回退到论文文件夹 */
export async function resolveAgentWorkspace(paperRoot: string): Promise<AgentWorkspace> {
	const paper = normalize(paperRoot);
	const { mode, customPath } = agentWorkspaceSetting();
	if (mode !== 'custom' || !customPath) return { path: paper, fallback: false };
	try {
		const st = await fileService.stat(customPath);
		if (st.exists && st.isDirectory !== false) return { path: normalize(customPath), fallback: false };
		return { path: paper, fallback: true, reason: '自定义代理工作区不存在或不是文件夹' };
	} catch {
		return { path: paper, fallback: true, reason: '无法访问自定义代理工作区' };
	}
}
