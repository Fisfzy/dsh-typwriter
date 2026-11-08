// What Refine offers for a selection, and what each one asks the agent to do
import type { Component } from 'svelte';
import { Briefcase, FileText, FoldVertical, List, PenLine, Sparkles, SpellCheck, UnfoldVertical, WandSparkles } from '@lucide/svelte';
import { m } from '$lib/paraglide/messages';

export type RefineAction = {
	id: string;
	label: () => string;
	icon: Component<{ class?: string }>;
	/** the task, in the agent's words; the rules every task shares are in refinePrompt */
	ask: string;
	/** how much of the text around the passage the agent sees, in characters before and after */
	context: [number, number];
};

const NEAR: [number, number] = [1500, 600];

export const REFINE_ACTIONS: RefineAction[] = [
	{
		id: 'style',
		label: m.ai_refine_style,
		icon: PenLine,
		ask: 'Rewrite the passage so it matches the writing style of the text around it.',
		context: [4000, 1500]
	},
	{
		id: 'rephrase',
		label: m.ai_refine_rephrase,
		icon: WandSparkles,
		ask: 'Rephrase the passage, keeping its meaning and roughly its length.',
		context: NEAR
	},
	{
		id: 'shorten',
		label: m.ai_refine_shorten,
		icon: FoldVertical,
		ask: 'Make the passage shorter without losing anything that matters.',
		context: NEAR
	},
	{
		id: 'elaborate',
		label: m.ai_refine_elaborate,
		icon: UnfoldVertical,
		ask: 'Expand the passage with more explanation, using only what the passage and the text around it already say.',
		context: NEAR
	},
	{
		id: 'formal',
		label: m.ai_refine_formal,
		icon: Briefcase,
		ask: 'Make the passage more formal, as fits a scholarly paper.',
		context: NEAR
	},
	{
		id: 'grammar',
		label: m.ai_refine_grammar,
		icon: SpellCheck,
		ask: 'Fix spelling, grammar and punctuation only, changing as few words as possible.',
		context: NEAR
	},
	{ id: 'bulletize', label: m.ai_refine_bulletize, icon: List, ask: 'Turn the passage into a bulleted list.', context: NEAR },
	{ id: 'summarize', label: m.ai_refine_summarize, icon: FileText, ask: 'Replace the passage with a short summary of it.', context: NEAR }
];

/** the reader's own instruction as an action; its words are also the note on the suggestion */
export function customRefineAction(instruction: string): RefineAction {
	return {
		id: 'custom',
		label: () => instruction,
		icon: Sparkles,
		ask: `Change the passage as the author asks: ${instruction}`,
		context: NEAR
	};
}
