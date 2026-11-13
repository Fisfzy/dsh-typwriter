// 可视化编辑页的「划选交给 AGENT」：把选区 span 换算成源码行范围，再复用圈选的 sendRegionEdit。
import { NodeSelection } from 'prosemirror-state';
import { selectedSpan, type SpanDeps } from './selectedSpan';
import { editorViewStore, sourceCmView } from '$lib/stores/editorStore';
import { sourceAnchorFor } from '$lib/editor/visual/extensions/pmComments';
import { sendRegionEdit, type RegionPayload } from '$lib/languages/typst/preview/agentCanvas/agentCanvasTurn';
import { agentEditService, agentEditCard, type AgentSelectionEditService } from '$lib/ai/agentSelectionEdit.svelte';
import { setAgentEditHighlight, clearAgentEditHighlight } from '$lib/editor/visual/extensions/agentEditHighlight';
import { setSourceAgentEditHighlight, clearSourceAgentEditHighlight } from '$lib/editor/source/extensions/agentEditHighlight';

type Wiring = SpanDeps & { guest: () => boolean };

function lineOf(text: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
	return line;
}

function regionOf(span: { text: string; from: number; to: number }, file: string): RegionPayload {
	const fromLine = lineOf(span.text, span.from);
	const toLine = lineOf(span.text, Math.max(span.from, span.to - 1));
	return {
		file,
		fromLine,
		toLine,
		via: 'visual-selection',
		fromChar: span.from,
		toChar: span.to,
		quote: span.text.slice(span.from, span.to)
	};
}

export function wireAgentSelectionEdit(d: Wiring): void {
	function available(): boolean {
		return !d.guest() && d.kind() === 'typ' && typeof (globalThis as { texpileSession?: unknown }).texpileSession !== 'undefined';
	}

	function regionFromSelection(): { region: RegionPayload; snippet: string } | null {
		const span = selectedSpan(d);
		const file = d.doc.path;
		if (span && file) return { region: regionOf(span, file), snippet: span.text.slice(span.from, span.to) };
		// 整个公式/块被 NodeSelection 选中时，selectedSpan 不收：用源码锚点再试一次
		const view = editorViewStore.current;
		const sel = view?.state.selection;
		const text = d.comments.activeText();
		if (!view || !sel || !(sel instanceof NodeSelection) || !file) return null;
		if (!['inline_math', 'block_math'].includes(sel.node.type.name)) return null;
		const anchor = sourceAnchorFor(view.state.doc, d.doc.sourceMap, text, sel.from, sel.to);
		if (!anchor || anchor.end <= anchor.start) return null;
		return { region: regionOf({ text, from: anchor.start, to: anchor.end }, file), snippet: text.slice(anchor.start, anchor.end) };
	}

	const service: AgentSelectionEditService = {
		available,
		start(anchor) {
			if (!available()) return false;
			const got = regionFromSelection();
			if (!got) return false;
			const view = editorViewStore.current;
			const sel = view?.state.selection;
			if (!view || !sel) return false;
			try {
				const a = view.coordsAtPos(sel.from);
				const b = view.coordsAtPos(sel.to);
				const left = Math.min(a.left, b.left);
				const top = Math.min(a.top, b.top);
				const rect = {
					left,
					top,
					width: Math.max(a.right, b.right) - left,
					height: Math.max(a.bottom, b.bottom) - top
				};
				agentEditCard.current = { anchor, region: got.region, snippet: got.snippet.trim(), rect, pmFrom: sel.from, pmTo: sel.to };
				return true;
			} catch {
				return false;
			}
		},
		async send(prompt) {
			const card = agentEditCard.current;
			if (!card) return '没有可发送的选区';
			const from = card.region.fromChar;
			const to = card.region.toChar;
			const pmFrom = card.pmFrom;
			const pmTo = card.pmTo;
			function paint(): void {
				// 可视化页用 PM 位置（不能用源码 offset），源码页用字符 offset；split 时两边都画
				setAgentEditHighlight(editorViewStore.current, pmFrom, pmTo);
				if (from !== undefined && to !== undefined) setSourceAgentEditHighlight(sourceCmView.current, from, to);
			}
			function clear(): void {
				clearAgentEditHighlight(editorViewStore.current);
				clearSourceAgentEditHighlight(sourceCmView.current);
				window.removeEventListener('typwriter:agent-turn-end', clear);
			}
			paint();
			window.addEventListener('typwriter:agent-turn-end', clear, { once: true });
			try {
				await sendRegionEdit(card.region, prompt);
				return null;
			} catch (e) {
				clear();
				return e instanceof Error ? e.message : String(e);
			}
		},
		busy: () => agentEditCard.current !== null
	};
	agentEditService.current = service;
	$effect(() => () => {
		if (agentEditService.current === service) agentEditService.current = null;
	});
}
