<script module lang="ts">
	import type { Bold } from '@lucide/svelte';

	export type SourceToolbarButtonProps = {
		label: string;
		/** tooltip text when it says more than the label */
		title?: string;
		action: (e: MouseEvent) => void;
		Icon?: typeof Bold;
		/** in place of an icon: H1, H2 */
		text?: string;
		iconClass?: string;
		/** first control of a group: a hairline on its left */
		divider?: boolean;
	};
</script>

<script lang="ts">
	import { tip } from '$lib/components/tooltip.svelte';

	let { label, title, action, Icon, text, iconClass = 'h-4.5 w-4.5', divider = false }: SourceToolbarButtonProps = $props();
</script>

<div class="flex items-center {divider ? 'border-surface-300-700 border-l pl-1.5 sm:pl-2' : ''}">
	<div class="toolbarButton hover:preset-tonal">
		<button
			onclick={action}
			class={text ? 'flex h-6 min-w-6 items-center justify-center px-1 text-xs font-semibold' : 'flex items-center p-1'}
			aria-label={label}
			use:tip={title ?? label}
		>
			{#if Icon}<Icon class={iconClass} />{:else}{text}{/if}
		</button>
	</div>
</div>

<style lang="postcss">
	@reference "../../../../app.css";

	.toolbarButton {
		@apply rounded-base transition-all ease-in-out;
	}
</style>
