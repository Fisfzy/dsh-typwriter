// DSH 原生会话桥：与 AcpBridge 同形，内部直连同源 Gateway（window.texpileSession）。
// 会话即 DSH 工作区原生会话——侧栏可见、可管理、可续聊——并免掉自起 acp 子进程。
// 事件翻译：DSH 的 durable 事件（user/message、assistant/message…）→ 面板现有的
// ACP update 形状（agentItems.applyUpdate 消费），UI 组件零改动。
import type { AcpBridge } from './acpBridge';
import type { AcpEvent, ChatInfo } from './agentPanel.types';
import { workspaceRoot } from '$lib/workspace/workspaceStore';

type SessionApi = {
	available(): boolean;
	create(opts: { cwd?: string; sessionId?: string }): Promise<{ sessionId: string; agentPreset?: string }>;
	prompt(sessionId: string, text: string): Promise<{ accepted: boolean }>;
	cancel(sessionId: string): Promise<unknown>;
	list(): Promise<Array<{ sessionId: string; updatedAt: number; cwd?: string; blank?: boolean }>>;
	page(sessionId: string, maxMessages?: number): Promise<{ records: unknown[]; hasMore: boolean } | null>;
	follow(
		sessionId: string,
		handlers: { onFrame: (f: unknown) => void; onDone?: () => void; onError?: (e: Error) => void }
	): Promise<() => void>;
};

// 会话粘性：面板开合 / 页面重载后仍回到"当前正在用的那个"会话，而不是永远吸附最新。
// 模块级 + localStorage 双层：前者管面板开合，后者管整页刷新。换工作区由 cwd 校验拦下。
const PIN_KEY = 'texpile:agent-session-pin';
let pinnedSessionId: string | null = null;
try {
	pinnedSessionId = JSON.parse(localStorage.getItem(PIN_KEY) ?? 'null') as string | null;
} catch {
	pinnedSessionId = null;
}
function pinSession(root: string, id: string): void {
	pinnedSessionId = id;
	try {
		localStorage.setItem(PIN_KEY, JSON.stringify({ root, id }));
	} catch {
		/* 隐私模式等：粘性降级为会话内有效 */
	}
}
// 已知标题：session/title 事件 + 本地首条消息种子。session/list 不带标题，DSH 只在 follow 流里发
const knownTitles = new Map<string, string>();

// 本地可读标题（只存在 Typwriter 的 localStorage，不写回 DSH）：圈选会话的 DSH 标题
// 会是 "[AG-EDIT] file:///..."，列表里完全没法认；这里改成 "main.typ L11–15 · 意图"。
const LOCAL_TITLES_KEY = 'texpile:agent-chat-titles';
const localTitles = new Map<string, string>();
try {
	const saved = JSON.parse(localStorage.getItem(LOCAL_TITLES_KEY) ?? '{}') as Record<string, string>;
	for (const [id, title] of Object.entries(saved)) if (typeof title === 'string' && title) localTitles.set(id, title);
} catch {
	/* 损坏的本地标题不影响会话 */
}

function saveLocalTitles(): void {
	try {
		localStorage.setItem(LOCAL_TITLES_KEY, JSON.stringify(Object.fromEntries(localTitles)));
	} catch {
		/* 隐私模式：仅内存有效 */
	}
}

/** 把 prompt 变成列表里认得出的标题；圈选 prompt 解析文件/行范围/意图，其它取首行 */
export function readableChatTitle(text: string): string {
	const m = /\[AG-EDIT\]\s*file:\/\/(.+?)#L(\d+):(\d+)/.exec(text);
	if (m) {
		const file = decodeURIComponent(m[1]).split(/[\\/]/).pop() ?? m[1];
		const intent = /\[意图\]\s*([^\n]+)/.exec(text)?.[1]?.trim() ?? '';
		const range = `L${m[2]}\u2013${m[3]}`;
		return intent ? `${file} ${range} \u00b7 ${intent.slice(0, 28)}` : `${file} ${range}`;
	}
	return text.trim().split('\n')[0].slice(0, 48);
}

function setLocalTitle(sessionId: string, title: string): void {
	if (!title) return;
	localTitles.set(sessionId, title);
	saveLocalTitles();
}

function api(): SessionApi | undefined {
	return (globalThis as { texpileSession?: SessionApi }).texpileSession;
}

type WireEvent = { type: string; seq: number; time: number } & Record<string, unknown>;
type MessageLike = { role?: string; content?: Array<{ type?: string; text?: string }>; source?: { kind?: string; rpcId?: string } };

function messageOf(event: WireEvent): MessageLike | null {
	const payload = event['data'];
	return payload && typeof payload === 'object' && 'message' in payload ? (payload.message as MessageLike) : null;
}

function textOf(message: MessageLike): string {
	return (message.content ?? [])
		.filter((p) => p?.type === 'text' && typeof p.text === 'string')
		.map((p) => p.text as string)
		.join('');
}

/** 一条 durable 事件 → 面板的 ACP update；不认识的返回 null（session/title 在别处接、request/* 静默跳过） */
function toUpdate(
	event: WireEvent,
	ownRpcIds: Set<string>
): { sessionUpdate: 'user_message_chunk' | 'agent_message_chunk'; content: { type: 'text'; text: string } } | null {
	const message = messageOf(event);
	if (!message) return null;
	if (event.type === 'user/message') {
		// 自己发的这条本地已显示（send() push 过）：按 prompt 的 requestId 认出来跳过
		if (message.source?.kind === 'user-rpc' && message.source.rpcId && ownRpcIds.has(message.source.rpcId)) return null;
		const text = textOf(message);
		if (!text) return null;
		return { sessionUpdate: 'user_message_chunk' as const, content: { type: 'text', text } };
	}
	if (event.type === 'assistant/message') {
		const text = textOf(message);
		if (!text) return null;
		return { sessionUpdate: 'agent_message_chunk' as const, content: { type: 'text', text } };
	}
	return null;
}

/** 工具调用事件的卡片 update（tool/call 挂起 → tool/result 完成），实时流与历史回放共用 */
function toolUpdate(event: WireEvent): Record<string, unknown> | null {
	const d = event['data'] as { callId?: string; name?: string; message?: { content?: Array<{ type?: string; text?: string }> } } | null;
	const callId = d?.callId;
	if (!callId) return null;
	if (event.type === 'tool/call') {
		return {
			sessionUpdate: 'tool_call',
			toolCallId: callId,
			title: d?.name ?? '工具调用',
			kind: 'other',
			status: 'in_progress'
		};
	}
	const outText = (d?.message?.content ?? [])
		.filter((p) => p?.type === 'text')
		.map((p) => p.text ?? '')
		.join('');
	return {
		sessionUpdate: 'tool_call_update',
		toolCallId: callId,
		status: 'completed',
		...(outText ? { content: { type: 'text', text: outText.slice(0, 400) } } : {})
	};
}

// 有状态（持有 sessionId 与 follow 流），必须是单例：agentSession 每次操作都调
// bridge() 取实例，若每次新建，前一次 start 绑定的会话就丢给了下一个闭包
let cached: AcpBridge | undefined;

export function nativeSessionBridge(): AcpBridge | undefined {
	if (cached) return cached;
	const session = api();
	if (!session) return undefined;

	let sessionId: string | null = null;
	let cancelFollow: (() => void) | null = null;
	/** 本窗口自己发的 prompt requestId：follow 流里认出来跳过（本地已显示） */
	const ownRpcIds = new Set<string>();
	let emit: ((e: AcpEvent) => void) | null = null;
	/** prompt 的回复等待：assistant/message 到达即放行（agentSession.send 的状态机由此走完 working→ready） */
	let releasePrompt: (() => void) | null = null;
	/** 本轮流式输出已累计的文本长度：assistant/message 落地时用它扣掉已流式显示的部分 */
	let streamedLen = 0;

	function onFrame(frame: unknown): void {
		const f = frame as {
			type: string;
			header?: { id?: string };
			records?: WireEvent[];
			event?: WireEvent;
			frame?: { type: string; chunk?: { type?: string; text?: string } };
		};
		if (f.type === 'snapshot') {
			// 打开/回放一个会话：历史 records 依序翻译（openChat 的回放语境里 user 也显示；
			// 工具卡片同样回放，否则接续旧会话只剩文字、看不到 agent 做过什么）
			for (const record of f.records ?? []) {
				const tool = toolUpdate(record);
				if (tool) {
					emit?.({ type: 'update', update: tool as never });
					continue;
				}
				const update = toUpdate(record, ownRpcIds);
				if (update) emit?.({ type: 'update', update });
			}
			return;
		}
		if (f.type === 'assistant-stream' && f.frame) {
			// 逐 token 流：text-delta 增量推进面板的同一条 agent 消息；
			// reasoning（思考）块与 start/end 结构帧不进正文
			if (f.frame.type === 'chunk' && f.frame.chunk?.type === 'text-delta' && f.frame.chunk.text) {
				streamedLen += f.frame.chunk.text.length;
				emit?.({ type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: f.frame.chunk.text } } });
			}
			return;
		}
		if (f.type === 'event' && f.event) {
			// 一轮真正的结束：画布的活动条据此收起（assistant/message 在中间步骤就会到，不能用它判断）
			if (f.event.type === 'turn/end' || f.event.type === 'turn/error' || f.event.type === 'turn/aborted') {
				try {
					window.dispatchEvent(new CustomEvent('typwriter:agent-turn-end', { detail: { type: f.event.type, sessionId } }));
				} catch {
					/* ignore */
				}
			}
			// 工具调用：tool/call（挂起）→ tool/result（完成/失败），按 callId 配对成步骤卡片
			if (f.event.type === 'tool/call' || f.event.type === 'tool/result') {
				const tool = toolUpdate(f.event);
				if (tool) emit?.({ type: 'update', update: tool as never });
				return;
			}
			// 会话标题：DSH 在 follow 流里下发（session/list 不带）；记下供历史列表显示
			if (f.event.type === 'session/title' && sessionId) {
				const t = f.event['data'] as { title?: string } | null;
				if (typeof t?.title === 'string' && t.title) knownTitles.set(sessionId, t.title);
				return;
			}
			if (f.event.type === 'assistant/message') {
				// 整条落地：只补流式没送到的尾巴（流式期间断线或漏帧时兜底），不做二次全文
				const full = textOf(messageOf(f.event) ?? { content: [] });
				const tail = full.slice(streamedLen);
				streamedLen = 0;
				releasePrompt?.();
				if (tail) emit?.({ type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: tail } } });
				return;
			}
			const update = toUpdate(f.event, ownRpcIds);
			if (update) emit?.({ type: 'update', update });
		}
	}

	async function attach(id: string): Promise<void> {
		cancelFollow?.();
		cancelFollow = null;
		sessionId = id;
		streamedLen = 0;
		const root = (workspaceRoot.current ?? '').replace(/\\/g, '/');
		if (root) pinSession(root, id);
		// takesSelection：视觉/源码编辑器的划选以 pill 跟随消息（native 侧序列化进文本，见 prompt）
		emit?.({
			type: 'state',
			state: 'ready',
			title: 'DeepSeek Harness',
			chat: id,
			history: true,
			takesSelection: true,
			takesImages: false
		});
		cancelFollow =
			(await api()?.follow(id, {
				onFrame,
				onError: (e) => emit?.({ type: 'state', state: 'failed', detail: `会话流断开：${e.message}` })
			})) ?? null;
	}

	const bridge: AcpBridge = {
		detect: async () => ({ dsh: true }),
		async start(opts?: { fresh?: boolean }) {
			// 统一成正斜杠：workspaceRoot 给的是 Windows 反斜杠路径，而 DSH 的会话 cwd 幂等
			// 采纳按字面比对——斜杠方向不一致会被当成"别人的目录"拒绝（实测报 belongs to）
			const root = (workspaceRoot.current ?? '').replace(/\\/g, '/');
			if (!root) return { ok: false as const, reason: 'no-folder' as const };
			try {
				const mine = (await session.list()).filter((c) => (c.cwd ?? '').replace(/\\/g, '/').toLowerCase() === root.toLowerCase());
				// 目标会话三选一：
				//   fresh（「开新对话」）→ 全新空白会话（侧栏同步可见，不吞掉旧会话）
				//   粘住的（面板开合/整页刷新后）→ 原会话，绝不被"最新"挤掉
				//   首次进入 → 最新非空会话
				let target: string | undefined;
				if (!opts?.fresh && pinnedSessionId && mine.some((c) => c.sessionId === pinnedSessionId)) {
					target = pinnedSessionId;
				} else if (!opts?.fresh) {
					target = mine.filter((c) => !c.blank).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.sessionId;
				}
				const r = await session.create({ cwd: root, sessionId: target });
				await attach(r.sessionId);
				return { ok: true as const, agent: 'dsh' as const };
			} catch (e) {
				console.error('[typwriter] native start failed:', e);
				return { ok: false as const, reason: 'missing' as const, program: 'dsh' };
			}
		},
		async prompt(blocks) {
			if (!sessionId) return { ok: false as const, error: '会话未就绪', stopReason: 'error', changes: [] };
			// 网关这条链路只收文本：划选 pill（resource，file://…#Lfirst:last）序列化成文字随行，
			// 图片 v1 仍不带（models 未验证识图；deepseek-v4 支持后在 imageBlocks 处接）
			const words = blocks
				.filter((b) => (b as { type?: string }).type === 'text')
				.map((b) => (b as { text: string }).text)
				.join('\n\n');
			const picks = blocks
				.filter((b) => (b as { type?: string }).type === 'resource')
				.map((b) => (b as { resource: { uri?: string; text?: string } }).resource)
				.filter((r) => r && (r.uri || r.text))
				.map((r) => `[选中内容] ${r.uri ?? ''}\n<<<\n${r.text ?? ''}\n>>>`);
			const text = [words, ...picks].filter(Boolean).join('\n\n');
			// 首条消息生成可读标题（本地面板列表用这个；DSH 的 session/title 只在 follow 流里到）
			if (sessionId && text) {
				const title = readableChatTitle(text);
				if (!localTitles.has(sessionId)) setLocalTitle(sessionId, title);
				if (!knownTitles.has(sessionId)) knownTitles.set(sessionId, title);
			}
			const requestId = 'native-req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
			ownRpcIds.add(requestId);
			// 回复等待：assistant/message 或 3 分钟兜底（取消也放行）
			const done = new Promise<void>((resolve) => {
				const timer = setTimeout(() => resolve(), 180000);
				releasePrompt = () => {
					clearTimeout(timer);
					resolve();
				};
			});
			try {
				// 网关 RPC 自身也可能不回答（网关挂死/连接停滞）：180s 的 done 兜底在
				// await session.prompt 之后，够不着这一行——没有这层 race，发送按钮会永远转圈。
				// 比 done 的时钟略长：正常路径优先由 assistant/message 或 done 放行。
				const rpc: Promise<{ accepted: boolean }> = session.prompt(sessionId, text);
				rpc.catch(() => {}); // 超时后迟到的拒绝不产生未处理异常
				await Promise.race([
					rpc,
					new Promise<never>((_, reject) => {
						setTimeout(() => reject(new Error('网关超时未应答（3 分钟）')), 185000);
					})
				]);
				await done;
				// 轮次结束：会话的 updatedAt 变了，重发 ready 让面板刷新历史列表（时间/排序跟上）
				if (sessionId) {
					emit?.({ type: 'state', state: 'ready', title: 'DeepSeek Harness', chat: sessionId, history: true });
				}
				return { ok: true as const, stopReason: 'end_turn', changes: [] };
			} catch (e) {
				return { ok: false as const, error: String((e as Error).message || e), stopReason: 'error', changes: [] };
			} finally {
				releasePrompt = null;
			}
		},
		cancel() {
			if (sessionId) void session.cancel(sessionId);
			releasePrompt?.();
		},
		answer() {
			/* 原生会话的审批走 DSH 自己的会话 UI；面板暂不承接权限卡 */
		},
		async setConfig() {
			/* 原生会话没有 ACP config 表面 */
		},
		async chats(): Promise<ChatInfo[]> {
			const root = (workspaceRoot.current ?? '').replace(/\\/g, '/').toLowerCase();
			const list = await session.list();
			return (
				list
					// 只看当前项目；空白会话（建了没发消息）只在它是当前/粘住的会话时保留
					.filter((c) => (c.cwd ?? '').replace(/\\/g, '/').toLowerCase() === root)
					.filter((c) => !c.blank || c.sessionId === sessionId || c.sessionId === pinnedSessionId)
					.sort((a, b) => b.updatedAt - a.updatedAt)
					.map((c) => ({
						id: c.sessionId,
						// 标题优先级：本地面板起的可读标题 > DSH session/title > 无（UI 用 id 前 8 位兜底）
						title: localTitles.get(c.sessionId) ?? knownTitles.get(c.sessionId) ?? null,
						updatedAt: new Date(c.updatedAt).toISOString()
					}))
			);
		},
		async openChat(id) {
			try {
				await attach(id);
				return { ok: true };
			} catch (e) {
				return { ok: false, error: String((e as Error).message || e) };
			}
		},
		close() {
			// 会话本体保留在 DSH（侧栏继续可见可续聊）；这里只断开自己的事件流
			cancelFollow?.();
			cancelFollow = null;
			sessionId = null;
		},
		onEvent(cb) {
			emit = cb;
			return () => {
				if (emit === cb) emit = null;
			};
		}
	};
	cached = bridge;
	return bridge;
}
