// the package a LaTeX symbol needs
import { kernelDefines } from '$lib/languages/latex/knowledge/commands/kernelCommands';
import type { LatexSymbol } from './latexSymbol.types';

/** the line that loads what `symbol` needs, or null when the kernel has it */
export function usepackageFor(symbol: Pick<LatexSymbol, 'command' | 'package' | 'fontenc'>): string | null {
	if (symbol.fontenc) return `\\usepackage[${symbol.fontenc}]{fontenc}`;
	if (symbol.package && !kernelDefines(symbol.command)) return `\\usepackage{${symbol.package}}`;
	return null;
}
