// 监督轮次的范围快照：一轮开始前把候选文件的内容留在内存，轮次结束后逐一重读比对，
// 差异作为 TurnChange 交回面板（keepBefore/AgentChanges 的单文件回退因此对 native 轮次也生效）。
//
// 为什么快照在客户端：native 桥的 prompt() 不产出 changes（DSH 网关的轮次没有 ACP 的
// filesUpdated 通道），而"agent 改了哪些文件"对用户必须可见、可撤销。候选集刻意收得很小——
// 目标文件 + 当前打开的缓冲——不然一轮就可能把几十个文件拖进内存。
import { fileService } from '$lib/files/service/fileService';
import type { TurnChange } from './agentPanel.types';

type Scope = { files: Map<string, string> };

let scope: Scope | null = null;

/** 发消息前调用（agentSession.send 已先 flush 了待存缓冲）。路径都取绝对路径。 */
export async function armTurnScope(paths: string[]): Promise<void> {
	const files = new Map<string, string>();
	for (const p of paths) {
		if (typeof p !== 'string' || !p) continue;
		try {
			const text = await fileService.readText(p);
			if (typeof text === 'string') files.set(p, text);
		} catch {
			// 读不到（还没建等）就跳过：轮次后它若出现，按 added 上报，没有 before 无法回退
		}
	}
	scope = { files };
}

/** 轮次结束后调用：重读候选文件，与快照比对，有变化的作为 TurnChange 交回。随后范围解除。 */
export async function collectTurnChanges(): Promise<TurnChange[]> {
	const snap = scope;
	scope = null;
	if (!snap) return [];
	const changes: TurnChange[] = [];
	for (const [path, before] of snap.files) {
		let now: string | null = null;
		try {
			const text = await fileService.readText(path);
			if (typeof text === 'string') now = text;
		} catch {
			now = null;
		}
		if (now !== null && now !== before) changes.push({ path, kind: 'modified', before });
	}
	return changes;
}

/** 打断/异常路径上放弃范围（不产生 changes）——半截状态交给调用方决定要不要另行处理。 */
export function releaseTurnScope(): void {
	scope = null;
}

/** 当前是否有 armed 的范围（面板横幅据此显示"AI 编辑中"）。 */
export function turnScopeArmed(): boolean {
	return scope !== null;
}

/** 作用中的候选文件（横幅上提示用户哪些文件被盯住）。 */
export function turnScopePaths(): string[] {
	return scope ? [...scope.files.keys()] : [];
}
