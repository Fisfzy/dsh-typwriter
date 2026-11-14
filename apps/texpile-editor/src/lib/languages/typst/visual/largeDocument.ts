import type { Node as PMNode } from 'prosemirror-model';

// Typst 版的"大文档"判定，接 content-visibility（document.css 的 .TexpileEditor-large）：
// 视口外的块跳过 style/layout/hit-testing，列宽变化（面板开合、侧栏、窗口缩放）的全量
// 重排从 O(全文档) 降到 O(视口)。
//
// 阈值与 LaTeX 侧（latex/visual/largeDocument.ts 的 150_000）不同源，原因有二：
// ① 公式密度——Typst 论文每个公式经 MathLive 静态标记展开成数百 DOM 节点，一篇 48 KB
//    的章节（296 个公式）就是 35k DOM 节点、面板开合一帧 1.9 s（实测 chapter02）；
// ② 中文口径——PM 的 nodeSize 近似**字符数**，而中文一字 UTF-8 三字节，48 KB 的文件
//    只有 ~2.8 万字符，按 LaTeX 的字节口径永远够不到保护线。
// 20_000 字符 ≈ 60 KB 的中文文件或一篇公式密集的章节（chapter02 的 2.8 万字符实测触发）。
export const TYPST_LARGE_DOC_NODE_SIZE = 20_000;

export function isTypstLargeDocument(doc: PMNode): boolean {
	return doc.nodeSize > TYPST_LARGE_DOC_NODE_SIZE;
}
