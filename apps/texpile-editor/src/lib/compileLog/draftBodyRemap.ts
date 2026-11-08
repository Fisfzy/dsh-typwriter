// Live mode compiles the body from _draft/texd-body.tex, padded so its line numbers are the main
// file's (draftWarmCompile.paddedBody). The log names that file; the Problems panel and
// click-to-jump want the file the user is editing.
const DRAFT_BODY = /(?:^|[\\/])_draft[\\/]texd-body\.tex$/i;

export function remapDraftBodyFile(entries: { file?: string }[], mainRel: string): void {
	for (const e of entries) if (e.file && DRAFT_BODY.test(e.file.trim())) e.file = mainRel;
}
