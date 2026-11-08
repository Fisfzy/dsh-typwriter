// 文件树拖来的路径：FileTree 的 dragstart 写了两种类型——application/x-texpile-paths（JSON
// 数组，窗口内拖拽）和 text/plain（换行连接，跨窗口）。这里读出绝对路径，过滤掉像话的不是路径的文本。
const PATHS_MIME = 'application/x-texpile-paths';

const looksAbsolute = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\');

/** 拖拽事件里的文件/文件夹绝对路径；不是路径拖拽（如纯文本、图片文件走 Files）返回 null */
export function droppedPaths(e: DragEvent): string[] | null {
	const dt = e.dataTransfer;
	if (!dt) return null;
	let raw = dt.getData(PATHS_MIME);
	if (!raw && dt.types.includes('text/plain')) raw = dt.getData('text/plain');
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			const paths = parsed.filter((p): p is string => typeof p === 'string' && looksAbsolute(p));
			return paths.length ? paths : null;
		}
	} catch {
		/* 跨窗口的 text/plain：按行拆 */
	}
	const lines = raw
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter(looksAbsolute);
	return lines.length ? lines : null;
}
