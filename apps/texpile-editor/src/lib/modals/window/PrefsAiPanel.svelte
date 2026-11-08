<script lang="ts">
	// The AI category: the MCP server an assistant connects to, the agent Refine runs, and the Agent tab's.
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import { settings, updateSettings, setMcpEnabled } from '$lib/settings';
	import { agentName, isPresetAgent, PRESET_AGENTS, type RefineAgent } from '$lib/ai/selectionRefiner';
	import { lookUpRefineAgents, refineAgentsTicked, refineInstalled } from '$lib/ai/refineAgents.svelte';
	import { tip } from '$lib/components/tooltip.svelte';
	import McpSetupModal from './McpSetupModal.svelte';
	import CheckChoiceList from './CheckChoiceList.svelte';
	import AgentModelChoice from './AgentModelChoice.svelte';
	import AgentAssetPicker from './AgentAssetPicker.svelte';
	import AgentPanelPrefs from '$lib/ai/agentPanel/ui/AgentPanelPrefs.svelte';
	import { setAiOff } from '$lib/ai/aiSwitch';
	import PrefsRow from './rows/PrefsRow.svelte';
	import { m } from '$lib/paraglide/messages';

	const ROW = 'border-surface-200-800 flex items-start justify-between gap-6 border-b py-4 last:border-b-0';

	type McpStatus = { running: boolean; port: number | null; error: string | null };
	let mcp = $state<McpStatus | null>(null);
	/** the instructions modal, stacked above Preferences */
	let setupOpen = $state(false);

	function nativeMcp() {
		return (window as unknown as { texpileNative?: { mcpStatus?: () => Promise<McpStatus> } }).texpileNative;
	}
	async function refreshMcp() {
		mcp = (await nativeMcp()?.mcpStatus?.()) ?? null;
	}
	// the port only exists once main has actually bound, so read it back after the flip
	async function onMcpToggle(v: boolean) {
		await setMcpEnabled(v);
		await refreshMcp();
	}
	// read on every showing: another window may have toggled it, or the port may have been taken since
	void refreshMcp();
	lookUpRefineAgents(true);

	const AGENTS: { value: RefineAgent | ''; label: string }[] = [
		{ value: 'dsh', label: 'DeepSeek Harness' },
		{ value: 'claude', label: m.prefs_ai_agent_claude() },
		{ value: 'codex', label: m.prefs_ai_agent_codex() },
		{ value: 'agy', label: m.prefs_ai_agent_agy() },
		{ value: 'custom', label: m.prefs_ai_agent_custom() },
		// Refine off: nothing in the right-click menu or on the selection toolbar
		{ value: '', label: m.prefs_ai_agent_none() }
	];
	const installed = $derived(refineInstalled.found);
	const ticked = $derived(refineAgentsTicked());
	const agentChoices = $derived(
		AGENTS.map((a) => {
			const found = a.value && isPresetAgent(a.value) ? installed?.[a.value] : undefined;
			if (found === undefined) return a;
			// not found: not to be ticked, though one ticked before it went can still be unticked
			const aside = found ? m.prefs_ai_agent_installed() : m.prefs_ai_agent_not_found();
			return { ...a, aside, warn: !found, disabled: !found && !ticked.includes(a.value as RefineAgent) };
		})
	);
	// a model row for each ticked preset that is here, a way out for each that is not
	const tickedPresets = $derived(PRESET_AGENTS.filter((a) => ticked.includes(a)));

	async function onAiOff(off: boolean) {
		await setAiOff(off);
		await refreshMcp();
	}

	// ===== 论文助手预设：人格文本 + 从本机 DSH 读技能 / 插件 =====
	const PERSONA_MAX = 4000;
	const extra = () => settings.current as Record<string, unknown>;
	const personaLen = $derived(String(extra().agentPersona ?? '').length);
	// 历史值可能是逗号分隔字符串（旧版纯文本框），统一当成数组用
	const asList = (v: unknown): string[] =>
		Array.isArray(v) ? (v as string[]) : typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
	const presetSkills = $derived(asList(extra().agentPresetSkills));
	const presetPlugins = $derived(asList(extra().agentPresetPlugins));

	function agentApi() {
		return (
			window as unknown as {
				texpileAgent?: {
					listSkills?: () => Promise<{ skills?: { name: string; description?: string }[] }>;
					listPlugins?: () => Promise<{ plugins?: { name: string; version?: string; enabled?: boolean }[] }>;
				};
			}
		).texpileAgent;
	}
	async function loadSkills() {
		const r = await agentApi()?.listSkills?.();
		return (r?.skills ?? []).map((s) => ({ name: s.name, description: s.description ?? '' }));
	}
	async function loadPlugins() {
		const r = await agentApi()?.listPlugins?.();
		return (r?.plugins ?? []).map((p) => ({
			name: p.name,
			description: (p.version ?? '').length > 48 ? `${(p.version ?? '').slice(0, 48)}…` : (p.version ?? ''),
			aside: p.enabled ? '已启用' : '未启用',
			warn: !p.enabled
		}));
	}
	function toggleAsset(key: 'agentPresetSkills' | 'agentPresetPlugins', current: string[], name: string, on: boolean) {
		updateSettings({ [key]: on ? [...current, name] : current.filter((s) => s !== name) } as never);
	}

	function pick(value: string): void {
		updateSettings({ refineAgents: value ? [value as RefineAgent] : [] });
	}
</script>

<!-- under its own box, as wide as the rows; what the command does is its hover, the example its placeholder -->
{#snippet customCommand(value: string)}
	{#if value === 'custom' && ticked.includes('custom')}
		<div class="px-1.5 pt-0.5 pb-1.5">
			<input
				class="input w-full font-mono text-xs"
				spellcheck="false"
				aria-label={m.prefs_ai_agent_command()}
				placeholder={m.prefs_ai_agent_command_placeholder()}
				use:tip={m.prefs_ai_agent_command_note()}
				value={settings.current.aiAgentCommand}
				onchange={(e) => updateSettings({ aiAgentCommand: e.currentTarget.value.trim() })}
			/>
		</div>
	{/if}
{/snippet}

{#snippet toggle(checked: boolean, onChange: (v: boolean) => void)}
	<Switch {checked} onCheckedChange={(d) => onChange(d.checked)}>
		<Switch.Control><Switch.Thumb /></Switch.Control>
		<Switch.HiddenInput />
	</Switch>
{/snippet}

<!-- ===== 论文助手（DSH）的运行预设 ===== -->
<div class="border-surface-200-800 border-b py-3">
	<div class="text-sm">论文助手预设</div>
	<div class="text-muted text-xs">为 DSH 论文助手保存人格与预选的技能、插件；清单读取自本机 DSH。</div>
</div>

<!-- 人格：自由文本的自定义指令，容量指示在右上 -->
<div class="border-surface-200-800 border-b py-3">
	<div class="flex items-start justify-between gap-6">
		<div class="min-w-0">
			<div class="text-sm">助手人格</div>
			<div class="text-muted text-xs">自定义指令，作为论文助手的人格 / 系统提示（留空用默认）。</div>
		</div>
		<span class="text-muted shrink-0 pt-0.5 text-xs">{personaLen} / {PERSONA_MAX}</span>
	</div>
	<textarea
		class="textarea mt-2 w-full resize-y text-xs"
		rows="4"
		spellcheck="false"
		maxlength={PERSONA_MAX}
		placeholder="例如：你是我的论文润色助手，保持学术语气，改动默认走修订模式…"
		value={extra().agentPersona ?? ''}
		onchange={(e) => updateSettings({ agentPersona: e.currentTarget.value } as never)}
	></textarea>
</div>

<AgentAssetPicker
	label="预设 Skill"
	note="论文助手启动时预载的本机 DSH 技能"
	searchPlaceholder="搜索技能…"
	emptyText="本机 DSH（~/.dsh/skills）里没有找到技能"
	load={loadSkills}
	selected={presetSkills}
	ontoggle={(name, on) => toggleAsset('agentPresetSkills', presetSkills, name, on)}
/>
<AgentAssetPicker
	label="预设插件"
	note="论文助手启动时装载的本机 DSH 插件"
	searchPlaceholder="搜索插件…"
	emptyText="本机 DSH（desktop profile）里没有找到插件"
	load={loadPlugins}
	selected={presetPlugins}
	ontoggle={(name, on) => toggleAsset('agentPresetPlugins', presetPlugins, name, on)}
/>

<!-- ===== 代理工作区策略 ===== -->
<div class="border-surface-200-800 flex items-start justify-between gap-6 border-b py-4">
	<div class="min-w-0">
		<div class="text-sm">代理工作区</div>
		<div class="text-muted text-xs">论文助手读写哪个文件夹；会话也按这个目录归档。</div>
	</div>
	<div class="flex shrink-0 flex-col items-end gap-2">
		<div class="flex gap-1">
			<button
				class="btn btn-xs {((settings.current as Record<string, unknown>).agentWorkspaceMode ?? 'paper') === 'paper'
					? 'preset-filled-primary-500'
					: 'preset-tonal'}"
				onclick={() => updateSettings({ agentWorkspaceMode: 'paper' } as never)}>论文文件夹</button
			>
			<button
				class="btn btn-xs {(settings.current as Record<string, unknown>).agentWorkspaceMode === 'custom'
					? 'preset-filled-primary-500'
					: 'preset-tonal'}"
				onclick={() => updateSettings({ agentWorkspaceMode: 'custom' } as never)}>自定义目录</button
			>
		</div>
		{#if (settings.current as Record<string, unknown>).agentWorkspaceMode === 'custom'}
			<input
				class="input w-60 font-mono text-xs"
				spellcheck="false"
				placeholder="D:\AIWORK\TYPST PAPERS"
				value={(settings.current as Record<string, unknown>).agentWorkspacePath ?? ''}
				onchange={(e) => updateSettings({ agentWorkspacePath: e.currentTarget.value.trim() } as never)}
			/>
		{/if}
	</div>
</div>

<!-- ===== 是否继承宿主插件 ===== -->
<div class="border-surface-200-800 flex items-start justify-between gap-6 border-b py-4">
	<div class="min-w-0">
		<div class="text-sm">继承宿主插件</div>
		<div class="text-muted text-xs">
			开着：论文助手复用本机 DSH 的插件与登录态（启动约 9 秒）。关掉：用独立的 DSH 家目录，插件更干净、启动更快，
			但需要在那个家目录里有 API key。
		</div>
	</div>
	{@render toggle(
		(settings.current as Record<string, unknown>).agentInheritHostPlugins !== false,
		(v) => updateSettings({ agentInheritHostPlugins: v } as never)
	)}
</div>
<PrefsRow id="ai-off">
	{@render toggle(settings.current.aiOff === true, (v) => void onAiOff(v))}
</PrefsRow>

<!-- what the switch turns off stays in sight, as it was picked, for when it is turned back on -->
<div class:opacity-50={settings.current.aiOff} inert={settings.current.aiOff}>
	<!-- persisted through the main process, not updateSettings: flipping this also has to start or stop the
	     loopback server, and main owns it -->
	<PrefsRow id="mcp">
		{@render toggle(settings.current.mcpEnabled === true, (v) => void onMcpToggle(v))}
	</PrefsRow>
	{#if settings.current.mcpEnabled === true && mcp}
		<div class="border-surface-200-800 flex items-center justify-between gap-3 border-b py-3">
			{#if mcp.running && mcp.port}
				<span class="text-muted text-xs">{m.prefs_mcp_status({ addr: `127.0.0.1:${mcp.port}` })}</span>
				<!-- the command lives in its own modal: it is long, and read once -->
				<button class="btn btn-xs preset-tonal shrink-0 text-xs" onclick={() => (setupOpen = true)}>{m.prefs_mcp_show()}</button>
			{:else}
				<span class="text-error-ink text-xs">{m.prefs_mcp_error({ error: mcp.error ?? '' })}</span>
			{/if}
		</div>
	{/if}

	<PrefsRow id="ai-agent">
		<CheckChoiceList
			one
			choices={agentChoices}
			values={ticked.length ? ticked : settings.current.refineAgents ? [''] : []}
			label={m.prefs_ai_agent()}
			ontoggle={pick}
			below={customCommand}
		/>
	</PrefsRow>
	{#each tickedPresets as agent (agent)}
		{#if installed?.[agent]}
			<div class={ROW}>
				<AgentModelChoice {agent} />
			</div>
		{:else if installed}
			<!-- "Not found" beside the name says nothing about the way out, and the folder list is in another category -->
			<div class="border-surface-200-800 border-b py-3">
				<p class="text-muted text-xs leading-relaxed">{m.prefs_ai_agent_elsewhere({ agent: agentName(agent) })}</p>
			</div>
		{/if}
	{/each}

	<AgentPanelPrefs />
</div>

<McpSetupModal bind:open={setupOpen} port={mcp?.port ?? null} />


