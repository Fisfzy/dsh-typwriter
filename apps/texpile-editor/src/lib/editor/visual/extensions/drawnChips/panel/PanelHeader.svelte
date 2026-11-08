<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = { title: string; command?: string; children?: Snippet };

	const props: Props = $props();
</script>

<div class="flex min-h-6 items-center justify-between gap-2">
	<span class="text-sm font-medium">{props.title}</span>
	{#if props.children}
		{@render props.children()}
	{:else if props.command}
		<span class="text-muted truncate font-mono text-xs">{props.command}</span>
	{/if}
</div>
