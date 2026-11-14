// 空输入时的预设快捷指令（参考 llm-for-zotero 的 Summarize/Key Points 行）：点击填入，可改再发
export const PRESET_PROMPTS: { label: string; prompt: string }[] = [
	{ label: '总结当前文件', prompt: '请总结当前打开文件的主要内容与结构。' },
	{ label: '润色选中文本', prompt: '请润色我选中的文本：保持学术语气，改动最小化，并说明每处改动的原因。' },
	{ label: '检查语法', prompt: '请检查当前文件的语法与格式错误，逐条给出位置和修改建议。' },
	{ label: '改进表达', prompt: '请找出当前文件中表达不够清晰或学术性不足的段落并改写。' }
];
