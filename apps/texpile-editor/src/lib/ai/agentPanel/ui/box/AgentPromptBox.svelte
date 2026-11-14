<script lang="ts">
	// Where the reader writes to the agent. The open file, or the lines selected in it, goes with each message unless
	// taken off, and so do images pasted, dropped or picked from the +; the agent's own settings (its permission mode,
	// its model) sit beside the + as it offers them
	import { ArrowUp, ChevronDown, Square } from '@lucide/svelte';
	import MenuDropdown from '$lib/menus/MenuDropdown.svelte';
	import AgentFilePill from '../AgentFilePill.svelte';
	import AgentImagePill from '../AgentImagePill.svelte';
	import { configOptionButton, configOptionMenu } from './configOptionMenu';
	import { SlashMenu } from './slashMenu.svelte';
	import AgentCommandMenu from './AgentCommandMenu.svelte';
	import AgentAddMenu from './AgentAddMenu.svelte';
	import AgentContextUsage from './AgentContextUsage.svelte';
	import { COMPACT_CHAT_MESSAGE } from './contextUsageMeter';
	import { runsCommand } from '../../slashMatch';
	import { attachedKey } from '../../attach/attached';
	import { EditorSelection } from '../../attach/editorSelection.svelte';
	import { ImageAttachments } from '../../attach/imageAttachments.svelte';
	import { droppedPaths } from '../../attach/dropPaths';
	import { consumeAgentPrompt } from '../../pendingPrompt.svelte';
	import { tip } from '$lib/components/tooltip.svelte';
	import { m } from '$lib/paraglide/messages';
	import { agentSession } from '../../agentSession.svelte';
	import type { AgentCommand, Attached, ConfigOption, ContextUsage, PastedImage } from '../../agentPanel.types';

	type Props = {
		agent: string;
		working: boolean;
		file: string | null;
		config: ConfigOption[];
		/** the agent's slash commands, offered when the text starts with / */
		commands: AgentCommand[];
		/** the agent takes the selected lines' text; without it only the file goes */
		takesSelection: boolean;
		/** the agent takes images, so a pasted, dropped or picked one goes with the message */
		takesImages: boolean;
		usage: ContextUsage | null;
		onSend: (text: string, attached: Attached[], images: PastedImage[]) => void;
		onStop: () => void;
		onConfig: (id: string, value: string) => void;
	};
	const props: Props = $props();
	let text = $state('');
	// 外部入口（文件菜单的导出 Word 等）注入的预填指令：落到输入框让用户改完自己发
	$effect(() => {
		const injected = consumeAgentPrompt();
		if (injected) text = injected;
	});
	const images = new ImageAttachments(() => props.takesImages);
	const slash = new SlashMenu(
		() => text,
		() => props.commands
	);
	const menuId = $props.id();
	const selected = new EditorSelection();
	$effect(() => selected.watch());
	// what the x took off, which stays off until the file or the selected lines change
	let detached = $state<string | null>(null);
	const attached = $derived.by((): Attached | null => {
		// a command goes alone: the agent runs one only when its text comes by itself
		if (!props.file || runsCommand(text, props.commands)) return null;
		const lines = props.takesSelection && selected.current?.path === props.file ? selected.current.lines : null;
		const a = { path: props.file, lines };
		return attachedKey(a) === detached ? null : a;
	});
	// files and folders dragged in from the tree (or another window); they ride the message as links
	let extras = $state<Attached[]>([]);
	const allAttached = $derived(attached ? [attached, ...extras] : extras);

	const empty = $derived(!text.trim() && !images.list.length && !extras.length);

	function send(): void {
		if (props.working || empty) return;
		props.onSend(text, allAttached, images.list);
		text = '';
		images.clear();
		extras = [];
	}

	// text on the clipboard beside an image still pastes for an agent that takes no images
	function onPaste(e: ClipboardEvent): void {
		if (images.add(e.clipboardData?.files)) e.preventDefault();
	}

	// a file let go anywhere on the box stays in it: left to the window, it would replace the app with the file.
	// Tree drags carry paths (a file AND a folder both count); OS drags carry Files, which stay images.
	function onDrop(e: DragEvent): void {
		const paths = droppedPaths(e);
		if (paths) {
			e.preventDefault();
			e.stopPropagation();
			const seen = new Set(allAttached.map(attachedKey));
			for (const path of paths) {
				const a: Attached = { path, lines: null };
				if (!seen.has(attachedKey(a))) extras = [...extras, a];
			}
			return;
		}
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		e.stopPropagation();
		images.add(e.dataTransfer.files);
	}

	function takeCommand(command: AgentCommand): void {
		text = slash.completion(command);
	}

	// 空输入时的预设快捷指令（参考 llm-for-zotero 的 Summarize/Key Points 行）：点击填入，可改再发
	const PRESETS: { label: string; prompt: string }[] = [
		{ label: '总结当前文件', prompt: '请总结当前打开文件的主要内容与结构。' },
		{ label: '润色选中文本', prompt: '请润色我选中的文本：保持学术语气，改动最小化，并说明每处改动的原因。' },
		{ label: '检查语法', prompt: '请检查当前文件的语法与格式错误，逐条给出位置和修改建议。' },
		{ label: '改进表达', prompt: '请找出当前文件中表达不够清晰或学术性不足的段落并改写。' }
	];

	// ---- 模型 / 思考强度 ----
	// 两条数据源，按宿主择一：
	// · DSH 宿主（原生会话）：session/modelCatalog——DSH 本体同一份目录（凭证感知，与本地配置
	//   一致），切换走 session/selectModel 作用于当前会话，立即生效
	// · 独立 dev 页（ACP 回落）：agent:modelInfo——快照目录 + 写 settings.json，新对话生效
	type ModelEntry = { provider: string; id: string; name: string; contextWindow: number | null; efforts: string[] | null };
	type ModelSel = { provider: string | null; model: string | null; reasoningEffort: string | null };
	type NativeSessionApi = {
		modelCatalog?: () => Promise<{
			default: ModelSel;
			groups?: Array<{
				id: string;
				name?: string;
				models?: Array<{ id: string; name?: string; reasoning?: { efforts?: string[]; defaultEffort?: string } }>;
			}>;
		}>;
		selectModel?: (sessionId: string, sel: Partial<ModelSel>) => Promise<{ selected: ModelSel }>;
	};
	let modelData = $state<{ models: ModelEntry[]; current: ModelSel; efforts: string[] } | null>(null);
	const nativeSession = $derived((window as unknown as { texpileSession?: NativeSessionApi }).texpileSession);

	$effect(() => {
		if (nativeSession?.modelCatalog) {
			void nativeSession
				.modelCatalog()
				.then((c) => {
					const models: ModelEntry[] = [];
					for (const g of c.groups ?? []) {
						for (const m of g.models ?? []) {
							models.push({
								provider: g.id,
								id: m.id,
								name: m.name || m.id,
								contextWindow: null,
								efforts: m.reasoning?.efforts ? [...m.reasoning.efforts] : null
							});
						}
					}
					modelData = { models, current: c.default ?? { provider: null, model: null, reasoningEffort: null }, efforts: [] };
				})
				.catch(() => {});
			return;
		}
		void (
			window as unknown as { texpileAgent?: { modelInfo?: () => Promise<{ models: ModelEntry[]; current: ModelSel; efforts: string[] }> } }
		).texpileAgent
			?.modelInfo?.()
			.then(
				(r) =>
					(modelData = r && r.models ? r : { models: [], current: { provider: null, model: null, reasoningEffort: null }, efforts: [] })
			)
			.catch(() => {});
	});
	async function applyModel(patch: Partial<ModelSel>): Promise<void> {
		if (!modelData) return;
		// 原生：作用于当前会话（agentSession.chat 即 sessionId），立即生效
		if (nativeSession?.selectModel && agentSession.chat) {
			try {
				const next = { ...modelData.current, ...patch };
				const r = await nativeSession.selectModel(agentSession.chat, patch);
				if (r?.selected) modelData = { ...modelData, current: r.selected };
				else modelData = { ...modelData, current: next };
			} catch {
				/* 会话可能刚切换：保持现状 */
			}
			return;
		}
		const api = (window as unknown as { texpileAgent?: { setModel?: (s: Partial<ModelSel>) => Promise<{ current: ModelSel }> } })
			.texpileAgent;
		if (!api?.setModel) return;
		try {
			const r = await api.setModel(patch);
			if (r?.current) modelData = { ...modelData, current: r.current };
		} catch {
			/* 落盘失败：保持现状 */
		}
	}
	// 当前模型的可选思考强度：原生目录按模型声明（无则隐藏强度菜单），ACP 回落用全局四档
	const EFFORT_LABELS: Record<string, string> = { minimal: '极简', low: '低', medium: '中', high: '高' };
	const currentEfforts = $derived.by(() => {
		const cur = modelData?.current;
		const m = modelData?.models.find((x) => x.provider === cur?.provider && x.id === cur?.model);
		return m?.efforts ?? modelData?.efforts ?? [];
	});
	/** 每组直接可见的模型数；更长的一组把余下收进组尾的子菜单（MenuDropdown 的 more） */
	const GROUP_VISIBLE = 8;
	const modelGroups = $derived.by(() => {
		const cur = modelData?.current;
		const byProvider = new Map<string, ModelEntry[]>();
		for (const m of modelData?.models ?? []) {
			if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
			byProvider.get(m.provider)!.push(m);
		}
		return [...byProvider.entries()].map(([provider, list]) => {
			function option(m: ModelEntry) {
				return {
					value: `${m.provider}::${m.id}`,
					label: m.name,
					checked: cur?.provider === m.provider && cur?.model === m.id
				};
			}
			const visible = list.slice(0, GROUP_VISIBLE).map(option);
			const rest = list.slice(GROUP_VISIBLE).map(option);
			return {
				label: `${provider}${list.length > GROUP_VISIBLE ? `（${list.length}）` : ''}`,
				options: visible,
				...(rest.length ? { more: { label: '更多模型', options: rest } } : {})
			};
		});
	});
	const effortGroups = $derived.by(() => {
		const cur = modelData?.current.reasoningEffort ?? null;
		return [
			{
				label: '思考强度',
				options: [
					{ value: '', label: '默认（跟随模型）', checked: cur === null },
					...currentEfforts.map((e) => ({ value: e, label: EFFORT_LABELS[e] ?? e, checked: cur === e }))
				]
			}
		];
	});
	const currentModelLabel = $derived(modelData?.current.model ?? '模型');
	const currentEffortLabel = $derived.by(() => {
		const e = modelData?.current.reasoningEffort;
		return e ? `思考 ${EFFORT_LABELS[e] ?? e}` : '思考 默认';
	});

	// while the / menu is open the arrows, Enter, Tab and Escape are its; Enter only completes, a second one sends
	function slashKey(e: KeyboardEvent): boolean {
		if (!slash.open || e.isComposing) return false;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') slash.move(e.key === 'ArrowDown' ? 1 : -1);
		else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
			if (!slash.picked) return false;
			takeCommand(slash.picked);
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			slash.dismiss();
		} else return false;
		e.preventDefault();
		return true;
	}

	function onKeydown(e: KeyboardEvent): void {
		images.refused = false;
		if (slashKey(e)) return;
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			send();
		}
	}
</script>

<div class="px-3 pb-2">
	<!-- Skeleton's textarea on the frame, so it reads as the app's other text boxes and lights up while one types in it.
	     What goes with the message above the text, the + and the agent's settings under it, as chat boxes lay it out -->
	<div
		class="textarea relative [--field-size:var(--text-sm)]"
		role="group"
		ondragover={(e) =>
			(e.dataTransfer?.types.includes('Files') || e.dataTransfer?.types.includes('application/x-texpile-paths')) && e.preventDefault()}
		ondrop={onDrop}
	>
		{#if slash.open}
			<AgentCommandMenu id={menuId} commands={slash.matches} picked={slash.picked} onPick={takeCommand} />
		{/if}
		{#if attached || images.list.length || extras.length}
			<div class="border-surface-200-800 mb-1.5 flex flex-wrap items-center gap-1 border-b pb-1.5">
				{#if attached}<AgentFilePill {attached} onDetach={() => (detached = attachedKey(attached))} />{/if}
				{#each extras as a, i (a.path)}
					<AgentFilePill attached={a} onDetach={() => (extras = extras.filter((_, j) => j !== i))} />
				{/each}
				{#each images.list as image, i (i)}
					<AgentImagePill {image} onDetach={() => images.remove(i)} />
				{/each}
			</div>
		{/if}
		{#if !text.trim() && !slash.open}
			<!-- 预设快捷指令：空输入才出现，点一下填入（润色那条实际带不带选区由附件决定） -->
			<div class="mb-1.5 flex flex-wrap gap-1">
				{#each PRESETS as p (p.label)}
					<button
						type="button"
						class="preset-tonal hover:preset-tonal-primary rounded-full px-2 py-0.5 text-[11px]"
						onclick={() => (text = p.prompt)}
					>
						{p.label}
					</button>
				{/each}
			</div>
		{/if}
		<textarea
			class="block field-sizing-content max-h-32 min-h-5 w-full resize-none bg-transparent text-sm leading-5 outline-none placeholder:text-[var(--field-placeholder)]"
			rows="1"
			placeholder={m.agent_panel_placeholder({ agent: props.agent })}
			aria-label={m.agent_panel_placeholder({ agent: props.agent })}
			aria-autocomplete="list"
			aria-controls={slash.open ? menuId : undefined}
			aria-activedescendant={slash.open && slash.picked ? `${menuId}-${slash.picked.name}` : undefined}
			bind:value={text}
			onkeydown={onKeydown}
			onpaste={(e) => void onPaste(e)}
			onfocus={() => selected.read()}></textarea>
		<div class="mt-1.5 flex h-6 items-center gap-1">
			<AgentAddMenu
				agent={props.agent}
				takesImages={props.takesImages}
				canAttachFile={!!props.file && !attached && !runsCommand(text, props.commands)}
				onImages={(files) => images.add(files)}
				onAttachFile={() => (detached = null)}
			/>
			{#if modelData && modelGroups.length}
				<!-- 模型 / 思考强度：写 DSH 的默认模型选择（settings.json），新对话起生效 -->
				<MenuDropdown
					groups={modelGroups}
					placement="bottom-start"
					onSelect={(v) => {
						const [provider, ...rest] = String(v).split('::');
						void applyModel({ provider, model: rest.join('::') });
					}}
				>
					{#snippet trigger(attrs)}
						<button
							{...attrs}
							class="text-muted hover:bg-surface-200-800 rounded-base flex h-6 shrink-0 items-center gap-0.5 px-1.5 text-xs whitespace-nowrap transition-colors"
							use:tip={'切换模型（新对话生效）'}
						>
							<span class="max-w-28 truncate">{currentModelLabel}</span>
							<ChevronDown class="size-3 shrink-0" />
						</button>
					{/snippet}
				</MenuDropdown>
				<MenuDropdown
					groups={effortGroups}
					placement="bottom-start"
					onSelect={(v) => void applyModel({ reasoningEffort: v === '' ? null : String(v) })}
				>
					{#snippet trigger(attrs)}
						<button
							{...attrs}
							class="text-muted hover:bg-surface-200-800 rounded-base flex h-6 shrink-0 items-center gap-0.5 px-1.5 text-xs whitespace-nowrap transition-colors"
							use:tip={'思考强度（新对话生效）'}
						>
							<span class="max-w-24 truncate">{currentEffortLabel}</span>
							<ChevronDown class="size-3 shrink-0" />
						</button>
					{/snippet}
				</MenuDropdown>
			{/if}
			{#each props.config as option (option.id)}
				<MenuDropdown groups={configOptionMenu(option)} placement="bottom-start" onSelect={(v) => props.onConfig(option.id, v)}>
					{#snippet trigger(attrs)}
						<button
							{...attrs}
							class="text-muted hover:bg-surface-200-800 rounded-base flex h-6 shrink-0 items-center gap-0.5 px-1.5 text-xs whitespace-nowrap transition-colors"
							aria-label={option.name}
							use:tip={option.description ?? option.name}
						>
							{configOptionButton(option)}
							<ChevronDown class="size-3 shrink-0" />
						</button>
					{/snippet}
				</MenuDropdown>
			{/each}
			<span class="flex-1"></span>
			{#if props.usage}
				<AgentContextUsage
					usage={props.usage}
					commands={props.commands}
					working={props.working}
					agent={props.agent}
					onCompact={() => props.onSend(COMPACT_CHAT_MESSAGE, [], [])}
				/>
			{/if}
			{#if props.working}
				<button
					class="btn-icon preset-tonal size-6 shrink-0 p-0"
					use:tip={m.agent_panel_stop()}
					aria-label={m.agent_panel_stop()}
					onclick={props.onStop}
				>
					<Square class="size-2.5 fill-current" />
				</button>
			{:else}
				<button
					class="btn-icon preset-filled-primary-500 size-6 shrink-0 p-0"
					disabled={empty}
					use:tip={m.agent_panel_send()}
					aria-label={m.agent_panel_send()}
					onclick={send}
				>
					<ArrowUp class="size-3.5" />
				</button>
			{/if}
		</div>
	</div>
	{#if images.refused}<p class="text-muted mt-1 px-1 text-xs">{m.agent_panel_no_images({ agent: props.agent })}</p>{/if}
</div>
