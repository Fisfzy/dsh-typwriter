// 画布/选区 → AI 修改的编排：构建载荷、开好会话、上快照、送进面板的会话状态机。
// 面板不可见时把它拉出来（用户必须能看到轮次的工具卡与回退按钮，这是本功能的核心承诺）。
import { agentSession, openAgentSession } from '$lib/ai/agentPanel/agentSession.svelte';
import { agentHost } from '$lib/ai/agentPanel/agentHost.svelte';
import { armTurnScope } from '$lib/ai/agentPanel/turnScope';
import { fileService } from '$lib/files/service/fileService';
import { workspaceRoot } from '$lib/workspace/workspaceStore';
import { beginAgentActivity, failAgentActivity, finishAgentActivity } from '$lib/ai/agentPanel/agentActivity.svelte';

export type RegionPayload = {
	/** 绝对路径（tinymist 解析原样给出） */
	file: string;
	/** 1 基行范围（含两端） */
	fromLine: number;
	toLine: number;
	/** 圈选来源：预览框选 / 视觉编辑器划选 */
	via: 'preview-box' | 'visual-selection';
};

/** 面板既有两种机器可读上下文的合体：file://#L 行范围（attachedBlocks）+ 明确的修改指令 */
export function buildRegionPrompt(r: RegionPayload, intent: string): string {
	const uri = `file://${r.file.replace(/\\/g, '/')}#L${r.fromLine}:${r.toLine}`;
	const via = r.via === 'preview-box' ? '预览框选' : '视觉划选';
	return [
		`[AG-EDIT] ${uri}`,
		`[方式] ${via}`,
		`[意图] ${intent.trim()}`,
		'请读取上述范围的源码，按意图直接修改它（只动这个范围，除非意图明确要求牵连别处）。',
		'若改动删除了带 <label> 的块或引入了新标签，必须同时修正文档中被引用的 @ref 引用（即使它在选区之外），保证文档仍可编译；不确定时先指出风险。'
	].join('\n');
}

/** 把 agent 落盘的改动拉回打开的缓冲（写同内容经 fileService 触发 syncBuffers，编辑器即刻可见） */
async function refreshChangedBuffers(paths: string[]): Promise<void> {
	const host = agentHost.current;
	if (!host) return;
	for (const p of paths) {
		try {
			const disk = await fileServiceRead(p);
			if (disk !== null) await host.writeText(p, disk);
		} catch {
			// 单个文件刷新失败不拦整轮：面板里的回退按钮不依赖它
		}
	}
}

async function fileServiceRead(path: string): Promise<string | null> {
	try {
		return await fileService.readText(path);
	} catch {
		return null;
	}
}

/**
 * 圈选 → AI 修改主入口。抛错时由调用方把消息显示回画布/选区卡上。
 */
export async function sendRegionEdit(r: RegionPayload, intent: string): Promise<void> {
	if (!intent.trim()) throw new Error('先写一句你想让 AI 做什么');
	const root = workspaceRoot.current;
	if (!root) throw new Error('没有打开的工作区');
	await openAgentSession(root);
	if (agentSession.state !== 'ready') throw new Error('AGENT 会话还没就绪');
	// 先落盘（快照要拿到"轮次前"的真实内容），再快照，再发
	await agentHost.current?.flushPendingSave();
	await armTurnScope([r.file]);
	// 轻量活动条：不抢主视图；用户点「查看」或设置里开启自动打开时才展开 AGENT 面板。
	// 需要用户作答（permission）或发送失败时例外，那些会强制打开。
	beginAgentActivity({ file: r.file, fromLine: r.fromLine, toLine: r.toLine, intent });
	// nativeBridge.send() 在**第一个** assistant/message 就返回（不是整轮结束），
	// 活动条只能等 DSH 的 turn/end 事件（nativeBridge 会转发）再收；ACP 桥没有该事件，按 send 返回兜底。
	const nativeSession = typeof (globalThis as { texpileSession?: unknown }).texpileSession !== 'undefined';
	try {
		await agentSession.send(buildRegionPrompt(r, intent), [], []);
		// agent 把改动写在了磁盘上：拉回打开的缓冲，编辑器/预览即刻可见（回退按钮不依赖这步）
		await refreshChangedBuffers([r.file]);
		if (!nativeSession) finishAgentActivity();
	} catch (e) {
		failAgentActivity(e instanceof Error ? e.message : String(e));
		throw e;
	}
}
