<script lang="ts">
	import { isDesktop } from '$lib/workspace/fileSystem';
	import { onWindowButtonsMoved, windowButtonsAtEnd } from '$lib/chrome/windowOverlay';
	import type { PaneLayout } from '$lib/workspace/paneLayout.svelte';
	import type { TerminalDockState } from '$lib/workspace/terminalDockState.svelte';
	import LayoutMenu from './LayoutMenu.svelte';

	type Props = {
		panes: PaneLayout;
		termDock: TerminalDockState;
		/** a file opened on its own has nothing to arrange, so no menu */
		project: boolean;
		splittable: boolean;
	};
	const props: Props = $props();
	// the browser build ends the bar with its download link; the desktop app with whatever window buttons sit on the right
	let buttonsAtEnd = $state(windowButtonsAtEnd());
	$effect(() => onWindowButtonsMoved(() => (buttonsAtEnd = windowButtonsAtEnd())));
	const divided = $derived(!isDesktop() || buttonsAtEnd);
	// 只有被 DSH 宿主用 iframe 嵌进来时才提供「返回 DSH」
	const embedded = typeof window !== 'undefined' && window.self !== window.top;
</script>

{#if props.project}
	<div class="app-no-drag flex items-center self-center {divided ? '' : 'mr-1.5'}">
		<LayoutMenu panes={props.panes} termDock={props.termDock} splittable={props.splittable} />
	</div>
{/if}
{#if divided}
	<div class="border-surface-300-700 mx-2 h-4 w-px shrink-0 self-center border-l"></div>
{/if}

<!-- 右侧：回 DSH 主对话 -->
	<button
		class="app-no-drag rounded-base ml-1 shrink-0 px-2 py-1 text-xs hover:preset-tonal"
		title={'返回 DSH'}
		onclick={() => { try { window.parent.postMessage({ type: 'typwriter:back' }, '*'); } catch { /* ignore */ } }}
	>返回 DSH</button>
