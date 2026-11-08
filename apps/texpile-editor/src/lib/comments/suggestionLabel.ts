// what a suggestion card calls the change, from what its record holds
import { m } from '$lib/paraglide/messages';
import { regionParserForPath } from './regionParser';
import { formatChange, suggestionKind } from './suggest';

const FORMAT_NAMES: Record<string, () => string> = {
	bold: m.menubar_format_bold,
	italic: m.menubar_format_italic,
	underline: m.menubar_format_underline,
	code: m.menubar_format_inline_code,
	superscript: m.tbar_superscript,
	subscript: m.tbar_subscript,
	strikethrough: m.mdtoolbar_strike,
	link: m.comments_suggest_format_link,
	color: m.tbar_text_color_aria,
	highlight: m.tbar_highlight_aria
};

export function suggestionLabel(file: string, quote: string, restore: string): string {
	const format = formatChange(quote, restore, regionParserForPath(file));
	if (format) {
		function named(names: string[]) {
			return names.map((name) => FORMAT_NAMES[name]?.() ?? name).join(', ');
		}
		const parts: string[] = [];
		if (format.added.length) parts.push(named(format.added));
		if (format.removed.length) parts.push(m.comments_suggest_format_removed({ names: named(format.removed) }));
		return parts.length ? m.comments_suggest_format({ names: parts.join(', ') }) : m.comments_suggest_format_label();
	}
	const kind = suggestionKind(quote, restore);
	if (kind === 'delete') return m.comments_suggest_delete_label();
	return kind === 'insert' ? m.comments_suggest_add_label() : m.comments_suggest_replace_label();
}
