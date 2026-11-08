<script lang="ts">
	// Markdown source-mode toolbar: buttons for the same md-wrapping chords mdSourceShortcuts()
	// binds, for people who don't know them. The SHELL mirrors the LaTeX SourceToolbar (groups,
	// borders, icon metrics); the actions write markdown, not LaTeX. No active-state highlighting,
	// same trade-off as the tex source bar.
	import {
		Bold,
		Italic,
		Strikethrough,
		Code,
		List,
		ListOrdered,
		Quote,
		Link as LinkIcon,
		SquareRadical,
		Sigma,
		Table as TableIcon,
		Image as ImageIcon,
		Minus
	} from '@lucide/svelte';
	import type { EditorState, TransactionSpec } from '@codemirror/state';
	import { sourceCmView } from '$lib/stores/editorStore';
	import SourceToolbarButton, { type SourceToolbarButtonProps } from '$lib/editor/source/toolbar/SourceToolbarButton.svelte';
	import ToolbarOverflow from '$lib/editor/visual/toolbar/ToolbarOverflow.svelte';
	import {
		computeToggleDelim,
		computeHeadingLine,
		computeListLines,
		computeQuoteLines,
		computeFence,
		computeLink,
		computeImage,
		computeMathBlock,
		computeTableSkeleton,
		computeHr
	} from './sourceInsert';
	import { m } from '$lib/paraglide/messages';

	function run(build: (state: EditorState) => TransactionSpec) {
		return (e: MouseEvent) => {
			e.preventDefault(); // keep focus (and the caret) in the CodeMirror view
			const view = sourceCmView.current;
			if (!view) return;
			view.dispatch(build(view.state));
			view.focus();
		};
	}
</script>

{#snippet button(item: { payload?: unknown })}
	<SourceToolbarButton {...item.payload as SourceToolbarButtonProps} />
{/snippet}

<div class="flex min-w-0 flex-1 items-center gap-1 sm:gap-1.5" data-keep-caret role="presentation" onmousedown={(e) => e.preventDefault()}>
	<ToolbarOverflow
		gapClass="gap-1 sm:gap-1.5"
		menuLabel={m.toolbar_more_actions_aria()}
		items={[
			{
				id: 'bold',
				render: button,
				payload: { label: m.srctoolbar_bold_aria(), action: run((s) => computeToggleDelim(s, '**')), Icon: Bold }
			},
			{
				id: 'italic',
				render: button,
				payload: { label: m.srctoolbar_italic_aria(), action: run((s) => computeToggleDelim(s, '*')), Icon: Italic }
			},
			{
				id: 'strike',
				render: button,
				payload: { label: m.mdtoolbar_strike(), action: run((s) => computeToggleDelim(s, '~~')), Icon: Strikethrough }
			},
			{
				id: 'monospace',
				render: button,
				payload: { label: m.srctoolbar_monospace_aria(), action: run((s) => computeToggleDelim(s, '`')), Icon: Code }
			},
			...[1, 2, 3].map((level) => ({
				id: `h${level}`,
				render: button,
				payload: {
					label: m.mdtoolbar_heading_n({ n: level }),
					text: `H${level}`,
					action: run((s) => computeHeadingLine(s, level)),
					divider: level === 1
				}
			})),
			{
				id: 'bullet',
				render: button,
				payload: { label: m.blockmenu_bullet_list(), action: run((s) => computeListLines(s, 'bullet')), Icon: List, divider: true }
			},
			{
				id: 'ordered',
				render: button,
				payload: { label: m.blockmenu_numbered_list(), action: run((s) => computeListLines(s, 'ordered')), Icon: ListOrdered }
			},
			{ id: 'quote', render: button, payload: { label: m.blockmenu_quote(), action: run(computeQuoteLines), Icon: Quote } },
			{ id: 'codeBlock', render: button, payload: { label: m.blockmenu_code_block(), action: run(computeFence), Icon: Code } },
			{
				id: 'inlineMath',
				render: button,
				payload: { label: m.srctoolbar_inline_math_aria(), action: run((s) => computeToggleDelim(s, '$')), Icon: Sigma }
			},
			{ id: 'mathBlock', render: button, payload: { label: m.blockmenu_math_block(), action: run(computeMathBlock), Icon: SquareRadical } },
			{ id: 'link', render: button, payload: { label: m.mdtoolbar_link(), action: run(computeLink), Icon: LinkIcon, divider: true } },
			{ id: 'table', render: button, payload: { label: m.blockmenu_table(), action: run(computeTableSkeleton), Icon: TableIcon } },
			{ id: 'image', render: button, payload: { label: m.menubar_insert_image(), action: run(computeImage), Icon: ImageIcon } },
			{ id: 'hr', render: button, payload: { label: m.mdtoolbar_hr(), action: run(computeHr), Icon: Minus } }
		]}
	/>
</div>
