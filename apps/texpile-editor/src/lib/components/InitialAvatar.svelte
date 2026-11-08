<script lang="ts">
	// The round initial that stands in for a person: session peers in the title bar, comment authors
	// in the review panel. Shared so the two cannot drift into looking like different products.
	import { tip } from '$lib/components/tooltip.svelte';
	import { colorFor } from './initialColor';
	type Props = {
		name: string;
		/** an assigned colour (a session peer has one); omitted, it is derived from the name */
		color?: string | null;
		class?: string;
	};
	let { name, color = null, class: extra = 'size-5 text-[10px]' }: Props = $props();
</script>

<span
	class="flex shrink-0 items-center justify-center rounded-full font-bold text-white {extra}"
	style="background-color: {color ?? colorFor(name)}"
	use:tip={name}
>
	{(name || '?').slice(0, 1).toUpperCase()}
</span>
