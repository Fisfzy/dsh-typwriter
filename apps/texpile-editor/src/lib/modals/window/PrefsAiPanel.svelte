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
{#snippet rowInput(label: string, note: string, value: string, placeholder: string, key: 'agentPresetName' | 'agentPresetSkills' | 'agentPresetPlugins')}
	<div class="border-surface-200-800 flex items-center justify-between gap-6 border-b py-3">
		<div class="min-w-0">
			<div class="text-sm">{label}</div>
			<div class="text-muted text-xs">{note}</div>
		</div>
		<input
			class="input w-60 text-xs"
			spellcheck="false"
			{placeholder}
			value={(settings.current as Record<string, unknown>)[key] ?? ''}
			onchange={(e) => updateSettings({ [key]: e.currentTarget.value.trim() } as never)}
		/>
	</div>
{/snippet}

<div class="border-surface-200-800 border-b py-3">
	<div class="text-sm">论文助手预设</div>
	<div class="text-muted text-xs">这些先只保存，接入后用于给 DSH 论文助手指定人格、技能与插件。</div>
</div>
{@render rowInput('预设', '人格 / 指令预设名（留空用默认）', '', '默认', 'agentPresetName')}
{@render rowInput('预设 Skill', '逗号分隔的技能名', '', 'typst-academic, typst-tables', 'agentPresetSkills')}
{@render rowInput('预设插件', '逗号分隔的插件包名', '', 'dsh-typwriter', 'agentPresetPlugins')}

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


