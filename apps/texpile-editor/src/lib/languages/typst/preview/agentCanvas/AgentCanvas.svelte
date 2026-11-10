<script lang="ts">
	// 预览上的圈选层：两次真实点击定位区域（左上角 → 右下角），点选的解析走 tinymist
	// 自己的"点击→src-point→LSP"链路（合成事件在 loopback 跨源页里不触发查看器——实测）。
	// 画笔/箭头/文本是可选的辅助标注（纯视觉，画布此时才接管指针）。
	// 两角齐 → 意图卡 → 连同源码行范围一起交给 AGENT。标注当轮即清，持久化 sidecar 是二期。
	import { onMount } from 'svelte';
	import { Crosshair, Eraser, LoaderCircle, Send, Pencil, ArrowUpRight, Type, X } from '@lucide/svelte';
	import { cancelCornerCollection, startCornerCollection } from './regionResolve';
	import { sendRegionEdit, type RegionPayload } from './agentCanvasTurn';

	type Props = {
		/** 预览页已渲染（status.pages > 0）——点击定位的前提 */
		pageReady: boolean;
		/** 一轮送出后调用（父组件收起画布） */
		onDone: () => void;
		/** 收起画布模式 */
		onDismiss: () => void;
	};
	let { pageReady, onDone, onDismiss }: Props = $props();

	type Mode = 'locate' | 'annotate';
	type Tool = 'pen' | 'arrow' | 'text';
	type Pt = { x: number; y: number };
	type Stroke = { kind: 'pen'; pts: Pt[] } | { kind: 'arrow'; from: Pt; to: Pt } | { kind: 'text'; at: Pt; text: string };

	let mode = $state<Mode>('locate');
	let tool = $state<Tool>('pen');
	let canvas = $state<HTMLCanvasElement | null>(null);
	let host = $state<HTMLDivElement | null>(null);
	let strokes = $state<Stroke[]>([]);
	let draft = $state<Stroke | null>(null);
	let phase = $state<'collect' | 'intent' | 'sending'>('collect');
	let collected = $state(0);
	let intent = $state('');
	let error = $state<string | null>(null);
	let textDraft = $state<{ at: Pt; value: string } | null>(null);
	let pendingRegion = $state<RegionPayload | null>(null);

	const busy = $derived(phase === 'sending');

	// ---- 收集流程 ----
	$effect(() => {
		// 挂载即开始收集（pageReady 未就绪时用户点了也解析不出——提示条会说明）
		if (pageReady) beginCollect();
		return () => cancelCornerCollection();
	});

	function beginCollect(): void {
		error = null;
		phase = 'collect';
		collected = 0;
		startCornerCollection(onCorners, (n) => (collected = n));
	}

	function onCorners(
		a: { filepath: string; line: number; character: number },
		b: { filepath: string; line: number; character: number }
	): void {
		function norm(s: string): string {
			return s.replace(/\\/g, '/').toLowerCase();
		}
		if (norm(a.filepath) !== norm(b.filepath)) {
			error = '两个角落在不同的文件里，请重新框选同一页';
			phase = 'collect';
			collected = 0;
			startCornerCollection(onCorners, (n) => (collected = n));
			return;
		}
		pendingRegion = {
			file: a.filepath,
			fromLine: Math.min(a.line, b.line) + 1,
			toLine: Math.max(a.line, b.line) + 1,
			via: 'preview-box'
		};
		phase = 'intent';
	}

	function switchMode(next: Mode): void {
		if (mode === next) return;
		mode = next;
		if (next === 'locate') {
			// 回到定位：重新收集（之前的角点作废，状态条归零）
			if (pageReady) beginCollect();
		} else {
			// 进标注模式：暂停收集（标注点击不该被当角点）
			cancelCornerCollection();
		}
	}

	// ---- 发送 ----
	async function submitIntent(): Promise<void> {
		if (!pendingRegion) return;
		phase = 'sending';
		error = null;
		try {
			await sendRegionEdit(pendingRegion, intent);
			strokes = [];
			pendingRegion = null;
			intent = '';
			phase = 'collect';
			collected = 0;
			if (mode === 'locate') beginCollect();
			onDone();
		} catch (e) {
			phase = 'intent';
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function dismiss(): void {
		cancelCornerCollection();
		onDismiss();
	}

	// ---- 标注画布（仅 annotate 模式接管指针） ----
	let width = $state(0);
	let height = $state(0);
	let observer: ResizeObserver | null = null;
	onMount(() => {
		observer = new ResizeObserver((entries) => {
			const r = entries[0]?.contentRect;
			if (r) {
				width = r.width;
				height = r.height;
			}
		});
		if (host) observer.observe(host);
		return () => observer?.disconnect();
	});
	$effect(() => {
		void width;
		void height;
		void strokes;
		void draft;
		redraw();
	});

	function redraw(): void {
		const c = canvas;
		if (!c || !width || !height) return;
		const dpr = window.devicePixelRatio || 1;
		if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
			c.width = Math.round(width * dpr);
			c.height = Math.round(height * dpr);
		}
		const g = c.getContext('2d');
		if (!g) return;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, width, height);
		const all = draft ? [...strokes, draft] : strokes;
		for (const s of all) drawStroke(g, s);
	}

	function drawStroke(g: CanvasRenderingContext2D, s: Stroke): void {
		// 别名以通过 no-param-reassign（绘图就是要在 ctx 上设置属性）
		const ctx = g;
		ctx.strokeStyle = 'rgba(99,102,241,0.9)';
		ctx.fillStyle = 'rgba(99,102,241,0.9)';
		ctx.lineWidth = 2;
		if (s.kind === 'pen') {
			ctx.beginPath();
			for (let i = 0; i < s.pts.length; i++) {
				const p = s.pts[i];
				if (i === 0) ctx.moveTo(p.x, p.y);
				else ctx.lineTo(p.x, p.y);
			}
			ctx.stroke();
		} else if (s.kind === 'arrow') {
			ctx.beginPath();
			ctx.moveTo(s.from.x, s.from.y);
			ctx.lineTo(s.to.x, s.to.y);
			ctx.stroke();
			const ang = Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x);
			ctx.beginPath();
			ctx.moveTo(s.to.x, s.to.y);
			ctx.lineTo(s.to.x - 10 * Math.cos(ang - 0.45), s.to.y - 10 * Math.sin(ang - 0.45));
			ctx.lineTo(s.to.x - 10 * Math.cos(ang + 0.45), s.to.y - 10 * Math.sin(ang + 0.45));
			ctx.closePath();
			ctx.fill();
		} else if (s.kind === 'text') {
			ctx.font = '13px ui-sans-serif, sans-serif';
			ctx.fillText(s.text, s.at.x, s.at.y);
		}
	}

	let drawing: { kind: Tool; start: Pt; last: Pt; pts: Pt[] } | null = null;

	function local(e: PointerEvent): Pt {
		const r = canvas!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function onDown(e: PointerEvent): void {
		if (mode !== 'annotate') return;
		const p = local(e);
		if (tool === 'text') {
			textDraft = { at: p, value: '' };
			return;
		}
		// 合成事件（自动化测试）没有活动指针，capture 会抛 NotFoundError——不致命，吞掉即可
		try {
			canvas?.setPointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
		drawing = { kind: tool, start: p, last: p, pts: [p] };
	}

	function onMove(e: PointerEvent): void {
		if (!drawing) return;
		const p = local(e);
		drawing.last = p;
		drawing.pts.push(p);
		if (drawing.kind === 'pen') draft = { kind: 'pen', pts: [...drawing.pts] };
		else if (drawing.kind === 'arrow') draft = { kind: 'arrow', from: drawing.start, to: p };
	}

	function onUp(): void {
		if (!drawing) return;
		const d = drawing;
		drawing = null;
		if (d.kind === 'pen' && d.pts.length > 1) strokes = [...strokes, { kind: 'pen', pts: d.pts }];
		else if (d.kind === 'arrow' && (Math.abs(d.last.x - d.start.x) > 6 || Math.abs(d.last.y - d.start.y) > 6))
			strokes = [...strokes, { kind: 'arrow', from: d.start, to: d.last }];
		draft = null;
		redraw();
	}

	function commitText(): void {
		if (textDraft && textDraft.value.trim()) strokes = [...strokes, { kind: 'text', at: textDraft.at, text: textDraft.value.trim() }];
		textDraft = null;
	}

	function clearAll(): void {
		strokes = [];
		draft = null;
		error = null;
	}
</script>

<!-- 根层对指针放行：定位模式的真实点击要落到预览页上；只有工具条/意图卡/标注画布自己接管 -->
<div bind:this={host} class="absolute inset-0 z-30" style:pointer-events="none">
	<!-- 标注画布：仅 annotate 模式接管指针 -->
	<canvas
		bind:this={canvas}
		class="absolute inset-0 h-full w-full"
		class:cursor-crosshair={mode === 'annotate'}
		style:pointer-events={mode === 'annotate' ? 'auto' : 'none'}
		style:touch-action="none"
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={onUp}
		onpointerleave={onUp}
	></canvas>

	<!-- 工具条 -->
	<div
		class="bg-surface-100-900 border-surface-300-700 rounded-container absolute top-2 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 border p-1 shadow-sm"
		style:pointer-events="auto"
	>
		<button
			class="btn-icon btn-icon-sm {mode === 'locate' ? 'preset-filled-primary-500' : ''}"
			aria-label="点击定位"
			title="点击定位：在预览上点区域的左上角、再点右下角"
			onclick={() => switchMode('locate')}
		>
			<Crosshair class="size-4" />
		</button>
		<span class="bg-surface-300-700 mx-0.5 h-4 w-px"></span>
		<button
			class="btn-icon btn-icon-sm {mode === 'annotate' && tool === 'pen' ? 'preset-filled-primary-500' : ''}"
			aria-label="画笔标注"
			title="画笔标注"
			onclick={() => {
				mode = 'annotate';
				tool = 'pen';
			}}
		>
			<Pencil class="size-4" />
		</button>
		<button
			class="btn-icon btn-icon-sm {mode === 'annotate' && tool === 'arrow' ? 'preset-filled-primary-500' : ''}"
			aria-label="箭头标注"
			title="箭头标注"
			onclick={() => {
				mode = 'annotate';
				tool = 'arrow';
			}}
		>
			<ArrowUpRight class="size-4" />
		</button>
		<button
			class="btn-icon btn-icon-sm {mode === 'annotate' && tool === 'text' ? 'preset-filled-primary-500' : ''}"
			aria-label="文字标注"
			title="文字标注"
			onclick={() => {
				mode = 'annotate';
				tool = 'text';
			}}
		>
			<Type class="size-4" />
		</button>
		<span class="bg-surface-300-700 mx-0.5 h-4 w-px"></span>
		<button class="btn-icon btn-icon-sm" aria-label="清除标注" title="清除标注" onclick={clearAll}>
			<Eraser class="size-4" />
		</button>
		<button
			class="btn btn-sm preset-filled-primary-500 ml-1 gap-1 px-2 text-xs"
			disabled={collected < 2 || busy}
			onclick={() => (phase = 'intent')}
			aria-label="查看圈选结果并填写意图"
			title="查看圈选结果并填写意图"
		>
			{#if busy}
				<LoaderCircle class="size-3.5 animate-spin" />
			{:else}
				<Send class="size-3.5" />
			{/if}
			意图
		</button>
		<button class="btn-icon btn-icon-sm ml-0.5" aria-label="退出圈选模式" title="退出圈选模式" onclick={dismiss}>
			<X class="size-4" />
		</button>
	</div>

	<!-- 定位进度条 -->
	{#if mode === 'locate'}
		<div
			class="bg-surface-100-900 border-surface-300-700 rounded-container absolute top-14 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 border px-2.5 py-1 text-xs"
			style:pointer-events="none"
		>
			{#if !pageReady}
				<span class="text-muted">等预览渲染出内容再点击定位</span>
			{:else if collected === 0}
				<Crosshair class="text-primary-ink size-3.5" /><span>点击区域的<strong>左上角</strong></span>
			{:else if collected === 1}
				<Crosshair class="text-primary-ink size-3.5 animate-pulse" /><span>已记录左上角，再点<strong>右下角</strong></span>
			{:else}
				<span class="text-primary-ink">区域已定位 ✓</span>
			{/if}
		</div>
	{/if}

	<!-- 文字标注的即时输入 -->
	{#if textDraft}
		<input
			class="bg-surface-50-950 border-surface-300-700 rounded-base absolute z-40 border px-2 py-1 text-xs shadow-sm"
			style:left={`${textDraft.at.x}px`}
			style:top={`${textDraft.at.y + 8}px`}
			style:pointer-events="auto"
			bind:value={textDraft.value}
			onkeydown={(e) => {
				if (e.key === 'Enter') commitText();
				if (e.key === 'Escape') textDraft = null;
			}}
			placeholder="标注文字，回车确认"
		/>
	{/if}

	<!-- 意图卡：两角定位完成后填写修改意图 -->
	{#if phase === 'intent'}
		<div
			class="bg-surface-50-950 border-surface-300-700 rounded-container absolute top-14 left-1/2 z-40 w-80 -translate-x-1/2 border p-3 shadow-lg"
			style:pointer-events="auto"
		>
			<p class="text-muted mb-1.5 text-[11px]">区域已定位到源码，写一句你想让 AI 做什么：</p>
			<textarea
				class="border-surface-300-700 bg-surface-50-950 rounded-base h-16 w-full resize-none border p-2 text-sm"
				bind:value={intent}
				placeholder="例：把这个公式改成带编号的展示式，并补一句说明"></textarea>
			<div class="mt-2 flex justify-end gap-1.5">
				<button
					class="btn btn-sm preset-tonal px-2 text-xs"
					onclick={() => {
						phase = 'collect';
						if (mode === 'locate' && pageReady) beginCollect();
					}}>返回</button
				>
				<button
					class="btn btn-sm preset-filled-primary-500 gap-1 px-2 text-xs"
					disabled={!intent.trim()}
					onclick={() => void submitIntent()}
				>
					{#if busy}
						<LoaderCircle class="size-3.5 animate-spin" />
					{:else}
						<Send class="size-3.5" />
					{/if}
					发送
				</button>
			</div>
		</div>
	{/if}

	{#if error}
		<p
			class="text-error-ink bg-surface-50-950 border-surface-300-700 rounded-base absolute bottom-2 left-1/2 z-40 -translate-x-1/2 border px-2 py-1 text-xs"
		>
			{error}
		</p>
	{/if}

	{#if !pageReady}
		<p class="text-muted absolute bottom-2 left-1/2 z-40 -translate-x-1/2 text-xs" style:pointer-events="none">
			等预览渲染出内容再点击定位
		</p>
	{/if}
</div>
