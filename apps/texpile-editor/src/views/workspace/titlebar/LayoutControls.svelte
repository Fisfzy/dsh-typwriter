<script lang="ts">
	import { isDesktop } from '$lib/workspace/fileSystem';
	import { onWindowButtonsMoved, windowButtonsAtEnd } from '$lib/chrome/windowOverlay';
	import type { PaneLayout } from '$lib/workspace/paneLayout.svelte';
	import type { TerminalDockState } from '$lib/workspace/terminalDockState.svelte';
	import LayoutMenu from './LayoutMenu.svelte';
	import { Bot } from '@lucide/svelte';
	import { tip } from '$lib/components/tooltip.svelte';
	import { acpBridge } from '$lib/ai/agentPanel/acpBridge';
	import { panelTabOff } from '$lib/ai/agentPanel/agentOffer.svelte';

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
	// the AGENT pane can run here: the bridge exists and AI is not turned off (same gate as LayoutMenu's items)
	const agentOn = $derived(!panelTabOff() && !!acpBridge());
</script>

{#if props.project}
	<div class="app-no-drag flex items-center self-center {divided ? '' : 'mr-1.5'}">
		<!-- AGENT 对话：从布局菜单里独立出来，常驻在「布局」左边；tint = 面板开着 -->
		{#if agentOn}
			<button
				class="btn btn-sm preset-tonal mr-0.5 gap-1 px-2 text-xs {props.panes.agentPaneOpen ? 'preset-filled-primary-500' : ''}"
				use:tip={'AGENT 对话'}
				aria-label="AGENT 对话"
				aria-pressed={props.panes.agentPaneOpen}
				onclick={() => props.panes.setAgentPane(!props.panes.agentPaneOpen)}
			>
				<Bot class="size-3.5 shrink-0" />
				<span class="hidden xl:inline">AGENT 对话</span>
			</button>
		{/if}
		<LayoutMenu panes={props.panes} termDock={props.termDock} splittable={props.splittable} />
	</div>
{/if}
{#if divided}
	<div class="border-surface-300-700 mx-2 h-4 w-px shrink-0 self-center border-l"></div>
{/if}
