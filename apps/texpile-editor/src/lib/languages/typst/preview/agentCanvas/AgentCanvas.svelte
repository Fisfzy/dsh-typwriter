<script lang="ts">
	// 预览上的圈选画布：框选出区域（两个角点经 tinymist 合成点击解析为源码行范围），
	// 画笔/箭头/文本作为意图的辅助标注，一张卡写意图，全部交给 AGENT。
	// 标注是当轮的意图输入，发送后即清——持久化 sidecar 是二期的事。
	import { onMount } from 'svelte';
	import { Eraser, LoaderCircle, Send, SquareDashed, Pencil, ArrowUpRight, Type, X } from '@lucide/svelte';
	import { collectNextJump } from './regionResolve';
	import { sendRegionEdit, type RegionPayload } from './agentCanvasTurn';

	type Props = {
		/** 预览页已渲染（status.pages > 0）——角点解析的前提 */
		pageReady: boolean;
		/** 把消息转进预览 iframe（agent-click 从这里走） */
		sendToFrame: (msg: Record<string, unknown>) => void;
		/** 一轮送出后调用（父组件收起画布） */
		onDone: () => void;
		/** 收起画布模式 */
		onDismiss: () => void;
	};
	let { pageReady, sendToFrame, onDone, onDismiss }: Props = $props();

	type Tool = 'region' | 'pen' | 'arrow' | 'text';
	type Pt = { x: number; y: number };
	type Stroke = { kind: 'pen'; pts: Pt[] } | { kind: 'arrow'; from: Pt; to: Pt } | { kind: 'text'; at: Pt; text: string };

	let tool = $state<Tool>('region');
	let canvas = $state<HTMLCanvasElement | null>(null);
	let host = $state<HTMLDivElement | null>(null);
	let strokes = $state<Stroke[]>([]);
	let region = $state<{ x: number; y: number; w: number; h: number } | null>(null);
	let draft = $state<Stroke | null>(null);
	let phase = $state<'draw' | 'resolving' | 'intent' | 'sending'>('draw');
	let intent = $state('');
	let error = $state<string | null>(null);
	let textDraft = $state<{ at: Pt; value: string } | null>(null);

	const busy = $derived(phase === 'resolving' || phase === 'sending');

	// ---- 画布尺寸与重绘 ----
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
		// tracked: 尺寸与全部笔画
		void width;
		void height;
		void strokes;
		void region;
		void draft;
		void tool;
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
		if (region) {
			// 活跃区域：实线框 + 角点标记（角点是要被解析成源码位置的）
			g.strokeStyle = '#6366f1';
			g.lineWidth = 1.5;
			g.setLineDash([6, 4]);
			g.strokeRect(region.x, region.y, region.w, region.h);
			g.setLineDash([]);
			g.fillStyle = '#6366f1';
			for (const [cx, cy] of [
				[region.x, region.y],
				[region.x + region.w, region.y + region.h]
			]) {
				g.fillRect(cx - 3, cy - 3, 6, 6);
			}
		}
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

	// ---- 指针 ----
	let drawing: { kind: Tool; start: Pt; last: Pt; pts: Pt[] } | null = null;

	function local(e: PointerEvent): Pt {
		const r = canvas!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function onDown(e: PointerEvent): void {
		if (!armedUsable()) return;
		if (textDraft) {
			commitText();
			return;
		}
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
		if (tool === 'region') region = null;
	}

	function onMove(e: PointerEvent): void {
		if (!drawing) return;
		const p = local(e);
		drawing.last = p;
		drawing.pts.push(p);
		if (drawing.kind === 'region') {
			region = normRect(drawing.start, p);
			draft = null;
		} else if (drawing.kind === 'pen') {
			draft = { kind: 'pen', pts: [...drawing.pts] };
		} else if (drawing.kind === 'arrow') {
			draft = { kind: 'arrow', from: drawing.start, to: p };
		}
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

	function normRect(a: Pt, b: Pt): { x: number; y: number; w: number; h: number } {
		return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
	}

	function commitText(): void {
		if (textDraft && textDraft.value.trim()) strokes = [...strokes, { kind: 'text', at: textDraft.at, text: textDraft.value.trim() }];
		textDraft = null;
	}

	function clearAll(): void {
		strokes = [];
		region = null;
		draft = null;
		error = null;
	}

	function armedUsable(): boolean {
		return pageReady && !busy;
	}

	// ---- 发送：两角解析 → 意图卡 → 送进面板 ----
	let pendingRegion = $state<RegionPayload | null>(null);

	async function resolveRegion(): Promise<void> {
		if (!region || region.w < 8 || region.h < 8) {
			error = '先用框选工具圈一个区域';
			return;
		}
		error = null;
		phase = 'resolving';
		const inset = 2;
		try {
			// 先 arm 收集器再派点击：解析结果可能比 postMessage 的回执还快回来
			const p1 = collectNextJump();
			sendToFrame({ type: 'agent-click', x: region.x + inset, y: region.y + inset });
			const a = await p1;
			const p2 = collectNextJump();
			sendToFrame({ type: 'agent-click', x: region.x + region.w - inset, y: region.y + region.h - inset });
			const b = await p2;
			function norm(s: string): string {
				return s.replace(/\\/g, '/').toLowerCase();
			}
			if (norm(a.filepath) !== norm(b.filepath)) {
				throw new Error('圈选横跨了两个文件，先分开圈');
			}
			pendingRegion = {
				file: a.filepath,
				fromLine: Math.min(a.line, b.line) + 1,
				toLine: Math.max(a.line, b.line) + 1,
				via: 'preview-box'
			};
			phase = 'intent';
		} catch (e) {
			phase = 'draw';
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function submitIntent(): Promise<void> {
		if (!pendingRegion) return;
		phase = 'sending';
		error = null;
		try {
			await sendRegionEdit(pendingRegion, intent);
			strokes = [];
			region = null;
			pendingRegion = null;
			intent = '';
			phase = 'draw';
			onDone();
		} catch (e) {
			phase = 'intent';
			error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<div bind:this={host} class="absolute inset-0 z-30">
	<!-- 画布本体：armed 即接管指针；正在解析/发送时显示忙碌态 -->
	<canvas
		bind:this={canvas}
		class="absolute inset-0 h-full w-full"
		class:cursor-crosshair={tool === 'region' && armedUsable()}
		style:pointer-events={busy ? 'none' : 'auto'}
		style:touch-action="none"
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={onUp}
		onpointerleave={onUp}
	></canvas>

	<!-- 工具条 -->
	<div
		class="bg-surface-100-900 border-surface-300-700 rounded-container absolute top-2 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 border p-1 shadow-sm"
	>
		<button
			class="btn-icon btn-icon-sm {tool === 'region' ? 'preset-filled-primary-500' : ''}"
			aria-label="框选区域"
			title="框选区域（发给 AI 的目标）"
			onclick={() => (tool = 'region')}
		>
			<SquareDashed class="size-4" />
		</button>
		<button
			class="btn-icon btn-icon-sm {tool === 'pen' ? 'preset-filled-primary-500' : ''}"
			aria-label="画笔标注"
			title="画笔标注"
			onclick={() => (tool = 'pen')}
		>
			<Pencil class="size-4" />
		</button>
		<button
			class="btn-icon btn-icon-sm {tool === 'arrow' ? 'preset-filled-primary-500' : ''}"
			aria-label="箭头标注"
			title="箭头标注"
			onclick={() => (tool = 'arrow')}
		>
			<ArrowUpRight class="size-4" />
		</button>
		<button
			class="btn-icon btn-icon-sm {tool === 'text' ? 'preset-filled-primary-500' : ''}"
			aria-label="文字标注"
			title="文字标注"
			onclick={() => (tool = 'text')}
		>
			<Type class="size-4" />
		</button>
		<span class="bg-surface-300-700 mx-1 h-4 w-px"></span>
		<button class="btn-icon btn-icon-sm" aria-label="清除标注" title="清除标注" onclick={clearAll}>
			<Eraser class="size-4" />
		</button>
		<button
			class="btn btn-sm preset-filled-primary-500 ml-1 gap-1 px-2 text-xs"
			disabled={!region || busy || phase === 'intent'}
			onclick={() => void resolveRegion()}
			aria-label="发送给 AI 修改"
			title="把圈选范围与标注发给 AGENT"
		>
			{#if busy}
				<LoaderCircle class="size-3.5 animate-spin" />
			{:else}
				<Send class="size-3.5" />
			{/if}
			{phase === 'resolving' ? '解析中…' : '发给 AI'}
		</button>
		<button class="btn-icon btn-icon-sm ml-0.5" aria-label="退出圈选模式" title="退出圈选模式" onclick={onDismiss}>
			<X class="size-4" />
		</button>
	</div>

	<!-- 文字标注的即时输入 -->
	{#if textDraft}
		<input
			class="bg-surface-50-950 border-surface-300-700 rounded-base absolute z-40 border px-2 py-1 text-xs shadow-sm"
			style:left={`${textDraft.at.x}px`}
			style:top={`${textDraft.at.y + 8}px`}
			bind:value={textDraft.value}
			onkeydown={(e) => {
				if (e.key === 'Enter') commitText();
				if (e.key === 'Escape') textDraft = null;
			}}
			placeholder="标注文字，回车确认"
		/>
	{/if}

	<!-- 意图卡：角点解析完成后填写修改意图 -->
	{#if phase === 'intent'}
		<div
			class="bg-surface-50-950 border-surface-300-700 rounded-container absolute top-14 left-1/2 z-40 w-80 -translate-x-1/2 border p-3 shadow-lg"
		>
			<p class="text-muted mb-1.5 text-[11px]">区域已定位到源码，写一句你想让 AI 做什么：</p>
			<textarea
				class="border-surface-300-700 bg-surface-50-950 rounded-base h-16 w-full resize-none border p-2 text-sm"
				bind:value={intent}
				placeholder="例：把这个公式改成带编号的展示式，并补一句说明"></textarea>
			<div class="mt-2 flex justify-end gap-1.5">
				<button class="btn btn-sm preset-tonal px-2 text-xs" onclick={() => (phase = 'draw')}>返回</button>
				<button
					class="btn btn-sm preset-filled-primary-500 gap-1 px-2 text-xs"
					disabled={!intent.trim()}
					onclick={() => void submitIntent()}
				>
					<Send class="size-3.5" />发送
				</button>
			</div>
		</div>
	{/if}

	{#if error}
		<p
			class="text-error-ink bg-surface-50-950 rounded-base absolute bottom-2 left-1/2 z-40 -translate-x-1/2 border px-2 py-1 text-xs"
			style:border-color="currentColor"
		>
			{error}
		</p>
	{/if}

	{#if !pageReady && !busy}
		<p class="text-muted absolute bottom-2 left-1/2 z-40 -translate-x-1/2 text-xs">等预览渲染出内容再圈选</p>
	{/if}
</div>
