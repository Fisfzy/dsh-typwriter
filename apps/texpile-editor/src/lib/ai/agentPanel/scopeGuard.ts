// 圈选轮次的越界检测：比较轮次前后文本，返回"是否改到了允许行范围之外"。
// 纯函数、无依赖，便于单测；调用方（agentCanvasTurn）拿到结果后提示并允许一键回退。
export type ScopeViolation = {
	/** 旧文本中实际被改动的行范围（1 基，含两端；纯插入时 oldStart > oldEnd） */
	oldStart: number;
	oldEnd: number;
	/** 新文本中实际被改动的行范围（1 基，含两端） */
	newStart: number;
	newEnd: number;
};

/** 行级公共前后缀 → 改动块；null 表示文本没变 */
export function changedBlock(before: string, after: string): ScopeViolation | null {
	if (before === after) return null;
	const a = before.split('\n');
	const b = after.split('\n');
	let p = 0;
	while (p < a.length && p < b.length && a[p] === b[p]) p++;
	// 注意：前后缀不能重叠，否则纯插入会被算成等长替换
	let s = 0;
	while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
	return {
		oldStart: p + 1,
		oldEnd: a.length - s,
		newStart: p + 1,
		newEnd: b.length - s
	};
}

/** 改动是否全部落在 [fromLine, toLine]（1 基，含两端）之内；返回 null 表示没有越界 */
export function outOfRange(before: string, after: string, fromLine: number, toLine: number): ScopeViolation | null {
	const block = changedBlock(before, after);
	if (!block) return null;
	const from = Math.max(1, fromLine);
	const to = Math.max(from, toLine);
	let inside: boolean;
	if (block.oldStart <= block.oldEnd) {
		// 有旧行被替换/删除：被动的旧行必须都在范围内
		inside = block.oldStart >= from && block.oldEnd <= to;
	} else {
		// 纯插入：插入点应该在允许范围之内（允许紧贴范围末尾一行）
		inside = block.newStart >= from && block.newStart <= to + 1;
	}
	return inside ? null : block;
}
