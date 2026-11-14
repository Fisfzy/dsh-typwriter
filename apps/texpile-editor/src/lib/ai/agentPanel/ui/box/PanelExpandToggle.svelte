<script lang="ts">
	// 面板底栏的思维链/工具步骤展开开关：全局默认态（agentPanelView）一键翻转，
	// 单条的本地覆盖不受影响（见 AgentThought/AgentSteps）。
	import { ChevronsDownUp, ChevronsUpDown } from '@lucide/svelte';
	import { tip } from '$lib/components/tooltip.svelte';
	import { agentPanelView, toggleExpanded } from '../../agentPanelView.svelte';
</script>

<button
	type="button"
	class="text-muted hover:bg-surface-200-800 rounded-base flex h-6 shrink-0 items-center gap-0.5 px-1.5 text-xs whitespace-nowrap transition-colors"
	use:tip={agentPanelView.current.expanded ? '折叠思考与步骤' : '展开思考与步骤'}
	aria-label={agentPanelView.current.expanded ? '折叠思考与步骤' : '展开思考与步骤'}
	onclick={toggleExpanded}
>
	{#if agentPanelView.current.expanded}
		<ChevronsDownUp class="size-3.5 shrink-0" />
	{:else}
		<ChevronsUpDown class="size-3.5 shrink-0" />
	{/if}
</button>
