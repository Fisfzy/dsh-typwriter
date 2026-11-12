<script lang="ts">
	// 历史会话列表：DSH 保存的会话（session/list），点一条接续（会话流回放消息与工具卡片），
	// 「开新对话」另起一条全新会话（当前会话保留，DSH 侧栏同步可见可管理）。
	import { Check, MessageSquarePlus } from '@lucide/svelte';
	import { agentSession, restartAgentSession } from '../agentSession.svelte';
	import { agentAutoOpen, setAgentAutoOpen } from '../agentActivity.svelte';

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
		<!-- 开新对话就摆在历史标题旁边，一眼可见 -->
		<button
			class="hover:preset-tonal text-muted hover:text-primary-ink rounded-base flex items-center gap-1 px-1.5 py-0.5 text-[11px]"
			title="开新对话"
			onclick={() => {
				props.onPicked?.();
				void restartAgentSession(undefined, { fresh: true });
			}}
		>
			<MessageSquarePlus class="size-3" />新对话
		</button>
	</div>
	<div class="max-h-56 overflow-y-auto">
		{#each sorted as chat, i (chat.id)}
			<button
				class="hover:preset-tonal rounded-base flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs {chat.id === agentSession.chat
					? 'preset-tonal'
					: ''}"
				onclick={() => void resume(chat.id)}
			>
				<span class="text-muted w-6 shrink-0 text-right tabular-nums">#{i + 1}</span>
				<span class="min-w-0 flex-1 truncate font-mono">{chat.title ?? chat.id.replace(/^session-/, '').slice(0, 8)}</span>
				<span class="text-muted shrink-0">{ago(chat.updatedAt)}</span>
				{#if chat.id === agentSession.chat}<Check class="text-primary-ink size-3.5 shrink-0" />{/if}
			</button>
		{:else}
			<p class="text-muted px-2 py-3 text-center text-xs">还没有历史对话</p>
		{/each}
	</div>
	<label class="text-muted flex cursor-pointer items-center gap-1.5 px-1 text-[11px]">
		<input
			type="checkbox"
			class="checkbox scale-75"
			checked={agentAutoOpen()}
			onchange={(e) => setAgentAutoOpen(e.currentTarget.checked)}
		/>
		圈选发送后自动打开 AGENT 面板
	</label>
	<p class="text-muted px-1 text-[11px] leading-relaxed">接续会回放历史消息与工具步骤，上下文延续；这些会话与 DSH 侧栏完全同步。</p>
</div>
