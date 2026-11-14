<script lang="ts">
	// What the agent thought on the way, folded to one line.
	// The panel's expand switch (agentPanelView) sets the default; a click on this row overrides
	// it locally for as long as the switch stays put.
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import { m } from '$lib/paraglide/messages';
	import { agentPanelView } from '../../agentPanelView.svelte';

	type Props = { text: string };
	const props: Props = $props();
	// null = 跟随面板开关；点击过的条记本地覆盖，全局翻转不追溯
	let localOverride = $state<boolean | null>(null);
	const open = $derived(localOverride ?? agentPanelView.current.expanded);
</script>

<div class="text-muted -mx-1 text-xs">
	<button
		class="hover:preset-tonal rounded-base flex items-center gap-1 px-1 py-0.5"
		aria-expanded={open}
		onclick={() => (localOverride = !(localOverride ?? agentPanelView.current.expanded))}
	>
		{#if open}<ChevronDown class="size-3.5" />{:else}<ChevronRight class="size-3.5" />{/if}
		<span class="cap-center">{m.agent_panel_thinking()}</span>
	</button>
	{#if open}<p class="mt-1 pl-5 break-words whitespace-pre-wrap italic">{props.text}</p>{/if}
</div>
