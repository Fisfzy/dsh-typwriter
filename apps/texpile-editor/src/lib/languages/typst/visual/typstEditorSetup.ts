// plugin stack, autoformat rules, paste handling, and node views for the Typst visual editor;
// TypstEditorView.svelte mounts it
import { Plugin, type EditorState } from 'prosemirror-state';
import type { EditorProps, EditorView } from 'prosemirror-view';
import { Fragment, Slice, type Node as PmNode } from 'prosemirror-model';
import { typstToProseMirror } from './convert/converter';
import { typstCopyPlugin } from './clipboard';
import { parseCarryPlugin } from '$lib/editor/visual/parseCarry';
import { labelRenameUndo } from '$lib/editor/visual/repointRefs';
import { createSuggestPlugin } from '$lib/editor/visual/extensions/suggest/suggestPlugin';
import { selectAllScoped } from '$lib/editor/visual/selectAllScoped';
import {
	extendToDocEnd,
	extendToDocStart,
	holdAtDocEnd,
	holdAtDocStart,
	selectDocEnd,
	selectDocStart
} from '$lib/editor/visual/selectDocBoundary';
import { TypstBibliographyView, isTypstBibliography } from './extensions/typstBibliographyView.svelte';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history } from 'prosemirror-history';
import { undoVisual, redoVisual } from '$lib/editor/visual/visualUndo';
import { gapCursorWithArrows } from '$lib/editor/visual/gapArrows';
import { dropCursor } from 'prosemirror-dropcursor';
import { tableEditing, goToNextCell } from 'prosemirror-tables';
import { wholeTableEdits } from '$lib/editor/visual/extensions/table/wholeTableEdits';
import { tableArrowEntry } from '$lib/editor/visual/extensions/table/tableArrowEntry';
import { crossBlockEdits } from '$lib/editor/visual/extensions/crossBlockEdits';
import { columnResizing } from '$lib/editor/visual/extensions/table/columnResizing';
import { snapWidthToFr } from '$lib/editor/visual/extensions/table/snapWidth';
import { captureColumnWidths } from '$lib/editor/visual/extensions/table/captureColumnWidths';
import {
	createListEventPlugin,
	createListRenderingPlugin,
	createSafariInputMethodWorkaroundPlugin,
	listKeymap,
	createDedentListCommand,
	wrappingListInputRule,
	type ListAttributes
} from 'prosemirror-flat-list';
import { indentListItem } from '$lib/editor/visual/extensions/listIndent/listIndent';
import { inputRules, textblockTypeInputRule, InputRule, undoInputRule, smartQuotes, ellipsis } from 'prosemirror-inputrules';
import { selectFigureBackward, selectFigureForward } from '$lib/editor/visual/figureDeleteGuard';
import { deleteEmptyBlockForward, deleteEmptyFirstBlock } from '$lib/editor/visual/emptyBlockDelete';
import { liftFromStyleEnvironment } from '$lib/editor/visual/liftFromStyleEnvironment';
import { emDashRule, enDashRule, emDashUpgradeRule } from '$lib/editor/visual/extensions/inputrules/dashRules';
import { visualFindPlugin } from '$lib/editor/visual/find/visualFindPlugin';
import { typSchema } from './schema';
import { typstDrawnEnvView } from './extensions/layout/typstEnvViews';
import { TypstLayoutView } from './extensions/layout/typstLayoutView.svelte';
import { pluginEditorPlugins, pluginNodeViews } from './core/plugin/editorPieces';
import { hasTypstMarkup } from './pasteMarkup';
import { isMac } from '$lib/platform';
import { splitBlockWithoutDuplicates, toggleHeading } from '$lib/editor/visual/helperCommands';
import { createMathField } from '$lib/editor/visual/extensions/mathlivebridge/mlcommands';
import { imagePlugin } from '$lib/editor/visual/extensions/image';
import { createTypstImageSettings } from './imageSettings.svelte';
import { createCodeBlock } from '$lib/editor/visual/extensions/codemirrorbridge/cmcommands';
import { cmarrowHandlers } from '$lib/editor/visual/extensions/codemirrorbridge/cmarrowhandler';
import { menuUpdatePlugin } from '$lib/editor/visual/extensions/toolbarlistenerplugin';
import { createCursorPlugin } from '$lib/editor/visual/extensions/cursor-plugin';
import { lineBreakPlugins } from '$lib/editor/visual/linebreak/lineBreakPlugin';
import { createLinkPlugin } from '$lib/editor/visual/extensions/link';
import { pasteUuidFixPlugin } from '$lib/editor/visual/extensions/paste-uuid-fix';
import { visualSmartPaste } from '$lib/editor/paste/visualSmartPaste';
import { pasteReadingOfText } from '$lib/editor/paste/pasteReadingOfText';
import { placeholderPlugin } from '$lib/editor/visual/extensions/placeholderplugin';
import { tablePlaceholderPlugin } from '$lib/editor/visual/extensions/table/tablePlaceholderPlugin';
import { createWordCountPlugin } from '$lib/editor/visual/extensions/wordcount/wordCountPlugin';
import { typstProse } from '$lib/workspace/wordCount/proseWords';
import { createTocPlugin } from '$lib/editor/visual/extensions/tableofcontents/tocPlugin';
import { listNumbersPlugin } from '$lib/editor/visual/extensions/listNumbers/listNumbers';
import { createPersistentSelectionPlugin } from '$lib/editor/visual/extensions/persistentSelection/persistentSelectionPlugin';
import { proofreadPlugin, spellClickBoundaryPlugin, spellProblemKeymap } from '$lib/editor/spellcheck/spellcheckplugin';
import type { SpellLanguage } from '$lib/editor/spellcheck/languages/spellLanguages';
import { createBoundaryClickPlugin } from '$lib/editor/visual/extensions/boundary-click-plugin';
import { wordSelectionTrim } from '$lib/editor/visual/extensions/wordSelectionTrim';
import { dragSelectionPlugin } from '$lib/editor/visual/extensions/dragSelection/dragSelectionPlugin';
import { createBlockHandlePlugin } from '$lib/editor/visual/extensions/block-handle-plugin.svelte';
import { wholeBlockDragPlugin } from '$lib/editor/visual/extensions/wholeBlockDrag';
import { dropPastNodeViewsPlugin } from '$lib/editor/visual/extensions/dropPastNodeViews';
import { createNodeFlashPlugin } from '$lib/editor/visual/extensions/flash-plugin';
import { remoteCursorsPlugin } from '$lib/editor/visual/extensions/remoteCursors';
import { drawnOrSource } from '$lib/editor/visual/extensions/drawnChips/DrawnChipView';
import { FigureCardView, isFigureBlock } from '$lib/draw/host/card/FigureCardView.svelte';
import { cetzLanguage } from '$lib/draw/cetz/cetzLanguage';
import { drawnChipAtomsPlugin } from '$lib/editor/visual/extensions/drawnChips/drawnChipAtoms';
import { shiftArrowsPlugin } from '$lib/editor/visual/extensions/shiftArrows/shiftArrowsPlugin';
import { typstChipKind } from './extensions/typstChipKind';
import { footnoteNumbersPlugin } from '$lib/editor/visual/extensions/drawnChips/footnoteNumbers';
import { typstChipCounts } from './core/plugin/chipCounts';
import { IncludeDocView } from '$lib/editor/visual/extensions/includedoc/includeDocView.svelte';
import { pmComments } from '$lib/editor/visual/extensions/pmComments';
import type { CommentAnchor } from '$lib/comments/anchor';
import type { SourceAnchorFn } from '$lib/editor/visual/extensions/pmComments';
import { toLf } from '$lib/workspace/edits/lineEndings';
import { m } from '$lib/paraglide/messages';

// typst-flavored autoformat: = headings, ``` fences, - / + / 1. lists. Deliberately no task
// rule: the serializer has no typst form for a checkbox, so a task list must not be creatable.
const typInputRules = [
	textblockTypeInputRule(/^(={1,6})\s$/, typSchema.nodes.heading, (m) => ({ level: m[1].length })),
	textblockTypeInputRule(/^```$/, typSchema.nodes.code_block, { env: 'fence', args: '' }),
	wrappingListInputRule<ListAttributes>(/^\s?[-*]\s$/, { kind: 'bullet' }),
	wrappingListInputRule<ListAttributes>(/^\s?\+\s$/, { kind: 'ordered' }),
	wrappingListInputRule<ListAttributes>(/^\s?\d+\.\s$/, { kind: 'ordered' }),
	// "--- " (or the em dash the dash rules already made of it) alone on a line: divider
	new InputRule(/^(?:---|—)\s$/, (state, _m, start, end) =>
		state.tr.replaceRangeWith(start, end, typSchema.nodes.horizontal_rule.create())
	),
	// smart typography, same rules as the tex editor; the serializer emits the literal
	// characters and typst renders them as written
	...smartQuotes,
	ellipsis,
	emDashRule,
	enDashRule,
	emDashUpgradeRule
];

// Pasted TYPST SOURCE becomes rich nodes - the typst counterpart of the latex clipboard.
// Gated on structural markers so ordinary prose still pastes as plain text. The parse knows
// nothing of this document, so the pasted blocks carry no origins and are always written out afresh.
function pasteTypstSource(view: EditorView, text: string): boolean {
	if (!hasTypstMarkup(text)) return false;
	try {
		const { doc } = typstToProseMirror(text);
		const blocks: PmNode[] = [];
		doc.forEach((c) => blocks.push(c));
		if (blocks.length === 0) return false;
		const frag = Fragment.fromArray(blocks);
		// a single pasted paragraph merges inline into the current one; anything more
		// structured inserts as whole blocks
		const open = blocks.length === 1 && blocks[0].type.name === 'paragraph' ? 1 : 0;
		pasteReadingOfText(view, text, new Slice(frag, open, open));
		return true;
	} catch {
		return false; // unparsable clipboard: let the plain-text path have it
	}
}

// 在公式里 Ctrl+C：MathLive 默认只复制它自己的文字，粘到别处就成了纯文本。
// 捕获阶段拦截，复制整条公式的 Typst 源码 `$…$`；粘贴时 pasteTypstSource 会把它还原成公式节点。
function inlineMathAt(state: EditorState): PmNode | null {
	const { $from, from, to } = state.selection;
	for (let depth = $from.depth; depth >= 0; depth--) {
		const node = $from.node(depth);
		if (node.type.name === 'inline_math') return node;
	}
	// 点进 MathLive 时选区常常停在节点边界（atom 没有内部光标），看两侧
	if ($from.nodeAfter?.type.name === 'inline_math') return $from.nodeAfter;
	if ($from.nodeBefore?.type.name === 'inline_math') return $from.nodeBefore;
	let found: PmNode | null = null;
	state.doc.nodesBetween(from, to, (node) => {
		if (found) return false;
		if (node.type.name === 'inline_math') {
			found = node;
			return false;
		}
		return undefined;
	});
	return found;
}

const inlineMathClipboardPlugin = new Plugin({
	view(view) {
		function mathNodeFromDom(element: Element | null): PmNode | null {
			const span = element?.closest('.inline-math') ?? null;
			if (!span) return null;
			const pos = view.posAtDOM(span, 0);
			for (const at of [pos, pos - 1, pos + 1]) {
				if (at < 0 || at > view.state.doc.content.size) continue;
				const node = view.state.doc.nodeAt(at);
				if (node?.type.name === 'inline_math') return node;
			}
			return null;
		}

		function onCopy(event: ClipboardEvent): void {
			// MathLive 的 copy 发生在它自己的 shadow DOM 里，event.target 会被重定向到 math-field，
			// 不能靠 target.closest('.inline-math') 判断；先用活动元素映射回 DOM 节点，再退回选区。
			const target = event.target instanceof Element ? event.target : null;
			const active = document.activeElement instanceof Element ? document.activeElement : null;
			const inside = (target !== null && view.dom.contains(target)) || (active !== null && view.dom.contains(active));
			const math = mathNodeFromDom(active) ?? mathNodeFromDom(target) ?? (inside ? inlineMathAt(view.state) : null);
			if (!math) return;
			const source = math.textContent;
			if (!source.trim()) return;
			event.preventDefault();
			// 只写 text/plain：粘贴时走高优先的 Typst 源码解析（带 text/html 会被 ProseMirror 的 HTML 路径接管）
			event.clipboardData?.setData('text/plain', `$${source}$`);
		}
		// MathLive 的 Ctrl+C 不一定派发 copy 事件（它可能直接写剪贴板），所以 keydown 也要拦：
		// 捕获阶段阻止它，自己找一个复制事件把 `$…$` 写进去。
		function copyMathNode(): boolean {
			const active = document.activeElement instanceof Element ? document.activeElement : null;
			const math = mathNodeFromDom(active);
			if (!math) return false;
			const source = math.textContent;
			if (!source.trim()) return false;
			function onCopyEvent(ev: ClipboardEvent): void {
				ev.preventDefault();
				ev.stopPropagation();
				ev.clipboardData?.setData('text/plain', `$${source}$`);
			}
			document.addEventListener('copy', onCopyEvent, true);
			try {
				document.execCommand('copy');
			} catch {
				/* 没有 execCommand 时让异步剪贴板兜底 */
			}
			document.removeEventListener('copy', onCopyEvent, true);
			void navigator.clipboard?.writeText(`$${source}$`).catch(() => {});
			return true;
		}
		function onKeyDown(event: KeyboardEvent): void {
			if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
			if (event.key.toLowerCase() !== 'c') return;
			const active = document.activeElement instanceof Element ? document.activeElement : null;
			if (!active?.closest('.inline-math')) return;
			if (!copyMathNode()) return;
			event.preventDefault();
			event.stopImmediatePropagation();
		}
		document.addEventListener('copy', onCopy, true);
		document.addEventListener('keydown', onKeyDown, true);
		return {
			destroy() {
				document.removeEventListener('copy', onCopy, true);
				document.removeEventListener('keydown', onKeyDown, true);
			}
		};
	}
});

// html-flavored pastes keep ProseMirror's own path; smart paste reads a code editor's copy itself
const pasteTypstPlugin = new Plugin({
	props: {
		handlePaste(view, event) {
			const cb = event.clipboardData;
			const text = cb?.getData('text/plain');
			if (!text || cb?.getData('text/html')) return false;
			return pasteTypstSource(view, toLf(text));
		}
	}
});

export type TypstEditorSetup = {
	/** resolved by the caller's dynamic import so mathlive stays off the critical path */
	mathlivePlugin: Plugin;
	mlarrowHandlers: Plugin;
	docDir: () => string;
	placeholder: string;
	onOpenLink?: (href: string) => boolean;
	onSelectComment?: (id: string) => void;
	onAddComment?: (anchor: CommentAnchor | null) => void;
	/** the selection as a range of the file; see pmComments */
	sourceAnchor?: SourceAnchorFn;
	addCommentLabel: string;
	/** read at each check: the editor's file can change its language */
	spellLanguage: () => SpellLanguage | null;
};

export function typstEditorPlugins(setup: TypstEditorSetup): Plugin[] {
	const {
		mathlivePlugin,
		mlarrowHandlers,
		docDir,
		placeholder,
		onOpenLink,
		onSelectComment,
		onAddComment,
		sourceAnchor,
		addCommentLabel,
		spellLanguage
	} = setup;
	return [
		parseCarryPlugin,
		labelRenameUndo,
		...pluginEditorPlugins('atStart'),
		typstCopyPlugin,
		gapCursorWithArrows(),
		dropCursor({ color: 'var(--color-primary-500)', width: 2, class: 'pm-drop-cursor' }),
		// Typst is the one dialect where a drag can be saved: `columns:` takes real lengths and
		// fr. The drag snaps to that same grid (vendored columnResizing + snapWidthToFr);
		// captureColumnWidths fills in the columns a drag leaves unsized, which is what
		// the serializer needs to emit proportions instead of one fr beside two autos.
		columnResizing({ snap: snapWidthToFr, redistribute: true }),
		captureColumnWidths,
		tableEditing(),
		...pluginEditorPlugins('afterTableEditing'),
		wholeTableEdits,
		tableArrowEntry,
		crossBlockEdits,
		visualSmartPaste('typst', typSchema, pasteTypstSource),
		pasteTypstPlugin,
		inlineMathClipboardPlugin,
		// flat-list's clipboard plugin is left out: Texpile's own copy (visualSmartPaste) writes lists as it did
		createListEventPlugin(),
		createListRenderingPlugin(),
		createSafariInputMethodWorkaroundPlugin(),
		history(),
		// the @ reference/citation popup; its arrow/enter keymap must precede the others.
		// The picker inserts typ_ref atoms (it keys off the mounted schema)
		...createSuggestPlugin(),
		drawnChipAtomsPlugin(),
		shiftArrowsPlugin(),
		// before the list keymap, whose Backspace and Delete act at a block edge: they would join the block after an empty one into it, and a block into a figure
		keymap({ Backspace: liftFromStyleEnvironment }),
		keymap({ Backspace: deleteEmptyFirstBlock, Delete: deleteEmptyBlockForward }),
		keymap({ Backspace: selectFigureBackward, Delete: selectFigureForward }),
		keymap(listKeymap),
		inputRules({ rules: typInputRules }),
		keymap({
			'Mod-z': undoVisual,
			'Mod-y': redoVisual,
			'Mod-Shift-z': redoVisual,
			Backspace: undoInputRule,
			'Mod-a': selectAllScoped,
			'Mod-Home': selectDocStart,
			ArrowUp: holdAtDocStart,
			ArrowLeft: holdAtDocStart,
			ArrowDown: holdAtDocEnd,
			ArrowRight: holdAtDocEnd,
			'Mod-End': selectDocEnd,
			'Shift-Mod-Home': extendToDocStart,
			'Shift-Mod-End': extendToDocEnd,
			'Mod-b': toggleMark(typSchema.marks.strong),
			'Mod-i': toggleMark(typSchema.marks.em),
			'Mod-u': toggleMark(typSchema.marks.u),
			'Mod-.': toggleMark(typSchema.marks.sup),
			'Mod-Shift-,': toggleMark(typSchema.marks.sub), // Mod-, is Preferences
			'Mod-`': toggleMark(typSchema.marks.code),
			'Mod-Shift-`': createCodeBlock(),
			Enter: splitBlockWithoutDuplicates,
			'Mod-m': createMathField(),
			'Mod-Shift-m': createMathField(true),
			// Word/Docs convention, same as the other editors; typst headings nest to six
			'Mod-Alt-0': toggleHeading(0),
			...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`Mod-Alt-${n}`, toggleHeading(n)])),
			...(isMac ? {} : { 'Mod-Shift-1': toggleHeading(1), 'Mod-Shift-2': toggleHeading(2), 'Mod-Shift-3': toggleHeading(3) }),
			// table cell first, then list indent; always consume so focus stays in the editor
			Tab: (state, dispatch) => goToNextCell(1)(state, dispatch) || indentListItem()(state, dispatch) || true,
			'Shift-Tab': (state, dispatch) => goToNextCell(-1)(state, dispatch) || createDedentListCommand()(state, dispatch) || true
		}),
		cmarrowHandlers,
		mlarrowHandlers,
		mathlivePlugin,
		keymap(baseKeymap),
		imagePlugin(createTypstImageSettings(docDir)),
		menuUpdatePlugin(),
		createCursorPlugin(),
		...lineBreakPlugins(),
		createLinkPlugin({ onOpen: onOpenLink }),
		pasteUuidFixPlugin,
		visualFindPlugin(),
		placeholderPlugin(placeholder),
		tablePlaceholderPlugin(),
		createWordCountPlugin(typstProse),
		createTocPlugin(),
		listNumbersPlugin(),
		createPersistentSelectionPlugin(),
		spellClickBoundaryPlugin, // must precede proofreadPlugin; see its comment
		proofreadPlugin(spellLanguage),
		spellProblemKeymap,
		createBoundaryClickPlugin(),
		wordSelectionTrim(),
		dragSelectionPlugin(),
		// the Notion-style + / drag / delete gutter, with the typst insert set
		createBlockHandlePlugin(),
		wholeBlockDragPlugin(),
		dropPastNodeViewsPlugin(),
		footnoteNumbersPlugin(typstChipCounts),
		createNodeFlashPlugin(),
		// collaborators' carets; VisualCollab feeds it, and is inert outside a shared session
		remoteCursorsPlugin,
		...pmComments({
			onSelect: (id) => onSelectComment?.(id),
			onAdd: onAddComment,
			sourceAnchor,
			addLabel: addCommentLabel
		})
	];
}

export function typstNodeViews(docDir: () => string): NonNullable<EditorProps['nodeViews']> {
	return {
		// typst raw islands are the safety valve for everything unmodeled: plain CM views
		// (highlighting picked by attrs.lang), never a latex-specialized node view. The dressed-up
		// ones keep their text verbatim: #bibliography as a card, a comment folded to a line
		raw_latex: (node, view, getPos, decorations) =>
			isTypstBibliography(node.textContent)
				? new TypstBibliographyView(node, view, getPos as () => number)
				: isFigureBlock(cetzLanguage, node.textContent)
					? new FigureCardView(node, view, getPos as () => number, cetzLanguage, m.figure_card_cetz())
					: drawnOrSource(node, view, getPos as () => number, decorations, typstChipKind(true)),
		inline_latex: (node, view, getPos, decorations) => drawnOrSource(node, view, getPos as () => number, decorations, typstChipKind(false)),
		includedoc: (node, view, getPos) => new IncludeDocView(node, view, getPos as () => number, docDir),
		typ_env: (node, view, getPos) => typstDrawnEnvView(node, view, getPos),
		...pluginNodeViews({
			docDir,
			parse: (source) => typstToProseMirror(source).doc,
			layout: (node, view, getPos) => new TypstLayoutView(node, view, getPos)
		})
	};
}
