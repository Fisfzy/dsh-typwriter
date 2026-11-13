// 画布/选区 → AI 修改的编排：构建载荷、开好会话、上快照、送进面板的会话状态机。
// 面板不可见时把它拉出来（用户必须能看到轮次的工具卡与回退按钮，这是本功能的核心承诺）。
import { agentSession, openAgentSession } from '$lib/ai/agentPanel/agentSession.svelte';
import { agentHost } from '$lib/ai/agentPanel/agentHost.svelte';
import { armTurnScope } from '$lib/ai/agentPanel/turnScope';
import { fileService } from '$lib/files/service/fileService';
import { workspaceRoot } from '$lib/workspace/workspaceStore';
import { beginAgentActivity, failAgentActivity, finishAgentActivity, warnScopeViolation } from '$lib/ai/agentPanel/agentActivity.svelte';
import { outOfRange } from '$lib/ai/agentPanel/scopeGuard';
import { beginAgentRegion, type AgentRegionRect } from '$lib/ai/agentRegion.svelte';

export type RegionPayload = {
	/** 绝对路径（tinymist 解析原样给出） */
	file: string;
	/** 1 基行范围（含两端） */
	fromLine: number;
	toLine: number;
	/** 圈选来源：预览框选 / 视觉编辑器划选 */
	via: 'preview-box' | 'visual-selection';
	/** 编辑器划选时的精确字符范围（0 基，[fromChar,toChar)），有它就能只改选中的片段 */
	fromChar?: number;
	toChar?: number;
	/** 选中原文，直接给 AGENT，省掉 read/grep，也钉死"只替换这段" */
	quote?: string;
};

/** 面板既有两种机器可读上下文的合体：file://#L 行范围（attachedBlocks）+ 明确的修改指令 */
export function buildRegionPrompt(r: RegionPayload, intent: string): string {
	const uri = `file://${r.file.replace(/\\/g, '/')}#L${r.fromLine}:${r.toLine}`;
	const via = r.via === 'preview-box' ? '预览框选' : '视觉划选';
	const lines = [`[AG-EDIT] ${uri}`, `[方式] ${via}`, `[意图] ${intent.trim()}`];
	if (r.fromChar !== undefined && r.toChar !== undefined) {
		lines.push(`[字符范围] 上述行内第 ${r.fromChar}..${r.toChar} 个字符（0 基，左闭右开）`);
	}
	if (r.quote) {
		lines.push('[选中原文]', '<<<', r.quote, '>>>');
	}
	lines.push(
		r.fromChar !== undefined
			? '只允许替换 <<< >>> 内的这段字符；即使选中的只是一整个标题或段落的一小部分，也不要重写整行/整段。'
			: '只允许修改上述行范围内的源码：不要新增原文没有的信息、解释或修饰；不要重写标题/图注/表格/公式（除非意图明确要求）。',
		'选中原文和上下文已经给出：不要调用 read/grep 重新读取该文件；直接调用一次 edit 完成修改，不要额外验证或重复读取，以便尽快返回。',
		'不得编辑该文件范围外的内容，也不得改动其他文件。若意图必须涉及范围外改动，或删除/新增 <label> 需要修 @ref 引用，不要直接改，也不要在本轮调用提问/等待确认的工具；直接在回复正文说明需要改哪里，等用户下一条消息确认。唯一例外是删除引用后为保持可编译必须做的最小 @ref 修复。',
		'意图不明确时按最小、最保守的改动执行，并在回复里说明你的假设；不要调用 ask_user_question 等提问工具。'
	);
	return lines.join('\n');
}

let detachScopeGuard: (() => void) | null = null;

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
export async function sendRegionEdit(r: RegionPayload, intent: string, highlight?: AgentRegionRect): Promise<void> {
	if (!intent.trim()) throw new Error('先写一句你想让 AI 做什么');
	const root = workspaceRoot.current;
	if (!root) throw new Error('没有打开的工作区');
	await openAgentSession(root);
	if (agentSession.state !== 'ready') throw new Error('AGENT 会话还没就绪');
	// 先落盘（快照要拿到"轮次前"的真实内容），再快照，再发
	await agentHost.current?.flushPendingSave();
	await armTurnScope([r.file]);
	// 待修改区域动效：可视化页/预览页共用，只做 opacity 环，轮次结束由 agentRegion 清理
	if (highlight) beginAgentRegion('preview', highlight);
	// 轻量活动条：不抢主视图；用户点「查看」或设置里开启自动打开时才展开 AGENT 面板。
	// 需要用户作答（permission）或发送失败时例外，那些会强制打开。
	beginAgentActivity({ file: r.file, fromLine: r.fromLine, toLine: r.toLine, intent });
	// 越界守卫：轮次前留底，轮次真正结束（turn/end）后比对；改到圈选范围外就告警并可一键回退
	let beforeText: string | null = null;
	try {
		beforeText = await fileServiceRead(r.file);
	} catch {
		beforeText = null;
	}
	if (detachScopeGuard) detachScopeGuard();
	const targetSession = agentSession.chat;
	function onTurnEnd(event: Event): void {
		const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
		if (detail?.sessionId && targetSession && detail.sessionId !== targetSession) return;
		detachScopeGuard?.();
		detachScopeGuard = null;
		if (beforeText === null) return;
		const before = beforeText;
		void (async () => {
			const after = await fileServiceRead(r.file);
			if (after === null) return;
			const violation = outOfRange(before, after, r.fromLine, r.toLine);
			// 有精确字符范围时再按字符检查：标题/整段被整行重写也会在这里被抓到
			let charOut = false;
			if (r.fromChar !== undefined && r.toChar !== undefined) {
				let p = 0;
				while (p < before.length && p < after.length && before[p] === after[p]) p++;
				let sfx = 0;
				while (sfx < before.length - p && sfx < after.length - p && before[before.length - 1 - sfx] === after[after.length - 1 - sfx])
					sfx++;
				const changedFrom = p;
				const changedTo = before.length - sfx;
				charOut = changedFrom < r.fromChar || changedTo > r.toChar;
			}
			if (!violation && !charOut) return;
			const name = r.file.split(/[\\/]/).pop() || r.file;
			const message = charOut
				? `${name} 的改动超出了选中的第 ${r.fromChar}..${r.toChar} 个字符（整行/整段被重写）`
				: (() => {
						const oldLo = Math.min(violation!.oldStart, violation!.oldEnd);
						const oldHi = Math.max(violation!.oldStart, violation!.oldEnd);
						const where = violation!.oldStart <= violation!.oldEnd ? `L${oldLo}–${oldHi}` : `在第 ${violation!.newStart} 行附近`;
						return `${name} 在圈选范围 L${r.fromLine}–${r.toLine} 之外（${where}）被改动`;
					})();
			async function revert(): Promise<void> {
				await agentHost.current?.writeText(r.file, before);
			}
			window.dispatchEvent(new CustomEvent('typwriter:scope-violation', { detail: { message, revert } }));
			warnScopeViolation(message, revert);
		})();
	}
	window.addEventListener('typwriter:agent-turn-end', onTurnEnd);
	detachScopeGuard = () => window.removeEventListener('typwriter:agent-turn-end', onTurnEnd);

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
