// AGENT 面板的思维链/工具步骤默认展开态：面板底栏的开关切换，localStorage 持久化。
// 组件内的语义：全局值是"默认态"，单条点击是"本地覆盖"——全局翻转只重置未手动点过的条。
import { box } from '$lib/runes/box.svelte';

const LS_KEY = 'typwriter:agentPanelExpanded';

function initial(): boolean {
	try {
		return localStorage.getItem(LS_KEY) === '1';
	} catch {
		return false;
	}
}

export const agentPanelView = box({ expanded: initial() });

function persist(v: boolean): void {
	try {
		localStorage.setItem(LS_KEY, v ? '1' : '0');
	} catch {
		/* 无 localStorage 的环境（极少数宿主）不持久化 */
	}
}

export function toggleExpanded(): void {
	agentPanelView.current = { expanded: !agentPanelView.current.expanded };
	persist(agentPanelView.current.expanded);
}
