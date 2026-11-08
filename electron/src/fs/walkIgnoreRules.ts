// '_draft' holds Draft-mode's transient compile artifacts (page records, daemon wrapper,
// draft.pdf) -- never surface them in the tree, scan, or search.
// Two tiers of ignoring, plus dot-dirs (.git, .cache, ...) skipped everywhere via skipDir:
// - TREE stays permissive: it IS the workspace view, and a LaTeX project legitimately
//   contains dirs named build/ or output/ (the compile output dir, see the renderer's
//   ensureOutputDir) -- hiding output/ would break finding the compiled PDF in the tree.
// - scan and search are noise-sensitive, so they also skip common build-output names.
export const TREE_IGNORE_DIRS = new Set(['node_modules', '_draft']);
export const SCAN_IGNORE_DIRS = new Set([...TREE_IGNORE_DIRS, 'build', 'dist', 'out', 'output']);

export function skipDir(name: string, ignore: Set<string>): boolean {
	return name.startsWith('.') || ignore.has(name);
}
