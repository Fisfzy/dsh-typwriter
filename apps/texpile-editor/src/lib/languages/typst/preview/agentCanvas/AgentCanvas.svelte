<script lang="ts">
	// 预览上的圈选层，两种定位方式并存：
	//   框选（web 同源页）：画布接管指针画框，发送时两个角点经注入桥派发合成点击解析——
	//   合成事件只在同源页生效（loopback 跨源页不触发查看器，实测）。
	//   点击定位（桌面）：画布放行指针，真实点击经 tinymist 原生链路解析（桌面 LSP 通知可靠）。
	// 画笔/箭头/文本是辅助标注（纯视觉）。两角定位后弹意图卡交给 AGENT。
	import { onMount } from 'svelte';
	import { Crosshair, LoaderCircle, SquareDashed } from '@lucide/svelte';
	import AgentCanvasToolbar from './AgentCanvasToolbar.svelte';
	import { cancelCornerCollection, collectNextJump, startCornerCollection } from './regionResolve';
	import { sendRegionEdit, type RegionPayload } from './agentCanvasTurn';
	import AgentIntentCard from './AgentIntentCard.svelte';
	import { drawRegionBox, drawStroke, normRect, type Pt, type Stroke } from './canvasDraw';

	type Props = {
		/** 预览页已渲染（status.pages > 0）——两种定位的前提 */
		pageReady: boolean;
		/** 预览页是否同源提供（web 宿主）——决定框选的合成角点能否解析 */
		sameOrigin: boolean;
		/** 把消息转进预览 iframe（框选的合成角点从这里走） */
		sendToFrame: (msg: Record<string, unknown>) => void;
		/** 一轮送出后调用（父组件收起画布） */
		onDone: () => void;
		/** 收起画布模式 */
		onDismiss: () => void;
	};
	let { pageReady, sameOrigin, sendToFrame, onDone, onDismiss }: Props = $props();

	type Mode = 'region' | 'locate' | 'annotate';
	type Tool = 'pen' | 'arrow' | 'text';

	let mode = $state<Mode>(sameOrigin ? 'region' : 'locate');
	// 用户点过工具条后不再自动切模式；sameOrigin 晚到（prepare 异步）时一次性补正默认
	let modeTouched = $state(false);
	$effect(() => {
		if (sameOrigin && !modeTouched && mode !== 'region') mode = 'region';
	});
	let tool = $state<Tool>('pen');
	let canvas = $state<HTMLCanvasElement | null>(null);
	let host = $state<HTMLDivElement | null>(null);
	let strokes = $state<Stroke[]>([]);
	let draft = $state<Stroke | null>(null);
	let phase = $state<'collect' | 'resolving' | 'intent' | 'sending'>('collect');
	let collected = $state(0);
	let intent = $state('');
	let error = $state<string | null>(null);
	let textDraft = $state<{ at: Pt; value: string } | null>(null);
	let pendingRegion = $state<RegionPayload | null>(null);

	const busy = $derived(phase === 'sending');

	// ---- 点击定位的收集流程（仅 locate 模式） ----
	$effect(() => {
		if (pageReady && mode === 'locate') beginCollect();
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
		modeTouched = true;
		mode = next;
		region = null;
		error = null;
		if (next === 'locate') {
			// 点击定位：重新收集（之前的角点作废，状态条归零）
			if (pageReady) beginCollect();
		} else {
			// 框选/标注：暂停点击收集（框选的角点走合成点击，不走真实点击收集）
			cancelCornerCollection();
		}
	}

	// ---- 框选：画布画框 → 发送时两角合成点击解析 ----
	let region = $state<{ x: number; y: number; w: number; h: number } | null>(null);

	async function resolveRegion(): Promise<void> {
		if (!region || region.w < 8 || region.h < 8) {
			error = '先用框选工具圈一个区域';
			return;
		}
		if (!pageReady) {
			error = '预览还没渲染出来，等一下再发';
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
			phase = 'collect';
			error = e instanceof Error ? e.message : String(e);
		}
	}

	// ---- 发送 ----
	async function submitIntent(): Promise<void> {
		if (!pendingRegion) return;
		phase = 'sending';
		error = null;
		try {
			// AGENT 会话启动/发送可能迟迟不返回（DSH 侧冷启动或桥不可用）：给一个上限，
			// 到点把错误显式抛回画布，避免"发送"按钮永远转圈。
			await Promise.race([
				sendRegionEdit(pendingRegion, intent),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('发送超时：AGENT 会话 60 秒内没有响应，请重试或查看 AGENT 面板')), 60000)
				)
			]);
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
		void region;
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
		if (region) drawRegionBox(g, region);
	}

	let drawing: { kind: 'region' | Tool; start: Pt; last: Pt; pts: Pt[] } | null = null;

	function local(e: PointerEvent): Pt {
		const r = canvas!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function onDown(e: PointerEvent): void {
		if (mode !== 'annotate' && mode !== 'region') return;
		const p = local(e);
		if (mode === 'region') {
			region = null;
			try {
				canvas?.setPointerCapture(e.pointerId);
			} catch {
				/* 合成事件没有活动指针，忽略 */
			}
			drawing = { kind: 'region', start: p, last: p, pts: [p] };
			return;
		}
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
		if (drawing.kind === 'region') {
			region = normRect(drawing.start, p);
			redraw();
			return;
		}
		drawing.pts.push(p);
		if (drawing.kind === 'pen') draft = { kind: 'pen', pts: [...drawing.pts] };
		else if (drawing.kind === 'arrow') draft = { kind: 'arrow', from: drawing.start, to: p };
	}

	function onUp(): void {
		if (!drawing) return;
		const d = drawing;
		drawing = null;
		if (d.kind === 'region') {
			if (region && (region.w < 8 || region.h < 8)) region = null;
			// 框完即解析并弹意图卡：用户不用再去工具条找入口
			if (region) void resolveRegion();
			return;
		}
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
		class:cursor-crosshair={mode === 'annotate' || mode === 'region'}
		style:pointer-events={mode === 'annotate' || mode === 'region' ? 'auto' : 'none'}
		style:touch-action="none"
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={onUp}
		onpointerleave={onUp}
	></canvas>

	<!-- 工具条（组件化：框选/点击定位/标注/清除/意图/退出） -->
	<AgentCanvasToolbar
		{mode}
		{tool}
		{collected}
		{pageReady}
		{busy}
		onSwitch={switchMode}
		onTool={(t) => (tool = t)}
		onClear={clearAll}
		onIntent={() => (mode === 'region' ? void resolveRegion() : (phase = 'intent'))}
		onDismiss={dismiss}
	/>

	<!-- 发送中：整轮 agent 可能持续一两分钟，画布只转圈会显得卡住 -->
	{#if phase === 'sending'}
		<div
			class="bg-surface-100-900 border-surface-300-700 rounded-container absolute top-14 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 border px-2.5 py-1 text-xs shadow-sm"
			style:pointer-events="none"
		>
			<LoaderCircle class="size-3.5 animate-spin" /><span>AGENT 正在修改，完成后画布自动关闭（进度见 AGENT 面板）</span>
		</div>
	{/if}

	<!-- 框选模式状态条 -->
	{#if mode === 'region' && phase !== 'sending'}
		<div
			class="bg-surface-100-900 border-surface-300-700 rounded-container absolute top-14 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 border px-2.5 py-1 text-xs"
			style:pointer-events="none"
		>
			{#if !pageReady}
				<span class="text-muted">等预览渲染出内容再框选</span>
			{:else if !region}
				<SquareDashed class="text-primary-ink size-3.5" /><span>在预览上<strong>拖一个框</strong>圈住要改的内容</span>
			{:else}
				<SquareDashed class="text-primary-ink size-3.5" /><span>已圈选 ✓ 点<strong>意图</strong>写修改要求</span>
			{/if}
		</div>
	{/if}

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

	<!-- 意图卡：框选完成后立即出现（解析中置灰），定位完成即可输入发送 -->
	{#if phase === 'intent' || phase === 'resolving'}
		<AgentIntentCard
			bind:intent
			busy={phase === 'resolving'}
			{error}
			onBack={() => (phase = 'collect')}
			onSend={() => void submitIntent()}
		/>
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
