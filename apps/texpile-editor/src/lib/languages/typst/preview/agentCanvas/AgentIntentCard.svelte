<script lang="ts">
	// 意图卡：两角定位完成后填写修改要求，连同源码行范围一起发送。
	import { LoaderCircle, Send } from '@lucide/svelte';
	import type { RangeDescription } from './describeRange';

	type Props = {
		intent: string;
		/** 已解析出的源码范围：显示出来并允许微调，避免用户不知道 agent 会改哪几行 */
		range?: { file: string; fromLine: number; toLine: number } | null;
		/** 范围的内容特征（正文/几级标题/图表…），发送前让用户确认 */
		details?: RangeDescription | null;
		busy?: boolean;
		/** 发送/定位失败的原因（卡内直接可见，而不是沉到底部细条） */
		error?: string | null;
		onRangeChange?: (from: number, to: number) => void;
		onBack: () => void;
		onSend: () => void;
	};
	let { intent = $bindable(''), range = null, details = null, busy = false, error = null, onRangeChange, onBack, onSend }: Props = $props();

	const fileName = $derived(range ? (range.file.split(/[\\/]/).pop() ?? range.file) : '');

	function setFrom(value: string): void {
		if (!range || !onRangeChange) return;
		const n = Math.max(1, Math.floor(Number(value) || 1));
		onRangeChange(n, Math.max(n, range.toLine));
	}
	function setTo(value: string): void {
		if (!range || !onRangeChange) return;
		const n = Math.max(range.fromLine, Math.floor(Number(value) || range.fromLine));
		onRangeChange(range.fromLine, n);
	}
</script>

<div
	class="bg-surface-50-950 border-surface-300-700 rounded-container absolute top-14 left-1/2 z-40 w-80 -translate-x-1/2 border p-3 shadow-lg"
	style:pointer-events="auto"
>
	{#if error}
		<p class="text-error-ink mb-1.5 text-[11px] leading-relaxed">{error}</p>
	{:else}
		<p class="text-muted mb-1.5 text-[11px]">区域已定位到源码，写一句你想让 AI 做什么：</p>
	{/if}
	{#if range}
		<div class="text-muted mb-1.5 flex items-center gap-1 text-[11px]">
			<span class="min-w-0 flex-1 truncate font-mono" title={range.file}>{fileName}</span>
			<span>L</span>
			<input
				type="number"
				min="1"
				class="border-surface-300-700 bg-surface-50-950 rounded-base h-6 w-12 border px-1 text-center text-[11px]"
				value={range.fromLine}
				onchange={(e) => setFrom(e.currentTarget.value)}
				aria-label="起始行"
			/>
			<span>–</span>
			<input
				type="number"
				min="1"
				class="border-surface-300-700 bg-surface-50-950 rounded-base h-6 w-12 border px-1 text-center text-[11px]"
				value={range.toLine}
				onchange={(e) => setTo(e.currentTarget.value)}
				aria-label="结束行"
			/>
		</div>
	{/if}
	{#if details}
		<div class="text-muted mb-1.5 space-y-0.5 text-[11px] leading-relaxed">
			<div class="truncate" title={details.title}>内容：{details.title}</div>
			{#if details.firstLine}<div class="truncate" title={details.firstLine}>首行：{details.firstLine}</div>{/if}
			{#if details.lastLine}<div class="truncate" title={details.lastLine}>末行：{details.lastLine}</div>{/if}
		</div>
	{/if}
	<textarea
		class="border-surface-300-700 bg-surface-50-950 rounded-base h-16 w-full resize-none border p-2 text-sm"
		bind:value={intent}
		placeholder="例：把这个公式改成带编号的展示式，并补一句说明"></textarea>
	<div class="mt-2 flex justify-end gap-1.5">
		<button class="btn btn-sm preset-tonal px-2 text-xs" onclick={onBack}>返回</button>
		<button class="btn btn-sm preset-filled-primary-500 gap-1 px-2 text-xs" disabled={!intent.trim() || busy} onclick={onSend}>
			{#if busy}
				<LoaderCircle class="size-3.5 animate-spin" />
			{:else}
				<Send class="size-3.5" />
			{/if}
			发送
		</button>
	</div>
</div>
