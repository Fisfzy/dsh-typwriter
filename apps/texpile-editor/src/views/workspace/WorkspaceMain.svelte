<script lang="ts">
	// The editor column: toolbar, editor/preview pair, and the bottom dock. Everything here reads
	// from the workspace's state objects rather than a long list of scalar props, which is what
	// makes this splittable at all - the state lives in lib/workspace/*.svelte.ts, not in the view.
	import { fileMode } from '$lib/workspace/fileMode.svelte';
	import EditorTopbar from './EditorTopbar.svelte';
	import { agentCanvas } from '$lib/languages/typst/preview/agentCanvas/agentCanvasState.svelte';
	import { SquareDashedMousePointer } from '@lucide/svelte';
	import EditorStripControls from './pane/EditorStripControls.svelte';
	import { hasViewToggle } from './pane/viewToggle';
	import EditorGroups from './groups/EditorGroups.svelte';
	import { livePaneProps } from './livePaneProps';
	import PreviewPane from '$lib/preview/PreviewPane.svelte';
	import AgentPane from '$lib/ai/agentPanel/ui/AgentPane.svelte';
	import { editorGroups } from '$lib/workspace/groups/editorGroups.svelte';
	import PreviewPopout from '$lib/preview/PreviewPopout.svelte';
	import PaneSplitter from '$lib/components/PaneSplitter.svelte';
	import TerminalDock from '$lib/terminal/TerminalDock.svelte';
	import { m } from '$lib/paraglide/messages';
	import { activeCompare, setSuggesting, workspaceRoot } from '$lib/workspace/workspaceStore';
	import { ensureName } from '$lib/identity/ownName.svelte';
	import { activeSuggestions, suggesting } from '$lib/comments/activeSuggestions.svelte';
	import { collabGuest } from '$lib/collab/guestStore.svelte';
	import type { WorkspaceMainProps } from './workspaceMainProps';
	import { untrack } from 'svelte';
	import { versionSchemeOf } from '$lib/files/identity/versionUris';
	import { HISTORY_PANEL_WIDTH } from '$lib/workspace/paneGeometry';
	import { documentControls as controlsSlot } from '$lib/preview/documentControls.svelte';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the pipelines are structural here
	type Any = any;

	let {
		doc,
		modes,
		layout = $bindable(),
		diff,
		parser,
		termDock = $bindable(),
		compiler,
		session,
		guest,
		kind,
		nameOnly,
		folderEmpty,
		dockShrunk,
		draft,
		typstPreviewHost,
		typstPreviewWanted,
		mainIsTypst,
		guestTypstOffered,
		mainUnset,
		onPickMain,
		panes,
		actions,
		commentsCtl,
		dockView = $bindable(),
		pdfPaneRef = $bindable()
	}: WorkspaceMainProps = $props();

	// 标题栏「AGENT 对话」：把底部面板切到 Agent 页。BottomDock 自己持有 view，靠这个请求对齐
	$effect(() => {
		if (termDock?.agentRequest) {
			dockView = 'agent';
			termDock.agentRequest = false;
		}
	});

	// One gate for every forward-sync entry point: the docked chip, the popped-out button, and
	// the context menu's "Show in preview/PDF". Guest: the open file must match what the host's
	// pane shows - a streamed Typst preview syncs .typ files, a pushed PDF syncs .tex ones (via
	// the host's SyncTeX data). Host: same rule against the main file's engine; Typst syncs only
	// through the live preview (no SyncTeX in its PDFs), so a shell-compiled .typ gets no entry
	// points at all, and diff has no caret to sync.
	const canSync = $derived(
		guest
			? guestTypstOffered
				? kind === 'typ'
				: kind === 'tex'
			: (mainIsTypst ? kind === 'typ' && typstPreviewWanted : kind === 'tex') && !activeCompare.current
	);
	// Version History's panel takes room in the editor column (EditorPane draws it beside a comparison with a
	// copy); untracked, as making that room opens or shuts the preview, which would run this again
	$effect(() => {
		const compare = activeCompare.current;
		const width = compare && versionSchemeOf(compare) === 'history' ? HISTORY_PANEL_WIDTH : 0;
		untrack(() => layout.setEditorAside(width));
	});
	const syncToCursor = $derived(canSync ? (actions.syncForward as () => void) : null);
	// a lone file has no project to hold the log, so the menus drop their Add comment entry
	const canComment = $derived(!fileMode.current);
	async function toggleSuggest(next: boolean) {
		// a suggestion carries its author's name: git's, or one asked for now
		if (next && !session.isGuest && !(await ensureName(workspaceRoot.current))) return;
		void commentsCtl.suggestions.settle();
		suggesting.current = next;
		if (workspaceRoot.current && !session.isGuest) setSuggesting(workspaceRoot.current, next);
	}
	const beside = $derived(
		new Set<string>(
			[...panes.commentRanges.filter((r: Any) => !r.resolved), ...activeSuggestions.current]
				.map((r: Any) => r.id)
				.filter((id: string) => !panes.commentsNotVisible.has(id))
		)
	);
	const livePane = livePaneProps({
		get doc() {
			return doc;
		},
		get modes() {
			return modes;
		},
		get diff() {
			return diff;
		},
		get parser() {
			return parser;
		},
		get session() {
			return session;
		},
		get kind() {
			return kind;
		},
		get nameOnly() {
			return nameOnly;
		},
		get folderEmpty() {
			return folderEmpty;
		},
		get panes() {
			return panes;
		},
		get actions() {
			return actions;
		},
		get commentsCtl() {
			return commentsCtl;
		},
		get canSync() {
			return canSync;
		},
		get canComment() {
			return canComment;
		},
		get pickMain() {
			return onPickMain;
		}
	});
	$effect(() => {
		controlsSlot.current = documentControls;
		return () => (controlsSlot.current = null);
	});
</script>

{#snippet documentControls(compact = false)}
	{#if fileMode.current && hasViewToggle(livePane.loadedPath, livePane.kind, guest)}
		<!-- a lone file has no tab strip, so its editor's own controls come up here rather than keep a bar of their own -->
		<div class="mr-2 flex items-center">
			<EditorStripControls
				loadedPath={livePane.loadedPath}
				kind={livePane.kind}
				viewMode={livePane.viewMode}
				encodingIssue={livePane.encodingIssue}
				conflicted={livePane.conflicted}
				{guest}
				parked={false}
				onSetViewMode={livePane.onSetViewMode}
				{compact}
			/>
		</div>
	{/if}
	<EditorTopbar
		loadedPath={doc.path}
		{kind}
		{guest}
		terminalAvailable={termDock.available}
		compiling={compiler.compiling}
		{typstPreviewWanted}
		{guestTypstOffered}
		pdfPaneOpen={layout.pdfPaneOpen}
		draftPaused={draft.paused}
		onStopCompile={compiler.stopCompile}
		onPauseDraft={actions.pauseDraft}
		onResumeDraft={actions.resumeDraft}
		onCompile={compiler.runCompile}
		commandPending={panes.commandPending}
		onRequestCompile={actions.requestCompile}
		onConfigureCompile={actions.openCompileModal}
		onCompileFromScratch={compiler.runCompileFromScratch}
		onCleanAux={compiler.runCleanAux}
		latexmkActionsAvailable={compiler.latexmkActionsAvailable}
		onShowOutput={() => void compiler.revealOutput()}
		outputAvailable={compiler.hasOutput}
		onShowProblems={actions.showProblems}
		commentCount={panes.comments.filter((t: Any) => !t.resolved && !panes.commentGhosts.has(t.id)).length}
		onShowComments={actions.showComments}
		suggesting={suggesting.current}
		onToggleSuggest={canComment && (!session.isGuest || collabGuest.hostRecords) ? toggleSuggest : undefined}
		onTogglePdf={layout.togglePdfPane}
		onSyncToCursor={layout.pdfPopout && !mainUnset ? syncToCursor : null}
		syncTargetsPreview={guest ? guestTypstOffered : typstPreviewWanted}
		{compact}
	/>
{/snippet}

<!-- 全部文档收起时释放的空间必须整体给一条轨道（若四个轨道全用 auto，网格默认的
     justify-content: stretch 会把剩余宽度均分给每条 auto 轨道，窄条欢迎位旁边就出现
     一片无意义的空白）。预览开着时给预览列（第 3 列，面板以 100% 宽吃满）；预览关着
     时给第 2 列，让左侧的关闭滑轨贴到窗口右缘——收起状态下轨道若紧跟窄条，向左拖拽
     重新打开预览的行程在几何上就不存在了 -->
<main
	class="grid min-h-0 min-w-0 flex-1"
	style="grid-template-columns: {editorGroups.allClosed
		? layout.pdfPaneOpen && !layout.pdfPopout
			? 'auto auto minmax(0, 1fr) auto'
			: 'auto minmax(0, 1fr) auto auto'
		: 'minmax(0, 1fr) auto auto auto'}; grid-template-rows: auto minmax(0, 1fr) auto auto"
>
	<!-- editor column (toolbar + content) with the PDF pane beside it, so the PDF skips the
	     toolbar while the header (Compile) stays above it. the wrapper is display:contents so
	     editor/splitter/preview place themselves on main's grid -->
	<div class="contents">
		<EditorGroups live={livePane} host={actions.groupHost} />
		{#if !fileMode.current && layout.pdfPaneOpen && !layout.pdfPopout}
			<PreviewPane
				width={layout.pdfPaneWidth}
				fill={editorGroups.allClosed}
				{dockShrunk}
				{guest}
				guestPdf={session.guestPdf}
				pdfFilename={compiler.pdfFilename}
				{draft}
				{typstPreviewHost}
				{typstPreviewWanted}
				{guestTypstOffered}
				{mainUnset}
				{onPickMain}
				onSyncToCursor={syncToCursor}
				onPopout={() => layout.setPdfPopout(true)}
				paneDragging={layout.paneDragging}
				bind:pdfPaneRef
				onStartResize={layout.startPdfResize}
				onResizeByKey={layout.resizePdfByKey}
				onPageClick={actions.onPdfDoubleClick}
				onInverseSync={actions.onInverseSync}
				onSettled={actions.onPreviewSettled}
				onDiagnostics={actions.onPreviewDiagnostics}
				slides={layout.pdfSlides}
			/>
		{:else if !fileMode.current && (termDock.available || guest || layout.pdfPopout)}
			<!-- the pane is gone but its divider stays, on the editor's right edge.

			     It spans every row so the rule reaches the bottom of the window: with the preview shut
			     the dock stops at the editor column (see dockShrunk), and a rail that stopped at the
			     editor would leave a notch beside it. -->
			<!-- resizable while shut on purpose: dragging it back into the window is the other half of
			     the drag-to-close gesture, so the rail has to accept the same drag the real divider
			     does. PaneLayout measures from the edge in this state. -->
			<PaneSplitter
				resizable
				resizeLabel={m.wsview_resize_pdf_preview_aria()}
				onStartResize={layout.startPdfResize}
				onResizeByKey={layout.resizePdfByKey}
				bottomInset={termDock.shrink || !termDock.visible ? 0 : termDock.height}
				class="z-30 {editorGroups.allClosed ? 'justify-self-end' : ''}"
				style="grid-column: 2; grid-row: 2 / -1"
			/>
		{/if}
		{#if layout.agentPaneOpen && !fileMode.current}
			<AgentPane
				width={layout.agentPaneWidth}
				onStartResize={layout.startAgentResize}
				onResizeByKey={layout.resizeAgentByKey}
				onClose={() => layout.setAgentPane(false)}
			/>
		{/if}
		{#if layout.pdfPaneOpen && layout.pdfPopout}
			<PreviewPopout
				{guest}
				guestPdf={session.guestPdf}
				{guestTypstOffered}
				{mainUnset}
				{onPickMain}
				pdfFilename={compiler.pdfFilename}
				{draft}
				{typstPreviewHost}
				{typstPreviewWanted}
				onPdfRef={(r) => (pdfPaneRef = r)}
				onClosed={() => layout.setPdfPopout(false)}
				onPageClick={actions.onPdfDoubleClick}
				onInverseSync={actions.onInverseSync}
				onSettled={actions.onPreviewSettled}
				onDiagnostics={actions.onPreviewDiagnostics}
			/>
		{/if}
	</div>

	{#if termDock.mounted && (termDock.available || guest)}
		<TerminalDock
			terminalEnabled={termDock.available}
			visible={termDock.visible}
			height={termDock.height}
			shrink={termDock.shrink}
			{dockShrunk}
			cwd={panes.cwd}
			pdfPaneOpen={layout.pdfPaneOpen && !layout.pdfPopout}
			bind:view={dockView}
			bind:dock={termDock.dock}
			onStartResize={termDock.startResize}
			onResizeByKey={termDock.resizeByKey}
			onToggleShrink={actions.toggleTerminalShrink}
			onClose={actions.toggleTerminal}
			onProblemJump={actions.openFileAt}
			comments={panes.comments.filter((t: Any) => !panes.commentGhosts.has(t.id))}
			commentFile={panes.commentFile}
			commentsOrphaned={panes.commentsOrphaned}
			commentsWeak={panes.commentsWeak}
			commentsNotVisible={panes.commentsNotVisible}
			commentFilesPresent={panes.commentFilesPresent}
			commentSelected={panes.commentSelected}
			onCommentOpen={actions.openComment}
			onCommentReply={actions.replyToComment}
			onCommentResolve={actions.resolveComment}
			onCommentEditMessage={actions.editCommentMessage}
			onCommentDeleteMessage={actions.deleteCommentMessage}
			commentBeside={beside}
			onCommentAttach={actions.attachCommentToSelection}
		/>
	{/if}

	{#if (termDock.available || guest) && !termDock.visible}
		<!-- the dock's divider, left behind at the foot of the window when the dock is put away, so
		     dragging it back up reopens it. Outside the `mounted` gate above on purpose: the rail is
		     the way in, and it has to be there before the dock has ever been built.

		     It draws no line: a rule along the foot of the window, where no other edge has one, read
		     as a stray border. The grab zone still lights up under the pointer. -->
		<!-- eslint-disable-next-line svelte/valid-compile -->
		<div class="relative z-20 h-px shrink-0" style="grid-row: 4; grid-column: {dockShrunk ? '1' : '1 / -1'}">
			<!-- the grab zone overhangs its row by 3px, upwards only: below it is the window's edge,
			     and 3px past that was scrollable overflow the editors' focus scroll could take up,
			     shifting the whole workspace by that much -->
			<div
				class="hover:bg-primary-wash active:bg-primary-flood absolute inset-x-0 -top-[3px] bottom-0 cursor-row-resize transition-colors"
				onmousedown={termDock.startResize}
				onkeydown={termDock.resizeByKey}
				role="separator"
				aria-orientation="horizontal"
				aria-label={m.wsview_resize_terminal_aria()}
				tabindex="0"
			></div>
		</div>
	{/if}
</main>
