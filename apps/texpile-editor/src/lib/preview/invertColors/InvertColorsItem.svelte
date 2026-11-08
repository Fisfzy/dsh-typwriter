<script lang="ts">
	import { Check, Contrast } from '@lucide/svelte';
	import { tip } from '$lib/components/tooltip.svelte';
	import type { PreviewToolbarPlace } from '$lib/preview/PreviewToolbar.svelte';
	import { pagesInverted, togglePagesInverted } from './pagesInverted';

	const props: { place?: PreviewToolbarPlace } = $props();
	const place = $derived(props.place ?? 'bar');

	const inverted = $derived(pagesInverted());
</script>

<button
	class:menu-item={place === 'menu'}
	aria-pressed={inverted}
	onclick={togglePagesInverted}
	aria-label={'反转页面颜色'}
	use:tip={'反转页面颜色'}
>
	<Contrast size={16} />
	{#if place === 'menu'}Invert colors{#if inverted}<Check size={14} class="ml-auto" />{/if}{/if}
</button>
