// 圈选范围内源码的"内容特征"：让用户在发送前看到 agent 到底会改什么。
// 纯文本 + 轻量 Typst 语法判断（不做完整解析）：标题层级/自动编号、正文（归属哪节）、
// 图/表/图注、公式、代码块、列表。读不到源码时调用方退回只显示行号。
export type RangeDescription = {
	/** 如 "二级标题 1.1「结果」+ 正文" / "正文（1.1 结果 下）" / "表格" */
	title: string;
	/** 首行 / 末行源码片段（去标记，截断） */
	firstLine: string;
	lastLine: string;
};

const HEADING = /^(=+)[ \t]+(.*)$/;
const LIST = /^[-+][ \t]+/;
const RAW_FENCE = /^\s*(```|~~~)/;

type LineKind = 'heading' | 'body' | 'figure' | 'caption' | 'math' | 'raw' | 'list' | 'blank';

type LineInfo = {
	kind: LineKind;
	level?: number;
	number?: string;
	headingText?: string;
	raw: string;
};

const LEVEL_NAMES = ['一级', '二级', '三级', '四级', '五级', '六级'];

function stripMarkup(s: string): string {
	return s
		.replace(/<[^>]*>/g, '')
		.replace(/[*_`]/g, '')
		.replace(/\$([^$]*)\$/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
}

function clip(s: string, n = 42): string {
	const t = s.trim();
	return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 是否启用标题自动编号（#set heading(numbering: "...")，none 视为关闭） */
function headingNumbered(text: string): boolean {
	const set = /#set\s+heading\s*\(([^)]*)\)/g;
	let m: RegExpExecArray | null;
	let seen = false;
	while ((m = set.exec(text))) {
		const args = m[1] ?? '';
		const numbering = /numbering\s*:\s*([^,)]+)/.exec(args);
		if (numbering) {
			seen = true;
			const value = numbering[1].trim();
			if (/^none$/i.test(value)) return false;
		}
	}
	return seen;
}

/** 逐行分类，并在遇到标题时维护编号计数器（与 Typst 默认的逐级计数一致） */
function classifyLines(lines: string[], numbered: boolean): LineInfo[] {
	const counters = [0, 0, 0, 0, 0, 0];
	const out: LineInfo[] = [];
	let inRaw = false;
	let mathOpen = false;
	let figureDepth = 0;
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? '';
		const trimmed = raw.trim();
		if (inRaw) {
			if (RAW_FENCE.test(raw)) inRaw = false;
			out.push({ kind: 'raw', raw });
			continue;
		}
		if (RAW_FENCE.test(raw)) {
			inRaw = true;
			out.push({ kind: 'raw', raw });
			continue;
		}
		// 公式：$ 不计转义；跨行块按出现次数切换
		const dollars = (raw.match(/(?<!\\)\$/g) ?? []).length;
		const wasMath = mathOpen;
		if (dollars % 2 === 1) mathOpen = !mathOpen;
		// 图表块：#figure( ... ) 按括号深度；只做行级近似（不要在本行重复计入开头括号）
		const wasInFigure = figureDepth > 0;
		figureDepth += (raw.match(/\(/g) ?? []).length - (raw.match(/\)/g) ?? []).length;
		if (figureDepth < 0) figureDepth = 0;
		const inFigure = wasInFigure || /#figure\s*\(/.test(raw) || figureDepth > 0;
		const heading = HEADING.exec(trimmed);
		if (heading) {
			const level = Math.min(6, heading[1].length);
			counters[level - 1] += 1;
			for (let k = level; k < counters.length; k++) counters[k] = 0;
			const number = numbered ? counters.slice(0, level).join('.') : undefined;
			out.push({ kind: 'heading', level, number, headingText: stripMarkup(heading[2]), raw });
			continue;
		}
		if (trimmed === '') {
			out.push({ kind: 'blank', raw });
		} else if (wasMath || mathOpen || trimmed.startsWith('$')) {
			out.push({ kind: 'math', raw });
		} else if (inFigure) {
			out.push({ kind: /caption\s*:/.test(raw) ? 'caption' : 'figure', raw });
		} else if (LIST.test(trimmed)) {
			out.push({ kind: 'list', raw });
		} else if (/caption\s*:/.test(raw)) {
			out.push({ kind: 'caption', raw });
		} else {
			out.push({ kind: 'body', raw });
		}
	}
	return out;
}

function headingLabel(level: number): string {
	return (LEVEL_NAMES[level - 1] ?? '标题') + '标题';
}

/** 描述 [fromLine, toLine]（1 基，含两端）范围内的内容特征 */
export function describeRange(text: string, fromLine: number, toLine: number): RangeDescription {
	const all = text.split('\n');
	const from = Math.max(1, Math.min(fromLine, all.length));
	const to = Math.max(from, Math.min(toLine, all.length));
	const numbered = headingNumbered(text);
	const infos = classifyLines(all, numbered);
	const slice = infos.slice(from - 1, to);
	const nonBlank = slice.filter((x) => x.kind !== 'blank');

	if (!nonBlank.length) return { title: '空白行', firstLine: '', lastLine: '' };

	// 范围里最近的标题（可能多个：通常只算第一个）
	const headingInRange = nonBlank.find((x) => x.kind === 'heading');
	// 范围之前最近的标题，用于正文归属
	let contextHeading: LineInfo | undefined;
	for (let i = from - 2; i >= 0; i--) {
		const x = infos[i];
		if (x && x.kind === 'heading') {
			contextHeading = x;
			break;
		}
	}

	const counts = new Map<LineKind, number>();
	for (const x of nonBlank) counts.set(x.kind, (counts.get(x.kind) ?? 0) + 1);
	const onlyKinds = [...counts.keys()];

	function labelFor(kind: LineKind, line?: LineInfo): string {
		switch (kind) {
			case 'heading':
				if (!line) return '标题';
				return `${headingLabel(line.level ?? 1)}${line.number ? ` ${line.number}` : ''}「${clip(line.headingText ?? '', 24)}」`;
			case 'figure': {
				const figText = nonBlank.map((x) => x.raw).join('\n');
				if (/table\s*\(/.test(figText)) return '表格';
				if (/#figure[\s\S]*caption\s*:/.test(figText)) return '图/表';
				return '图表块';
			}
			case 'caption':
				return '图注';
			case 'math':
				return '公式';
			case 'raw':
				return '代码块';
			case 'list':
				return '列表项';
			case 'body':
				return '正文';
			default:
				return '内容';
		}
	}

	let title: string;
	if (headingInRange) {
		title = labelFor('heading', headingInRange);
		const others = onlyKinds.filter((k) => k !== 'heading' && k !== 'blank');
		if (others.length) {
			const bodyCount = counts.get('body') ?? 0;
			if (bodyCount > 0) title += ' + 正文';
			else title += ' + ' + labelFor(others[0]);
		}
	} else if (onlyKinds.every((k) => k === 'figure' || k === 'caption')) {
		if ((counts.get('figure') ?? 0) === 0) {
			title = '图注';
		} else {
			const figText = nonBlank.map((x) => x.raw).join('\n');
			title = /table\s*\(/.test(figText) ? '表格' : '图/表';
		}
	} else if (onlyKinds.length === 1) {
		if (onlyKinds[0] === 'body') {
			const ctx = contextHeading
				? `${contextHeading.number ? contextHeading.number + ' ' : ''}${clip(contextHeading.headingText ?? '', 16)}`
				: '';
			title = ctx ? `正文（${ctx} 下）` : '正文';
		} else {
			title = labelFor(onlyKinds[0], nonBlank[0]);
		}
	} else {
		// 混合类型：主类型 + 其他
		const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
		title = labelFor(sorted[0][0], nonBlank[0]);
		const rest = sorted.slice(1).map(([k]) => labelFor(k));
		if (rest.length) title += ' + ' + rest.slice(0, 2).join('/');
	}

	function snippetOf(line: LineInfo): string {
		if (RAW_FENCE.test(line.raw)) return '';
		if (line.kind === 'caption') {
			const caption = /caption\s*:\s*\[([^\]]*)\]/.exec(line.raw)?.[1];
			if (caption) return clip(stripMarkup(caption), 42);
		}
		const raw = line.raw.trim();
		if (line.kind === 'figure' && (/^#figure\s*\(/.test(raw) || /^[)\s]*$/.test(raw))) return '';
		const body = (HEADING.exec(raw)?.[2] ?? line.raw).replace(/^[-+]\s+/, '');
		return clip(stripMarkup(body), 42);
	}
	const snippetLines = nonBlank.map(snippetOf).filter(Boolean);
	const firstSnippet = snippetLines[0] ?? '';
	const lastSnippet = snippetLines.length > 1 ? snippetLines[snippetLines.length - 1] : '';
	return {
		title,
		firstLine: firstSnippet,
		lastLine: lastSnippet
	};
}
