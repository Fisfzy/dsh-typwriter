// Typst file-path references for the move-aware reference updater: the .typ counterpart of
// languages/latex/parser/filerefs. Collected from the real syntax tree (our typst-syntax wasm build), so
// a path inside a comment or a raw block is never touched - those produce no Str node at all.
//
// Only paths written as literals at the call site can be found. `#let p = "a.png"` followed by
// `#image(p)` is invisible here, the same way \input{\mypath} is invisible to the LaTeX side.
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { typstLanguage } from './source/typstLanguage';
import type { FileRef } from '$lib/workspace/fileRefs';

/** functions whose FIRST string argument is a path. `read`/`csv`/`json`/... are typst's data
 *  loaders; all of them take the path first, so no per-function argument index is needed. */
const PATH_FUNCS = new Set(['image', 'bibliography', 'read', 'csv', 'json', 'yaml', 'xml', 'toml', 'cbor']);

/** the inner span of a Str node, i.e. what sits between the quotes */
function inner(node: SyntaxNode): FileRef | null {
	// Str spans the quotes; anything shorter than two chars is a parse artefact
	if (node.to - node.from < 2) return null;
	return { innerStart: node.from + 1, innerEnd: node.to - 1, current: '' };
}

/** Every path literal in `src`: module include/import targets and path-taking function calls. */
export function collectTypstFileRefs(src: string): FileRef[] {
	const tree = syntaxTree(EditorState.create({ doc: src, extensions: [typstLanguage()] }));
	const out: FileRef[] = [];

	tree.cursor().iterate((n) => {
		if (n.name === 'ModuleInclude' || n.name === 'ModuleImport') {
			// `#include "ch/one.typ"` / `#import "lib/util.typ": *` - the Str is a direct child
			for (let c = n.node.firstChild; c; c = c.nextSibling) {
				if (c.name !== 'Str') continue;
				const ref = inner(c);
				if (ref) out.push({ ...ref, current: src.slice(ref.innerStart, ref.innerEnd) });
				break; // the path is the first string; an import's alias list is not one
			}
			return;
		}
		if (n.name !== 'FuncCall') return;
		const ident = n.node.firstChild;
		if (!ident || ident.name !== 'Ident' || !PATH_FUNCS.has(src.slice(ident.from, ident.to))) return;
		const args = n.node.getChild('Args');
		if (!args) return;
		// first positional string only: a later string is a caption or a format option
		for (let c = args.firstChild; c; c = c.nextSibling) {
			if (c.name !== 'Str') continue;
			const ref = inner(c);
			if (ref) out.push({ ...ref, current: src.slice(ref.innerStart, ref.innerEnd) });
			break;
		}
	});

	// iterate() is pre-order, but a nested call (#figure(image("x.png"))) can still land out of
	// order relative to its parent; the splice needs them sorted
	return out.sort((a, b) => a.innerStart - b.innerStart);
}
