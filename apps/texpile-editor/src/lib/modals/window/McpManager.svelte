<script lang="ts">
	// 偏好设置 → AI 助手的 MCP 服务器管理：配置源头在插件设置，落盘时同步生成 DSH 的
	// profile patch（一个 server = 一条 dsh-mcp-client 条目）。patch 是 startup 重载，
	// 所以改动后重启 AGENT 对话即生效——面板自带「开新对话」就是重启。
	type McpServer = { name: string; url: string; token: string };
	type Api = {
		mcpList?: () => Promise<{ servers?: McpServer[] }>;
		mcpSet?: (servers: McpServer[]) => Promise<{ servers?: McpServer[] }>;
		mcpTest?: (s: McpServer) => Promise<{ ok: boolean; serverInfo?: { name?: string } | null; tools?: number | null; error?: string }>;
		zoteroToken?: () => Promise<{ token?: string | null }>;
	};
	function api(): Api | undefined {
		return (window as unknown as { texpileAgent?: Api }).texpileAgent;
	}

	let servers = $state<McpServer[] | null>(null);
	let testing = $state<string | null>(null);
	// name -> 测试结果；null = 没测，ok 时是工具数文本，否则是错误
	let results = $state<Record<string, { ok: boolean; text: string }>>({});
	let changed = $state(false);
	let name = $state('');
	let url = $state('');
	let token = $state('');

	$effect(() => {
		void api()
			?.mcpList?.()
			.then((r) => (servers = Array.isArray(r?.servers) ? r.servers : []))
			.catch(() => (servers = []));
	});

	async function persist(next: McpServer[]): Promise<void> {
		servers = next;
		changed = true;
		try {
			const r = await api()?.mcpSet?.(next);
			if (Array.isArray(r?.servers)) servers = r.servers;
		} catch {
			/* 落盘失败：界面保持已编辑状态，保存提示仍在 */
		}
	}

	async function add(): Promise<void> {
		const n = name.trim();
		const u = url.trim();
		if (!n || !u || servers === null) return;
		if (servers.some((s) => s.name === n)) return;
		await persist([...servers, { name: n, url: u, token: token.trim() }]);
		name = '';
		url = '';
		token = '';
	}

	// 一键 Zotero：llm-for-zotero 的 MCP 端点写死，token 从它的 Zotero 偏好里自动读
	async function addZotero(): Promise<void> {
		if (servers === null || servers.some((s) => s.name === 'zotero')) return;
		const t = await api()
			?.zoteroToken?.()
			.catch(() => ({ token: null }));
		await persist([...servers, { name: 'zotero', url: 'http://127.0.0.1:23119/llm-for-zotero/mcp', token: t?.token ?? '' }]);
	}

	async function test(s: McpServer): Promise<void> {
		testing = s.name;
		try {
			const r = await api()?.mcpTest?.(s);
			results = {
				...results,
				[s.name]: r?.ok
					? { ok: true, text: `已连通${r.tools != null ? ` · ${r.tools} 个工具` : ''}` }
					: { ok: false, text: r?.error || '连接失败' }
			};
		} finally {
			testing = null;
		}
	}

	function remove(s: McpServer): void {
		if (servers === null) return;
		const { [s.name]: _drop, ...rest } = results;
		results = rest;
		void persist(servers.filter((x) => x.name !== s.name));
	}
</script>

<div class="border-surface-200-800 border-b py-3">
	<div class="flex items-start justify-between gap-6">
		<div class="min-w-0">
			<div class="text-sm">MCP 服务器</div>
			<div class="text-muted text-xs">
				AGENT 对话的外接工具源（读写文献库等）。改动在 <b>重启对话</b> 后生效；Zotero 需在本机运行 llm-for-zotero 并开启 External MCP。
			</div>
		</div>
		<button type="button" class="btn btn-xs preset-tonal shrink-0 text-xs" onclick={() => void addZotero()}>+ Zotero 文献库</button>
	</div>

	{#if servers === null}
		<p class="text-muted px-1 py-3 text-center text-xs">读取中…</p>
	{:else}
		<div class="mt-2 flex flex-col gap-1">
			{#each servers as s (s.name)}
				<div class="surface-100-900 rounded-base flex items-center gap-2 border px-2 py-1.5">
					<span class="preset-tonal-primary-500 rounded-full px-1.5 py-0.5 text-[10px] uppercase">{s.name}</span>
					<span class="text-muted min-w-0 flex-1 truncate text-xs">{s.url}</span>
					{#if results[s.name]}
						<span class="shrink-0 text-xs {results[s.name].ok ? 'text-success-ink' : 'text-error-ink'}" title={results[s.name].text}>
							{results[s.name].text.slice(0, 24)}
						</span>
					{/if}
					<button
						type="button"
						class="btn btn-xs preset-tonal shrink-0 px-1.5 text-[11px]"
						disabled={testing === s.name}
						onclick={() => void test(s)}
					>
						{testing === s.name ? '测试中…' : '测试'}
					</button>
					<button
						type="button"
						class="btn-icon btn-icon-xs hover:preset-tonal hover:text-error-ink shrink-0"
						aria-label="移除 {s.name}"
						onclick={() => remove(s)}>✕</button
					>
				</div>
			{/each}
			{#if servers.length === 0}
				<p class="text-muted px-1 py-1 text-xs">尚未配置。添加一个 MCP 端点（或点右上角一键接入 Zotero），AGENT 即获得它的全部工具。</p>
			{/if}
		</div>

		<div class="mt-2 flex flex-wrap items-center gap-1">
			<input class="input w-28 text-xs" placeholder="名称" bind:value={name} />
			<input class="input min-w-40 flex-1 text-xs" placeholder="http://127.0.0.1:23119/…/mcp" bind:value={url} />
			<input class="input w-36 text-xs" placeholder="Bearer token（可选）" bind:value={token} />
			<button type="button" class="btn btn-xs preset-tonal text-xs" disabled={!name.trim() || !url.trim()} onclick={() => void add()}
				>添加</button
			>
		</div>
		{#if changed}
			<p class="text-muted mt-1.5 px-1 text-xs">已保存。<b>重启 AGENT 对话</b>（面板右上历史菜单 → 开新对话）后生效。</p>
		{/if}
	{/if}
</div>
