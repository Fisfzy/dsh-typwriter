// the multi-line halves of a diagnostic: engine error blocks (help text + l.NN context)
// and \MessageBreak warning continuations. each returns a patch for the entry under construction.

import type { LogScanner } from './scanner';
import type { LogEntry } from '$lib/compileLog/types';

// -file-line-error mode replaces "! " with "<file>:<line>: ". TeX Live prints resolved paths
// ("./main.tex", "/abs/x.tex", "c:/..."); MikTeX can print a bare "file.tex:12:", so a second
// form accepts an extensioned bare name (the extension requirement keeps prose "note: 1: ..."
// out).
export const FILE_LINE_ERROR = /^((?:[A-Za-z]:\/|\/|\.{1,2}\/)[^:]*|[^:\s()\\{}]+\.[\w-]+):(\d+): (.*)$/;

const ON_INPUT_LINE = / on input line (\d+)\.?\s*$/;

// engine error context: "l.<n> <text>"
const CONTEXT_LINE = /^l\.(\d+)( .*|$)/;

// "Runaway argument?" preludes a following "! ..." error
export const RUNAWAY = /^Runaway (argument|definition|text|preamble)\?/;

// \MessageBreak continuations: "(<name>)" + spaces for Package/Class, deep indent for kernel warnings
function isWarningContinuation(line: string, moduleName?: string): boolean {
	if (moduleName && line.startsWith(`(${moduleName})`)) return true;
	return /^ {3,}\S/.test(line);
}

/** consume an engine error block: help/context lines up to the l.NN pair or a blank line. */
export function collectErrorBlock(scanner: LogScanner, entry: Readonly<LogEntry>): Partial<LogEntry> {
	const patch: Partial<LogEntry> = {};
	const contextLines: string[] = [];
	let sawContext = false;
	for (let guard = 0; guard < 60; guard++) {
		const line = scanner.next();
		if (line === null) break;
		if (line.startsWith('!') || FILE_LINE_ERROR.test(line) || RUNAWAY.test(line)) {
			scanner.rewind(); // next diagnostic begins; errors need not be blank-separated
			break;
		}
		const ctx = line.match(CONTEXT_LINE);
		if (ctx) {
			if (entry.line == null) patch.line ??= parseInt(ctx[1], 10);
			// the l.NN line prints the source up to the error point: its length is the column,
			// and its tail re-anchors the range if the buffer drifted since the compile
			const preText = ctx[2].startsWith(' ') ? ctx[2].slice(1) : ctx[2];
			if (preText.length > 0 && entry.column === undefined && patch.column === undefined) {
				patch.column = preText.length + 1;
				const anchor = preText.slice(-24).trimStart();
				if (anchor.length >= 2) patch.anchorText = anchor;
			}
			sawContext = true;
			contextLines.push(line);
			// the engine prints one more line: the text after the error point
			const after = scanner.next();
			if (after !== null) {
				if (after.trim().length > 0) contextLines.push(after);
				else scanner.rewind();
			}
			continue;
		}
		if (line.trim().length === 0) {
			if (sawContext) break; // blank after the l.NN pair ends the block
			if (contextLines.length > 0 && contextLines[contextLines.length - 1].trim() === '') break; // two blanks with no context in sight: give up
			contextLines.push('');
			continue;
		}
		contextLines.push(line);
	}
	const context = contextLines.join('\n').replace(/\n+$/, '');
	if (context.length > 0) patch.context = context;
	patch.raw = [entry.raw, context].filter(Boolean).join('\n');
	return patch;
}

/** consume \MessageBreak continuation lines and fold them into one message. */
export function collectWarningContinuation(scanner: LogScanner, entry: Readonly<LogEntry>, moduleName?: string): Partial<LogEntry> {
	const patch: Partial<LogEntry> = {};
	const parts: string[] = [];
	let raw = entry.raw;
	for (let guard = 0; guard < 20; guard++) {
		const line = scanner.next();
		if (line === null) break;
		if (!isWarningContinuation(line, moduleName)) {
			scanner.rewind();
			break;
		}
		let text = line;
		if (moduleName && text.startsWith(`(${moduleName})`)) text = text.slice(moduleName.length + 2);
		parts.push(text.trim());
		raw += '\n' + line;
	}
	let message = entry.message;
	if (parts.length > 0) {
		message = [message, ...parts].join(' ').replace(/\s+/g, ' ').trim();
	}
	const online = message.match(ON_INPUT_LINE);
	if (online) {
		patch.line = parseInt(online[1], 10);
		// the row already shows ":<line>", so drop the redundant phrase from the text
		message = message.replace(ON_INPUT_LINE, '.').replace(/([.!?])\.$/, '$1');
	}
	patch.raw = raw;
	patch.message = message;
	return patch;
}
