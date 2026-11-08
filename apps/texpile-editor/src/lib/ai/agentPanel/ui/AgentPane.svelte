<script lang="ts">
	// 右侧独立的代理面板：与 PDF 预览并列，占编辑器网格的最后一列。
	// 固定宽度（暂不做拖拽）——先把"侧边独立"跑通。
	import { Bot, PanelRightClose, X } from '@lucide/svelte';
	import AgentPanel from './AgentPanel.svelte';
	import { agentSession } from '../agentSession.svelte';
	import { agentUnavailable } from '../agentAvailability';
	import { agentLabel } from '../agentNames';
	import { tip } from '$lib/components/tooltip.svelte';

	type Props = {
		width?: number;
		onClose: () => void;
	};
	let { width = 420, onClose }: Props = $props();

	const blocked = $derived(agentUnavailable());
	const title = $derived(agentSession.agent ? agentLabel(agentSession.agent) : '代理对话');
</script>

<aside
	class="bg-surface-50-950 relative flex min-h-0 min-w-0 flex-col border-l"
	style="grid-column: 4; grid-row: 2; width: {width}px"
	aria-label={'代理对话'}
>
	<!-- 与 PDF 预览同款的贴分隔线收起 toggle；重新展开走窗口右缘的按钮列 -->
	<button
		class="bg-surface-200-800 border-surface-300-700 hover:preset-tonal absolute -left-3 top-2 z-40 flex size-6 items-center justify-center rounded-base border shadow-md"
		use:tip={'收起代理面板'}
		aria-label="收起代理面板"
		onmousedown={(e) => e.preventDefault()}
		onclick={onClose}
	>
		<PanelRightClose class="size-3.5 shrink-0" />
	</button>
	<header class="border-surface-200-800 flex shrink-0 items-center gap-2 border-b px-2 py-1">
		<Bot class="size-4 opacity-70" />
		<span class="truncate text-xs font-medium">{title}</span>
		<span class="flex-1"></span>
		<button class="btn-icon btn-icon-sm" aria-label={'关闭代理面板'} title={'关闭代理面板'} onclick={onClose}>
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
