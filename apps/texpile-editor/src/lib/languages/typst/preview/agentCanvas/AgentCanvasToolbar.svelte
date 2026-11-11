<script lang="ts">
	// 圈选画布的工具条：两种定位（框选/点击定位）+ 三种辅助标注 + 清除/意图/退出。
	import { ArrowUpRight, Crosshair, Eraser, LoaderCircle, Pencil, Send, SquareDashed, Type, X } from '@lucide/svelte';

	type Mode = 'region' | 'locate' | 'annotate';
	type Tool = 'pen' | 'arrow' | 'text';

	type Props = {
		mode: Mode;
		tool: Tool;
		/** 已收集角点数（点击定位进度 0/1/2） */
		collected: number;
		busy?: boolean;
		onSwitch: (mode: Mode) => void;
		onTool: (tool: Tool) => void;
		onClear: () => void;
		onIntent: () => void;
		onDismiss: () => void;
	};
	let { mode, tool, collected, pageReady, busy = false, onSwitch, onTool, onClear, onIntent, onDismiss }: Props = $props();
</script>

<div
	class="bg-surface-100-900 border-surface-300-700 rounded-container absolute top-2 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 border p-1 shadow-sm"
	style:pointer-events="auto"
>
	<button
		class="btn-icon btn-icon-sm {mode === 'region' ? 'preset-filled-primary-500' : ''}"
		aria-label="框选区域"
		title="框选区域：画一个框，发送时自动定位到源码"
		onclick={() => onSwitch('region')}
	>
		<SquareDashed class="size-4" />
	</button>
	<button
		class="btn-icon btn-icon-sm {mode === 'locate' ? 'preset-filled-primary-500' : ''}"
		aria-label="点击定位"
		title="点击定位：在预览上点区域的左上角、再点右下角"
		onclick={() => onSwitch('locate')}
	>
		<Crosshair class="size-4" />
	</button>
	<span class="bg-surface-300-700 mx-0.5 h-4 w-px"></span>
	<button
		class="btn-icon btn-icon-sm {mode === 'annotate' && tool === 'pen' ? 'preset-filled-primary-500' : ''}"
		aria-label="画笔标注"
		title="画笔标注"
		onclick={() => {
			onTool('pen');
			onSwitch('annotate');
		}}
	>
		<Pencil class="size-4" />
	</button>
	<button
		class="btn-icon btn-icon-sm {mode === 'annotate' && tool === 'arrow' ? 'preset-filled-primary-500' : ''}"
		aria-label="箭头标注"
		title="箭头标注"
		onclick={() => {
			onTool('arrow');
			onSwitch('annotate');
		}}
	>
		<ArrowUpRight class="size-4" />
	</button>
	<button
		class="btn-icon btn-icon-sm {mode === 'annotate' && tool === 'text' ? 'preset-filled-primary-500' : ''}"
		aria-label="文字标注"
		title="文字标注"
		onclick={() => {
			onTool('text');
			onSwitch('annotate');
		}}
	>
		<Type class="size-4" />
	</button>
	<span class="bg-surface-300-700 mx-0.5 h-4 w-px"></span>
	<button class="btn-icon btn-icon-sm" aria-label="清除标注" title="清除标注" onclick={onClear}>
		<Eraser class="size-4" />
	</button>
	<button
		class="btn btn-sm preset-filled-primary-500 ml-1 gap-1 px-2 text-xs"
		disabled={busy || (mode === 'locate' && collected < 2)}
		onclick={onIntent}
		aria-label="定位到源码并填写意图"
		title="定位到源码并填写意图"
	>
		{#if busy}
			<LoaderCircle class="size-3.5 animate-spin" />
		{:else}
			<Send class="size-3.5" />
		{/if}
		意图
	</button>
	<button class="btn-icon btn-icon-sm ml-0.5" aria-label="退出圈选模式" title="退出圈选模式" onclick={onDismiss}>
		<X class="size-4" />
	</button>
</div>
