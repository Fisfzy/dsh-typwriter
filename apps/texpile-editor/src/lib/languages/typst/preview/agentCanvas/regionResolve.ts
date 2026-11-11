// 画布圈选的角点收集：用户在预览上真实点击两个角（左上→右下），tinymist 的
// "点击→src-point→LSP 解析"链路给出每个角的源码位置，两个角夹出源码行范围。
//
// 为什么不用合成事件：loopback 跨源页里，派发的合成点击（isTrusted:false）不触发
// 查看器的点击处理（实测，同源旧页里是可以的）。所以收集模式开启时画布对指针
// 完全放行（pointer-events:none），点击直接落在预览上——用户点的就是真点击。

export type JumpCorner = {
	/** 绝对路径，tinymist 原样给出 */
	filepath: string;
	/** LSP 零基行 */
	line: number;
	/** LSP 零基列 */
	character: number;
};

type Collector = {
	corners: JumpCorner[];
	onDone: (a: JumpCorner, b: JumpCorner) => void;
	onProgress?: (collected: number) => void;
};

let collector: Collector | null = null;

// ---- 框选（web 同源页）的单角等待：合成角点点击的解析按先后武装/消费 ----
type Waiting = {
	resolve: (corner: JumpCorner) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};
let waiting: Waiting | null = null;

/**
 * 框选流程用：等待下一个跳转解析结果（一个合成角点）。超时拒绝。
 * 与角点收集互斥——框选期间不开启两次点击收集。
 */
export function collectNextJump(timeoutMs = 10000): Promise<JumpCorner> {
	if (collector) collector = null;
	if (waiting) waiting.reject(new Error('上一个角点还没回来'));
	return new Promise<JumpCorner>((resolve, reject) => {
		const timer = setTimeout(() => {
			if (waiting?.reject === rejectRef) {
				waiting = null;
				reject(new Error('角点解析超时：预览页没响应这次点击'));
			}
		}, timeoutMs);
		const rejectRef = reject;
		waiting = { resolve, reject, timer };
	});
}

/** 开启角点收集：接下来的两次真实预览点击依次作为区域的对角。 */
export function startCornerCollection(onDone: (a: JumpCorner, b: JumpCorner) => void, onProgress?: (collected: number) => void): void {
	cancelCornerCollection();
	collector = { corners: [], onDone, onProgress };
}

/** 关闭收集（用户取消/面板关闭）。 */
export function cancelCornerCollection(): void {
	collector = null;
}

/** 收集是否开启（jumpHandler 据此拦截点击解析，不再跳编辑器）。 */
export function collectingActive(): boolean {
	return collector !== null;
}

/** 已收集的角点数（状态条显示 1/2、2/2）。 */
export function collectedCount(): number {
	return collector ? collector.corners.length : 0;
}

/** jumpHandler 最先调用：收集开启时点击解析归画布（返回 true，调用方不再路由去跳编辑器）。 */
export function consumeJump(jump: { filepath?: string; start?: [number, number] | null } | null): boolean {
	if (!collector || !jump?.filepath || !jump.start) return false;
	collector.corners.push({ filepath: jump.filepath, line: jump.start[0], character: jump.start[1] });
	const n = collector.corners.length;
	collector.onProgress?.(n);
	if (n >= 2) {
		const [a, b] = collector.corners;
		const done = collector.onDone;
		collector = null;
		done(a, b);
	}
	return true;
}
