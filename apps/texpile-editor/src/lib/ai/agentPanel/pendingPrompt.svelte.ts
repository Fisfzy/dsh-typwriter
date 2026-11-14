// 从菜单等外部入口往 AGENT 输入框注入一条预填指令（如 Word 导出驱动词）。
// 注入方只 set，两处消费：LayoutControls 见到信号开面板，AgentPromptBox 见到文本填输入框。
// 挂载晚于注入也安全——值先落 store，消费方挂载后的 effect 自然读到。
import { box } from '$lib/runes/box.svelte';

export const pendingAgentPrompt = box<string | null>(null);

export function injectAgentPrompt(text: string): void {
	pendingAgentPrompt.current = text;
}

/** 消费一次：读到即清空，避免面板反复开合时重复填入 */
export function consumeAgentPrompt(): string | null {
	const t = pendingAgentPrompt.current;
	pendingAgentPrompt.current = null;
	return t;
}
