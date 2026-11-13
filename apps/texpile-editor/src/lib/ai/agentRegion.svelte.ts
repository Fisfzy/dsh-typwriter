// 交给 AGENT 的待修改区域：可视化页/预览页共用的"流动色环"状态。
// 动画只做 opacity（合成器），结束后立刻移除，避免长期占用合成层。
import { box } from '$lib/runes/box.svelte';

export type AgentRegionRect = { left: number; top: number; width: number; height: number };
export type AgentRegionPhase = 'working' | 'done' | 'failed';
export type AgentRegion = { mode: 'preview' | 'visual'; rect: AgentRegionRect; phase: AgentRegionPhase };

export const agentRegion = box<AgentRegion | null>(null);
let clearTimer: ReturnType<typeof setTimeout> | null = null;

function stopTimer(): void {
	if (clearTimer) {
		clearTimeout(clearTimer);
		clearTimer = null;
	}
}

export function beginAgentRegion(mode: AgentRegion['mode'], rect: AgentRegionRect): void {
	stopTimer();
	agentRegion.current = { mode, rect, phase: 'working' };
}

export function finishAgentRegion(phase: 'done' | 'failed'): void {
	const cur = agentRegion.current;
	if (!cur) return;
	stopTimer();
	agentRegion.current = { ...cur, phase };
	clearTimer = setTimeout(
		() => {
			agentRegion.current = null;
			clearTimer = null;
		},
		phase === 'failed' ? 2200 : 700
	);
}

export function cancelAgentRegion(): void {
	stopTimer();
	agentRegion.current = null;
}

// 一轮真正结束时收到通知（nativeBridge 转发）；发送失败由调用方显式 finish('failed')
try {
	if (typeof window !== 'undefined') {
		window.addEventListener('typwriter:agent-turn-end', () => finishAgentRegion('done'));
	}
} catch {
	/* ignore */
}
