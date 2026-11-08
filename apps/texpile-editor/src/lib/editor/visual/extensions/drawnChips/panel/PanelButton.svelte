<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = { onclick: () => void; children: Snippet };

	const props: Props = $props();
</script>

<button
	type="button"
	class="border-surface-300-700 rounded-base hover:preset-tonal inline-flex h-7 items-center gap-1.5 self-start border px-2.5 text-xs"
	onclick={props.onclick}
>
	{@render props.children()}
</button>
