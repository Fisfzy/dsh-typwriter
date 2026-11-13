<script lang="ts">
	// 交给 AGENT 的待修改区域：静态渐变边框 + opacity 交替，只走合成器，不逐帧重绘。
	import { agentRegion } from './agentRegion.svelte';
</script>

{#if agentRegion.current}
	{@const r = agentRegion.current.rect}
	<div
		class="agent-region-ring"
		class:agent-region-done={agentRegion.current.phase === 'done'}
		class:agent-region-failed={agentRegion.current.phase === 'failed'}
		style:left={`${r.left - 3}px`}
		style:top={`${r.top - 3}px`}
		style:width={`${r.width + 6}px`}
		style:height={`${r.height + 6}px`}
		aria-hidden="true"
	>
		<span class="agent-region-layer agent-region-layer-a"></span>
		<span class="agent-region-layer agent-region-layer-b"></span>
	</div>
{/if}

<style>
	.agent-region-ring {
		position: fixed;
		z-index: 45;
		pointer-events: none;
		border-radius: 7px;
	}
	.agent-region-layer {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		padding: 2px;
		background: conic-gradient(from 0deg, #38bdf8, #818cf8, #f472b6, #fbbf24, #38bdf8);
		-webkit-mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		-webkit-mask-composite: xor;
		mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		mask-composite: exclude;
		will-change: opacity;
		animation: agent-region-pulse 2s ease-in-out infinite alternate;
	}
	.agent-region-layer-b {
		background: conic-gradient(from 180deg, #fbbf24, #f472b6, #818cf8, #38bdf8, #fbbf24);
		animation-delay: -1s;
		opacity: 0.2;
	}
	.agent-region-done .agent-region-layer {
		background: #22c55e;
		animation: none;
		opacity: 1;
		will-change: auto;
	}
	.agent-region-failed .agent-region-layer {
		background: #ef4444;
		animation: none;
		opacity: 1;
		will-change: auto;
	}
	@keyframes agent-region-pulse {
		from {
			opacity: 0.35;
		}
		to {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.agent-region-layer {
			animation: none;
			opacity: 0.9;
			background: repeating-linear-gradient(45deg, #38bdf8 0 6px, #818cf8 6px 12px);
		}
	}
</style>
