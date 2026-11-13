<script lang="ts">
	// 「划选 → AGENT 修改」的输入卡：用户写一句要求，交给圈选 AGENT 的同一条链路。
	import { untrack } from 'svelte';
	import { ArrowUp, LoaderCircle } from '@lucide/svelte';
	import { toaster } from '$lib/modals/toaster-svelte';
	import { closeAgentEditCard, agentEditCard, agentEditService } from './agentSelectionEdit.svelte';
	import { editorViewStore } from '$lib/stores/editorStore';
	import { setPmCommentPending } from '$lib/editor/visual/extensions/pmComments';

	const EDGE = 8;
	let card = $state<HTMLDivElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);
	let prompt = $state('');
	let sending = $state(false);
	let placed = $state.raw<{ x: number; y: number; for: object } | null>(null);

	$effect(() => {
		const open = agentEditCard.current;
		if (!open || !card) return;
		const { offsetWidth: w, offsetHeight: h } = card;
		const y = open.anchor.top - h - 6 >= EDGE ? open.anchor.top - h - 6 : open.anchor.bottom + 6;
		placed = { x: Math.max(EDGE, Math.min(open.anchor.left, window.innerWidth - w - EDGE)), y, for: open };
		input?.focus();
	});

	$effect(() => {
		if (!agentEditCard.current) return;
		return untrack(() => {
			const view = editorViewStore.current;
			const sel = view?.state.selection;
			if (!view || !sel || sel.empty || !view.dom.checkVisibility()) return;
			setPmCommentPending(view, { from: sel.from, to: sel.to });
			return () => queueMicrotask(() => !view.isDestroyed && setPmCommentPending(view, null));
		});
	});

	async function submit(): Promise<void> {
		const text = prompt.trim();
		const service = agentEditService.current;
		if (!text || !service || sending) return;
		sending = true;
		try {
			const error = await service.send(text);
			if (error) {
				toaster.error({ title: error, duration: 6000 });
				return;
			}
			prompt = '';
			closeAgentEditCard();
		} finally {
			sending = false;
		}
	}
</script>

<svelte:window onkeydown={(e) => agentEditCard.current && e.key === 'Escape' && closeAgentEditCard()} />

{#if agentEditCard.current}
	{@const open = agentEditCard.current}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="z-dropdown fixed inset-0" onpointerdown={closeAgentEditCard}></div>
	<div
		bind:this={card}
		data-keep-caret
		role="dialog"
		aria-label="AGENT 修改选中内容"
		class="bg-surface-50-950 border-surface-300-700 z-dropdown card fixed w-max max-w-[calc(100vw-16px)] min-w-96 border shadow-lg"
		style="left: {placed?.x ?? open.anchor.left}px; top: {placed?.y ?? open.anchor.bottom}px; opacity: {placed?.for === open ? 1 : 0}"
	>
		<div class="text-muted truncate px-3 pt-1.5 text-[11px]" title={open.snippet}>
			将交给 AGENT 修改：{open.region.file.split(/[\\/]/).pop()} L{open.region.fromLine}–{open.region.toLine} · {open.snippet.slice(0, 40)}
		</div>
		<form
			class="flex items-center gap-2 px-3 py-2"
			onsubmit={(e) => {
				e.preventDefault();
				void submit();
			}}
		>
			<input
				class="min-w-0 flex-1 bg-transparent text-sm outline-none"
				placeholder="告诉 AGENT 怎么改这段内容…"
				bind:value={prompt}
				bind:this={input}
				disabled={sending}
			/>
			<button
				type="submit"
				class="btn-icon btn-icon-sm preset-tonal shrink-0 rounded-full"
				disabled={!prompt.trim() || sending}
				aria-label="发送给 AGENT"
			>
				{#if sending}
					<LoaderCircle class="size-4 animate-spin" />
				{:else}
					<ArrowUp class="size-4" />
				{/if}
			</button>
		</form>
	</div>
{/if}
