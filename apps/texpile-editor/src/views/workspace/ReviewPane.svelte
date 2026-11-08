<script lang="ts">
	// 右侧「代码修改」页：右缘活动栏的第三个页面。内容就是源代码管理面板（修改列表 + 版本
	// 时间线 + diff 审阅）——同一面板在左栏视图里的那个家的另一面，这里靠互斥保证只住一边。
	import { X } from '@lucide/svelte';
	import SourceControlPanel from '$lib/workspace/scm/ui/SourceControlPanel.svelte';
	import { parentRepoToConfirm } from '$lib/workspace/parentRepo.svelte';
	import {
		isGitRepo,
		gitBranch,
		gitTracking,
		gitAhead,
		gitBehind,
		gitHasCommits,
		gitDetached,
		gitOperation,
		gitRepoRoot,
		gitMissing,
		gitChanges,
		gitHistory,
		gitHistoryError,
		gitHistoryHasMore,
		showMoreGitHistory,
		useParentRepoNow
	} from '$lib/workspace/scm/gitStore';
	import { workspaceRoot } from '$lib/workspace/workspaceStore';
	import type { GitStatusEntry, GitLogEntry, GitFileChange } from '$lib/workspace/scm/git';

	type Props = {
		onClose: () => void;
		scmBusy: boolean;
		scmInit: () => void;
		scmDiscard: (changes: GitStatusEntry[]) => void;
		scmCommit: (message: string, paths: string[]) => Promise<boolean>;
		scmRestore: (entry: GitLogEntry) => void;
		scmIgnoreArtifacts: () => void;
		scmPublish: () => void;
		scmSync: () => void;
		scmRecheckGit: () => void;
		scmOpenDiff: (path: string) => void;
		scmOpenConflict?: (path: string) => void;
		scmFinishCombine?: () => void;
		scmCancelCombine?: () => void;
		scmCompare: (entry: GitLogEntry, path: string, from?: string) => void;
		scmChangesSince: (hash: string) => Promise<GitFileChange[]>;
		onRefreshGit: () => void;
		historyFraction: number;
		onStartHistoryResize: (e: MouseEvent) => void;
		onResizeHistoryByKey: (e: KeyboardEvent) => void;
		scmSplitEl?: HTMLDivElement;
	};
	let {
		onClose,
		scmBusy,
		scmInit,
		scmDiscard,
		scmCommit,
		scmRestore,
		scmIgnoreArtifacts,
		scmPublish,
		scmSync,
		scmRecheckGit,
		scmOpenDiff,
		scmOpenConflict,
		scmFinishCombine,
		scmCancelCombine,
		scmCompare,
		scmChangesSince,
		onRefreshGit,
		historyFraction,
		onStartHistoryResize,
		onResizeHistoryByKey,
		scmSplitEl = $bindable()
	}: Props = $props();
</script>

<aside class="bg-surface-50-950 border-surface-200-800 relative flex min-h-0 w-80 shrink-0 flex-col border-l" aria-label="代码修改">
	<header class="border-surface-200-800 flex shrink-0 items-center gap-2 border-b px-2 py-1">
		<span class="truncate text-xs font-medium">代码修改</span>
		<span class="flex-1"></span>
		<button class="btn-icon btn-icon-sm" aria-label="关闭代码修改" title="关闭代码修改" onclick={onClose}>
			<X class="size-4" />
		</button>
	</header>
	<!-- the panel owns its own scrolling: two regions with a splitter between them (same as the sidebar's) -->
	<div class="min-h-0 flex-1">
		<SourceControlPanel
			root={workspaceRoot.current ?? ''}
			isRepo={isGitRepo.current}
			parentRepo={parentRepoToConfirm(workspaceRoot.current, gitRepoRoot.current)}
			onUseParentRepo={() => void useParentRepoNow(workspaceRoot.current)}
			gitMissing={gitMissing.current}
			onRecheckGit={scmRecheckGit}
			operation={gitOperation.current}
			branch={gitBranch.current}
			tracking={gitTracking.current}
			ahead={gitAhead.current}
			behind={gitBehind.current}
			hasCommits={gitHasCommits.current}
			detached={gitDetached.current}
			changes={gitChanges.current}
			history={gitHistory.current}
			historyError={gitHistoryError.current}
			historyHasMore={gitHistoryHasMore.current}
			onShowMoreHistory={() => void showMoreGitHistory(workspaceRoot.current)}
			busy={scmBusy}
			onInit={scmInit}
			onDiscard={scmDiscard}
			onCommit={scmCommit}
			onRestore={scmRestore}
			onIgnoreArtifacts={scmIgnoreArtifacts}
			onCompare={scmCompare}
			onLoadChanges={scmChangesSince}
			onOpenDiff={scmOpenDiff}
			onRefresh={onRefreshGit}
			onPublish={scmPublish}
			onSync={scmSync}
			onOpenConflict={scmOpenConflict}
			onFinishCombine={scmFinishCombine}
			onCancelCombine={scmCancelCombine}
			{historyFraction}
			bind:splitEl={scmSplitEl}
			{onStartHistoryResize}
			{onResizeHistoryByKey}
		/>
	</div>
</aside>
