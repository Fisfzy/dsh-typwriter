<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = { label: string; children: Snippet };

	const props: Props = $props();
</script>

<div class="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2">
	<span class="text-muted text-xs">{props.label}</span>
	{@render props.children()}
</div>
