import { typstSyntax } from './core/reading/typstCall';

// what makes pasted text Typst rather than plain words: "issue #12", "1. one" and "a * b * c" stay words
function marksTypst(name: string, from: number, to: number, text: string): boolean {
	// 数学也是 Typst 源码：`$F_a (z)$` 应该粘成公式节点，而不是字面美元符号
	if (name === 'Equation') return true;
	if (name === 'Heading' || name === 'ListItem' || name === 'TermItem') return true;
	if (name === 'EnumItem') return text[from] === '+';
	if (name === 'Hash') return /[\p{L}_]/u.test(text[to] ?? '');
	if (name === 'Strong' || name === 'Emph') return /[^\s*_]/.test(text[from + 1] ?? ' ');
	return name === 'Raw' && text.startsWith('```', from);
}

export function hasTypstMarkup(text: string): boolean {
	let found = false;
	typstSyntax(text)
		.toTree()
		.iterate({
			enter: (n) => {
				if (found) return false;
				found = marksTypst(n.name, n.from, n.to, text);
			}
		});
	return found;
}
