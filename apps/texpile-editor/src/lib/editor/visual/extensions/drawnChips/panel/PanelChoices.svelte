<script lang="ts">
	import { tip } from '$lib/components/tooltip.svelte';
	import type { PanelChoice } from './panelOptions';

	type Props = { options: PanelChoice[]; selected: string | null; label: string; onpick: (value: string) => void };

	const props: Props = $props();
</script>

<div class="flex flex-col" role="radiogroup" aria-label={props.label}>
	{#each props.options as option (option.value)}
		{@const on = props.selected === option.value}
		<button
			type="button"
			role="radio"
			aria-checked={on}
			data-autofocus={on ? '' : undefined}
			class="rounded-base flex h-7 items-center gap-2 px-1.5 text-left text-sm {on ? 'preset-tonal-primary' : 'hover:preset-tonal'}"
			use:tip={option.hint ?? ''}
			onclick={() => props.onpick(option.value)}
		>
			<span class="size-2.5 shrink-0 rounded-full {on ? 'border-primary-500 border-[3px]' : 'border-surface-400-600 border'}"></span>
			<span class="min-w-0 flex-1 truncate">{option.label}</span>
			<span class="shrink-0 font-mono text-xs {on ? '' : 'text-muted'}">{option.detail}</span>
		</button>
	{/each}
</div>
