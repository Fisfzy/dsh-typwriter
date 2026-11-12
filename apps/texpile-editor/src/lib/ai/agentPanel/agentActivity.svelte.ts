// 圈选 → AGENT 的"轻量活动条"：不抢占主视图，用 toast 汇报进度，用户点「查看」才打开 AGENT 面板。
// 自动打开面板只在两种情况下发生：设置里显式开启，或需要用户作答/出错（见 agentSession / fail）。
import { toaster } from '$lib/modals/toaster-svelte';

const AUTO_OPEN_KEY = 'texpile:agent-auto-open';
const TOAST_ID = 'typwriter-agent-activity';

/** 是否在圈选发送时自动展开 AGENT 面板（默认关：写作时不该被面板打断） */
let autoOpen = $state(readAutoOpen());

function readAutoOpen(): boolean {
	try {
		return localStorage.getItem(AUTO_OPEN_KEY) === '1';
	} catch {
		return false;
	}
}

export function agentAutoOpen(): boolean {
	return autoOpen;
}

export function setAgentAutoOpen(on: boolean): void {
	autoOpen = on;
	try {
		localStorage.setItem(AUTO_OPEN_KEY, on ? '1' : '0');
	} catch {
		/* 隐私模式：仅本次会话有效 */
	}
}

/** 打开 AGENT 面板（右栏优先，底部 dock 也切过去）；这是唯一"抢视图"的入口 */
export function showAgentPanel(): void {
	try {
		window.dispatchEvent(new CustomEvent('typwriter:agent-show'));
	} catch {
		/* ignore */
	}
}

export type AgentActivityInfo = {
	file: string;
	fromLine: number;
	toLine: number;
	intent: string;
};

let active = false;

function baseName(p: string): string {
	const parts = p.split(/[\\/]/);
	return parts[parts.length - 1] || p;
}

function dismiss(): void {
	try {
		toaster.dismiss(TOAST_ID);
	} catch {
		/* ignore */
	}
}

/** 一轮圈选修改开始：常驻活动条 + 可选自动展开面板 */
export function beginAgentActivity(activity: AgentActivityInfo): void {
	active = true;
	dismiss();
	const where = `${baseName(activity.file)} L${activity.fromLine}–${activity.toLine}`;
	const intent = activity.intent.trim().slice(0, 40);
	try {
		toaster.create({
			id: TOAST_ID,
			type: 'loading',
			title: 'AGENT 正在修改…',
			description: intent ? `${where} · ${intent}` : where,
			duration: 0,
			closable: false,
			action: { label: '查看', onClick: showAgentPanel }
		});
	} catch {
		/* toast 不可用时不影响主流程 */
	}
	if (autoOpen) showAgentPanel();
}

/** 一轮结束（DSH 的 turn/end 到达时由 nativeBridge 触发） */
export function finishAgentActivity(): void {
	if (!active) return;
	active = false;
	dismiss();
	try {
		toaster.create({
			id: TOAST_ID,
			type: 'success',
			title: 'AGENT 修改完成',
			description: '可查看差异与回退',
			duration: 6000,
			closable: true,
			action: { label: '查看', onClick: showAgentPanel }
		});
	} catch {
		/* ignore */
	}
}

/** 发送环节就失败（会话不可用等）：这种需要用户看见，直接展开面板 */
export function failAgentActivity(message: string): void {
	if (!active) return;
	active = false;
	dismiss();
	try {
		toaster.create({
			id: TOAST_ID,
			type: 'error',
			title: 'AGENT 修改失败',
			description: String(message || '').slice(0, 140),
			duration: 10000,
			closable: true,
			action: { label: '查看', onClick: showAgentPanel }
		});
	} catch {
		/* ignore */
	}
	showAgentPanel();
}

/** 越界修改告警：常驻，带「回退本轮」，避免 agent 改到选区外后无声无息 */
export function warnScopeViolation(message: string, onRevert: () => void | Promise<void>): void {
	try {
		toaster.dismiss('typwriter-scope-violation');
		toaster.create({
			id: 'typwriter-scope-violation',
			type: 'warning',
			title: 'AGENT 修改超出圈选范围',
			description: String(message || '').slice(0, 160),
			duration: 0,
			closable: true,
			action: {
				label: '回退本轮',
				onClick: () => {
					void onRevert();
					try {
						toaster.dismiss('typwriter-scope-violation');
					} catch {
						/* ignore */
					}
				}
			}
		});
	} catch {
		/* ignore */
	}
}

// turn/end 由 nativeBridge 在会话流里看到后转发过来；一轮也可能被用户取消
try {
	if (typeof window !== 'undefined') {
		window.addEventListener('typwriter:agent-turn-end', () => finishAgentActivity());
	}
} catch {
	/* ignore */
}
