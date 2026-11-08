<script lang="ts" module>
	/** 预设选择器里的一条：技能或插件，name 是存进设置的键 */
	export type AssetChoice = { name: string; description?: string; aside?: string; warn?: boolean };
</script>

<script lang="ts">
	// 论文助手预设的技能 / 插件选择器：清单来自宿主（本机 DSH），搜索 + 复选。
	// 打开时才加载一次；列表较短，不加分页。
	type Props = {
		label: string;
		note: string;
		searchPlaceholder: string;
		emptyText: string;
		load: () => Promise<AssetChoice[]>;
		selected: string[];
		ontoggle: (name: string, on: boolean) => void;
	};
	const props: Props = $props();

	let open = $state(false);
	// null = 还没加载过；加载后即使为空也缓存住，不反复打宿主
	let assets: AssetChoice[] | null = $state(null);
	let loading = $state(false);
	let error = $state('');
	let query = $state('');

	async function ensureLoaded() {
		if (assets !== null || loading) return;
		loading = true;
		error = '';
		try {
			assets = await props.load();
		} catch (e) {
			error = String(e ?? '读取失败');
		} finally {
			loading = false;
		}
	}

	function toggleOpen() {
		open = !open;
		if (open) void ensureLoaded();
	}

	const needle = $derived(query.trim().toLowerCase());
	const filtered = $derived(
		assets === null
			? []
			: needle
				? assets.filter((a) => `${a.name} ${a.description ?? ''}`.toLowerCase().includes(needle))
				: assets
	);
</script>

<div class="border-surface-200-800 border-b">
	<div class="flex items-center justify-between gap-6 py-3">
		<div class="min-w-0">
			<div class="text-sm">{props.label}</div>
			<div class="text-muted text-xs">{props.note}</div>
		</div>
		<button type="button" class="btn btn-xs preset-tonal shrink-0 text-xs" onclick={toggleOpen}>
			{#if assets !== null}
				已选 {props.selected.length} / {assets.length}
			{:else if props.selected.length}
				已选 {props.selected.length}
			{:else}
				选择…
			{/if}
		</button>
	</div>
	{#if open}
		<div class="pb-3">
			{#if loading}
				<p class="text-muted px-1 py-4 text-center text-xs">读取中…</p>
			{:else if error}
				<p class="text-error-ink px-1 py-4 text-center text-xs">{error}</p>
			{:else if assets !== null && assets.length === 0}
				<p class="text-muted px-1 py-4 text-center text-xs">{props.emptyText}</p>
			{:else if assets !== null}
				<input
					class="input w-full text-xs"
					type="search"
					placeholder={props.searchPlaceholder}
					bind:value={query}
				/>
				<div class="surface-100-900 mt-1 max-h-56 overflow-y-auto rounded-base border">
					{#each filtered as a (a.name)}
						<label
							class="hover:preset-tonal flex cursor-pointer items-start gap-2 border-b border-surface-200-800 px-2 py-1.5 last:border-b-0"
						>
							<input
								type="checkbox"
								class="checkbox mt-0.5 shrink-0 scale-75"
								checked={props.selected.includes(a.name)}
								onchange={(e) => props.ontoggle(a.name, e.currentTarget.checked)}
							/>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-xs">{a.name}</span>
								{#if a.description}
									<span class="text-muted block truncate text-xs" title={a.description}>{a.description}</span>
								{/if}
							</span>
							{#if a.aside}
								<span class="shrink-0 text-xs {a.warn ? 'text-warning-ink' : 'text-muted'}">{a.aside}</span>
							{/if}
						</label>
					{/each}
					{#if filtered.length === 0}
						<p class="text-muted px-2 py-3 text-center text-xs">无匹配项</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
