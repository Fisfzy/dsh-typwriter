<script lang="ts">
	// 历史会话列表：DSH 保存的会话（session/list），点一条接续（session/resume），「开新对话」归档当前。
	// DSH 不给标题也不回放历史——接续后上下文在 agent 侧延续，面板从头开始记新内容。
	import { Check, MessageSquarePlus } from '@lucide/svelte';
	import { agentSession, restartAgentSession } from '../agentSession.svelte';

	type Props = {
		/** a popover closes itself after a pick; the empty state has nowhere to close */
		onPicked?: () => void;
	};
	const props: Props = $props();

	// 最新在前；没有时间的（目录缺失）垫底按 id 稳定排序
	const sorted = $derived(
		[...agentSession.chats].sort((a, b) => {
			const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
			const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
			return tb - ta || a.id.localeCompare(b.id);
		})
	);

	function ago(iso: string | null): string {
		if (!iso) return '';
		const ms = Date.now() - Date.parse(iso);
		if (!Number.isFinite(ms) || ms < 0) return '';
		const min = Math.round(ms / 60000);
		if (min < 1) return '刚刚';
		if (min < 60) return `${min} 分钟前`;
		const h = Math.round(min / 60);
		if (h < 24) return `${h} 小时前`;
		const d = Math.round(h / 24);
		if (d < 30) return `${d} 天前`;
		return new Date(ms < 0 ? Date.now() : Date.parse(iso)).toLocaleDateString();
	}

	async function resume(id: string): Promise<void> {
		props.onPicked?.();
		await agentSession.openChat(id);
	}
</script>

<div class="flex min-h-0 flex-col gap-1">
	<div class="flex items-center justify-between px-1">
		<span class="text-muted text-xs">历史对话（{sorted.length}）</span>
	</div>
	<div class="max-h-56 overflow-y-auto">
		{#each sorted as chat, i (chat.id)}
			<button
				class="hover:preset-tonal flex w-full items-center gap-2 rounded-base px-2 py-1.5 text-left text-xs {chat.id === agentSession.chat ? 'preset-tonal' : ''}"
				onclick={() => void resume(chat.id)}
			>
				<span class="text-muted w-6 shrink-0 text-right tabular-nums">#{i + 1}</span>
				<span class="min-w-0 flex-1 truncate font-mono">{chat.title ?? chat.id.slice(0, 8)}</span>
				<span class="text-muted shrink-0">{ago(chat.updatedAt)}</span>
				{#if chat.id === agentSession.chat}<Check class="text-primary-ink size-3.5 shrink-0" />{/if}
			</button>
		{:else}
			<p class="text-muted px-2 py-3 text-center text-xs">还没有历史对话</p>
		{/each}
	</div>
	<p class="text-muted px-1 text-[11px] leading-relaxed">接续后上下文延续到该对话；历史内容不回显，直接继续提问即可。</p>
	<button
		class="preset-tonal hover:preset-tonal-primary mt-1 flex items-center justify-center gap-1.5 rounded-base px-2 py-1.5 text-xs"
		onclick={() => {
			props.onPicked?.();
			void restartAgentSession();
		}}
	>
		<MessageSquarePlus class="size-3.5" /> 开新对话（归档当前）
	</button>
</div>
