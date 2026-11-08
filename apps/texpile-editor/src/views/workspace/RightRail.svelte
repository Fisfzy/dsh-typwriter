<script lang="ts">
	// 窗口右缘的活动栏：右侧功能页面的总开关——PDF 审阅、AGENT 对话、代码修改。
	// 一个图标对应一个页面（浏览器标签式的控制逻辑）：点击开关该页，高亮 = 页面开着。
	// 页面本体是编辑区右侧的各面板；这条栏常驻，收起面板后从这里再开。
	import { Bot, FileDiff, FileText } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import { tip } from '$lib/components/tooltip.svelte';

	type Props = {
		pdfOpen: boolean;
		agentOpen: boolean;
		scmOpen: boolean;
		/** the AGENT page needs a runnable bridge and AI on; without it the icon hides */
		agentOn: boolean;
		onTogglePdf: () => void;
		onToggleAgent: () => void;
		onToggleScm: () => void;
	};
	const props: Props = $props();

	type RailItem = { key: string; icon: Component; label: string; on: boolean; run: () => void };
	const items = $derived<RailItem[]>([
		{ key: 'pdf', icon: FileText, label: 'PDF 审阅', on: props.pdfOpen, run: props.onTogglePdf },
		...(props.agentOn ? [{ key: 'agent', icon: Bot, label: 'AGENT 对话', on: props.agentOpen, run: props.onToggleAgent }] : []),
		{ key: 'scm', icon: FileDiff, label: '代码修改', on: props.scmOpen, run: props.onToggleScm }
	]);
</script>

<nav
	class="border-surface-200-800 bg-surface-50-950 z-30 flex w-10 shrink-0 flex-col items-center gap-1 border-l py-2"
	aria-label="右侧页面"
>
	{#each items as it (it.key)}
		{@const Icon = it.icon}
		<button
			class="btn-icon btn-icon-sm relative {it.on ? 'text-primary-ink' : 'hover:preset-tonal'}"
			use:tip={it.label}
			aria-label={it.label}
			aria-pressed={it.on}
			onclick={it.run}
		>
			<Icon class="size-4" />
			<!-- active 的左侧竖条：与左栏视图切换同一种"这是当前页"的语言 -->
			<span class="bg-primary-500 absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r" class:hidden={!it.on}></span>
		</button>
	{/each}
</nav>
