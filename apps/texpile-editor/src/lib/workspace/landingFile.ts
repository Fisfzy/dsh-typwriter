// Which file a folder opens on when nothing was open there before: the chosen main file, else the
// detected one, else the first of the scan. Opening on the alphabetically first .tex landed some
// projects on a generated 2 MB appendix instead of main.tex.
import { detectMainFile } from './project';
import { MAX_MAIN_CANDIDATES } from './mainCandidates';
import { samePath, type TexFile } from './fileSystem';
import { savedMainFile } from './workspaceStore';

export async function landingFile(root: string, files: TexFile[], read?: (path: string) => Promise<string>): Promise<string | null> {
	if (files.length === 0) return null;
	const main = savedMainFile(root);
	const chosen = main ? files.find((f) => samePath(f.path, main)) : undefined;
	if (chosen) return chosen.path;
	if (files.length > MAX_MAIN_CANDIDATES) return files[0].path;
	return (await detectMainFile(files, read)) ?? files[0].path;
}
