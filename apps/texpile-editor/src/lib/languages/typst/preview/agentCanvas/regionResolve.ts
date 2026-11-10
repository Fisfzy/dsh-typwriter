// 画布圈选的角点解析收集器。
//
// 框选的两个角点经注入桥派发合成点击后，tinymist 的"点击→src-point→LSP 解析"链路会把结果
// 送进 previewController 的 jumpHandler。这里在 jumpHandler 最前面插一道：收集模式打开时，
// 解析结果归画布所有（并抑制"编辑器跳过去"的副作用）；没打开时一切照旧。

export type JumpCorner = {
	/** 绝对路径，tinymist 原样给出 */
	filepath: string;
	/** LSP 零基行 */
	line: number;
	/** LSP 零基列 */
	character: number;
};

type Waiting = {
	resolve: (corner: JumpCorner) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

let pending: Waiting | null = null;

/** 等待下一个跳转解析结果（画布角点）。超时拒绝，由调用方降级。 */
export function collectNextJump(timeoutMs = 4000): Promise<JumpCorner> {
	if (pending) pending.reject(new Error('上一个角点还没回来'));
	return new Promise<JumpCorner>((resolve, reject) => {
		const timer = setTimeout(() => {
			if (pending?.reject === rejectRef) {
				pending = null;
				reject(new Error('角点解析超时：预览页可能没响应这次点击'));
			}
		}, timeoutMs);
		const rejectRef = reject;
		pending = { resolve, reject, timer };
	});
}

/** jumpHandler 最先调用：收集模式打开时消费这个跳转并返回 true（调用方随即不再路由）。 */
export function consumeJump(jump: { filepath?: string; start?: [number, number] | null } | null): boolean {
	try {
		(globalThis as Record<string, unknown>).__lastPreviewJump = { jump, at: Date.now(), pending: !!pending };
	} catch {
		/* 调试埋点，失败不影响主流程 */
	}
	const waiting = pending;
	if (!waiting || !jump?.filepath || !jump.start) return false;
	clearTimeout(waiting.timer);
	pending = null;
	waiting.resolve({ filepath: jump.filepath, line: jump.start[0], character: jump.start[1] });
	return true;
}

/** 页面切换/面板关闭时清掉未决的收集，避免悬挂的 promise。 */
export function cancelPendingJumps(): void {
	if (pending) {
		clearTimeout(pending.timer);
		pending.reject(new Error('区域收集已取消'));
		pending = null;
	}
}
