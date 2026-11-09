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

/** 一条 durable 事件 → 面板的 ACP update；不认识的返回 null（session/title、request/* 等杂项静默跳过） */
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
			// 打开/回放一个会话：历史 records 依序翻译（openChat 的回放语境里 user 也显示）
			for (const record of f.records ?? []) {
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
			// 工具调用：tool/call（挂起）→ tool/result（完成/失败），按 callId 配对成步骤卡片
			if (f.event.type === 'tool/call' || f.event.type === 'tool/result') {
				const d = f.event['data'] as {
					callId?: string;
					name?: string;
					message?: { content?: Array<{ type?: string; text?: string }> };
				} | null;
				const callId = d?.callId;
				if (!callId) return;
				if (f.event.type === 'tool/call') {
					emit?.({
						type: 'update',
						update: {
							sessionUpdate: 'tool_call',
							toolCallId: callId,
							title: d?.name ?? '工具调用',
							kind: 'other',
							status: 'in_progress'
						}
					});
				} else {
					const outText = (d?.message?.content ?? [])
						.filter((p2) => p2?.type === 'text')
						.map((p2) => p2.text ?? '')
						.join('');
					emit?.({
						type: 'update',
						update: {
							sessionUpdate: 'tool_call_update',
							toolCallId: callId,
							status: 'completed',
							...(outText ? { content: { type: 'text', text: outText.slice(0, 400) } } : {})
						}
					});
				}
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
		emit?.({ type: 'state', state: 'ready', title: 'DeepSeek Harness', chat: id, history: true });
		cancelFollow =
			(await api()?.follow(id, {
				onFrame,
				onError: (e) => emit?.({ type: 'state', state: 'failed', detail: `会话流断开：${e.message}` })
			})) ?? null;
	}

	const bridge: AcpBridge = {
		detect: async () => ({ dsh: true }),
		async start() {
			// 统一成正斜杠：workspaceRoot 给的是 Windows 反斜杠路径，而 DSH 的会话 cwd 幂等
			// 采纳按字面比对——斜杠方向不一致会被当成"别人的目录"拒绝（实测报 belongs to）
			const root = (workspaceRoot.current ?? '').replace(/\\/g, '/');
			if (!root) return { ok: false as const, reason: 'no-folder' as const };
			try {
				// 工作目录绑定：同目录已有会话就幂等续上（create 语义支持显式 sessionId 采纳），
				// 没有才新建——Typwriter 与 DSH 侧栏因此操作的是同一个会话
				const mine = (await session.list()).filter(
					(c) => (c.cwd ?? '').replace(/\\/g, '/').toLowerCase() === root.toLowerCase() && !c.blank
				);
				const adopt = mine.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.sessionId;
				const r = await session.create({ cwd: root, sessionId: adopt });
				await attach(r.sessionId);
				return { ok: true as const, agent: 'dsh' as const };
			} catch (e) {
				console.error('[typwriter] native start failed:', e);
				return { ok: false as const, reason: 'missing' as const, program: 'dsh' };
			}
		},
		async prompt(blocks) {
			if (!sessionId) return { ok: false as const, error: '会话未就绪', stopReason: 'error', changes: [] };
			const text = blocks
				.filter((b) => (b as { type?: string }).type === 'text')
				.map((b) => (b as { text: string }).text)
				.join('\n\n');
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
				await session.prompt(sessionId, text);
				await done;
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
			const root = workspaceRoot.current;
			return (await session.list())
				.filter((c) => (c.cwd ?? '').replace(/\\/g, '/').toLowerCase() === (root ?? '').replace(/\\/g, '/').toLowerCase())
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.map((c) => ({ id: c.sessionId, title: null, updatedAt: new Date(c.updatedAt).toISOString() }));
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
