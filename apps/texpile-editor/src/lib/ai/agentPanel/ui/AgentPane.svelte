<script lang="ts">
	// 右侧独立的 AGENT 对话面板：与 PDF 预览并列，占编辑器网格的最后一列。
	// 左缘是拖拽调宽的手柄——绝对定位贴在 border 上，不占网格列（PDF 面板是占列的分隔条，
	// 这里两列之间已经没有空位可给）。
	import { Bot, History, MessageSquarePlus, X } from '@lucide/svelte';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import AgentPanel from './AgentPanel.svelte';
	import AgentHistoryList from './AgentHistoryList.svelte';
	import { agentSession, restartAgentSession } from '../agentSession.svelte';
	import { agentUnavailable } from '../agentAvailability';
	import { agentLabel } from '../agentNames';
	import { tip } from '$lib/components/tooltip.svelte';

	type Props = {
		width?: number;
		onStartResize: (e: MouseEvent) => void;
		onResizeByKey: (e: KeyboardEvent) => void;
		onClose: () => void;
	};
	let { width = 420, onStartResize, onResizeByKey, onClose }: Props = $props();

	const blocked = $derived(agentUnavailable());
	const title = $derived(agentSession.agent ? agentLabel(agentSession.agent) : 'AGENT 对话');
</script>

<aside
	class="bg-surface-50-950 relative flex min-h-0 min-w-0 flex-col border-l"
	style="grid-column: 4; grid-row: 2; width: {width}px"
	aria-label="AGENT 对话"
>
	<!-- WAI-ARIA window-splitter，与 PaneSplitter 同款手势与视觉：7px 抓取区横跨 1px 的边线 -->
	<!-- eslint-disable-next-line svelte/valid-compile -->
	<div
		class="hover:bg-primary-wash active:bg-primary-flood absolute inset-y-0 -left-[3px] z-10 w-[7px] cursor-col-resize transition-colors"
		role="separator"
		aria-orientation="vertical"
		aria-label="调整 AGENT 对话宽度"
		tabindex="0"
		onmousedown={onStartResize}
		onkeydown={onResizeByKey}
	></div>
	<header class="border-surface-200-800 flex shrink-0 items-center gap-2 border-b px-2 py-1">
		<Bot class="size-4 opacity-70" />
		<span class="truncate text-xs font-medium">{title}</span>
		{#if agentSession.history && agentSession.chats.length}
			<span class="text-muted shrink-0 text-[10px]">{agentSession.chats.length}</span>
		{/if}
		<span class="flex-1"></span>
		{#if agentSession.history}
			<!-- 开新对话就放在历史入口旁边：真建一条全新会话，当前会话保留在 DSH 侧栏 -->
			<button
				class="btn-icon btn-icon-sm"
				aria-label="开新对话"
				title="开新对话"
				disabled={agentSession.state !== 'ready'}
				onclick={() => void restartAgentSession(undefined, { fresh: true })}
			>
				<MessageSquarePlus class="size-4" />
			</button>
		{/if}
		{#if agentSession.history}
			<Popover positioning={{ placement: 'bottom-end', offset: { mainAxis: 2 } }} autoFocus={false}>
				<Popover.Trigger class="btn-icon btn-icon-sm" aria-label="历史对话">
					{#snippet element(attrs)}
						<button {...attrs} use:tip={'历史对话'}><History class="size-4" /></button>
					{/snippet}
				</Popover.Trigger>
				<Portal>
					<Popover.Positioner class="z-floating-ui">
						<Popover.Content class="card bg-surface-50-950 border-surface-300-700 w-72 border p-2 shadow-lg">
							<AgentHistoryList />
						</Popover.Content>
					</Popover.Positioner>
				</Portal>
			</Popover>
		{/if}
		<button class="btn-icon btn-icon-sm" aria-label="关闭 AGENT 对话" title="关闭 AGENT 对话" onclick={onClose}>
			<X class="size-4" />
		</button>
	</header>
	{#if blocked}
		<div class="text-muted p-3 text-xs">
			{blocked === 'desktop'
				? '这个宿主没有代理运行时。'
				: blocked === 'folder'
					? '单文件模式不支持代理。'
					: '共享会话的访客不能运行代理。'}
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-hidden">
			<AgentPanel onOpenTerminal={onClose} />
		</div>
	{/if}
</aside>
