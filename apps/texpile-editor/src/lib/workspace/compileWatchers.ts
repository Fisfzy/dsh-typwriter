// The compile's settle pollers. The engine rewrites its outputs during each pass, so both
// watch for 'newer than the baseline AND unchanged across two polls' before acting, and both
// stand down when their generation is superseded or three minutes pass.
type WatcherHooks = {
	/** false once a newer compile, finalize, or folder switch superseded this run */
	isCurrent(gen: number): boolean;
	stat(path: string): Promise<{ exists: boolean; mtimeMs: number; size: number }>;
	showCompiledPdf(path: string, mtimeMs: number): void;
	publishLog(logPath: string, mtimeMs: number): Promise<void>;
	/** Typst: a zero-byte log means a clean compile, not an engine that never ran */
	logMayBeEmpty(): boolean;
	endRun(): void;
};

export class CompileWatchers {
	private pdfTimer: ReturnType<typeof setTimeout> | null = null;
	private logTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly hooks: WatcherHooks) {}

	dispose(): void {
		if (this.pdfTimer) clearTimeout(this.pdfTimer);
		if (this.logTimer) clearTimeout(this.logTimer);
	}

	// poll the expected PDF after a compile (no-completion-marker fallback); load it once it has
	// stopped changing, so a mid-write partial or an intermediate latexmk pass isn't shown. `stableAt`
	// is the mtime seen on the previous poll; a match means the file settled.
	watchPdf(gen: number, pdfPath: string, before: number, elapsed = 0, stableAt = 0) {
		if (this.pdfTimer) clearTimeout(this.pdfTimer);
		this.pdfTimer = setTimeout(
			async () => {
				if (!this.hooks.isCurrent(gen)) return; // superseded: a newer compile, finalize, or folder switch
				const s = await this.hooks.stat(pdfPath);
				if (s.exists && s.size > 0 && s.mtimeMs > before) {
					if (s.mtimeMs === stableAt) {
						this.hooks.showCompiledPdf(pdfPath, s.mtimeMs); // unchanged since the last poll: it's done
						this.pdfTimer = null;
						this.hooks.endRun();
					} else {
						this.watchPdf(gen, pdfPath, before, elapsed + 600, s.mtimeMs); // still changing: re-check soon
					}
				} else if (elapsed < 180000) {
					this.watchPdf(gen, pdfPath, before, elapsed + 1200); // keep polling up to 3 min
				} else {
					this.pdfTimer = null;
					this.hooks.endRun();
				}
			},
			stableAt ? 600 : 1200 // poll faster once the file has started changing, to catch it settling
		);
	}

	// poll the .log and parse once it settles: the engine rewrites the log during each pass, so
	// "newer than baseline AND unchanged across two polls" re-parses after each pass and also
	// catches failed builds, where no PDF ever appears but the log does.
	//
	// Settling is a HEURISTIC, and it must not end a sentinel-tracked run: any engine pause longer
	// than the two polls (biber grinding between passes, MiKTeX installing a package on the fly)
	// makes the log look settled mid-run, and dropping `busy` there hands an MCP poller pass-1
	// diagnostics as final while latexmk is still going. When `tracked`, publishing stays (live
	// Problems updates per pass) but the end belongs to finalizeCompile's shell-exit signal alone.
	watchLog(
		gen: number,
		logPath: string,
		before: number,
		tracked = false,
		elapsed = 0,
		prev: { mtimeMs: number; size: number } | null = null,
		lastParsed = 0
	) {
		let parsedAt = lastParsed;
		if (this.logTimer) clearTimeout(this.logTimer);
		this.logTimer = setTimeout(async () => {
			if (!this.hooks.isCurrent(gen)) return; // superseded: a newer compile, finalize, or folder switch
			const s = await this.hooks.stat(logPath);
			const changedSinceCompile = s.exists && (s.size > 0 || this.hooks.logMayBeEmpty()) && s.mtimeMs > before;
			const stable = prev !== null && s.mtimeMs === prev.mtimeMs && s.size === prev.size;
			if (changedSinceCompile && stable && s.mtimeMs !== parsedAt) {
				try {
					await this.hooks.publishLog(logPath, s.mtimeMs);
					// a settled log is only "the run ended" when nothing better is coming; tracked runs
					// end on the shell's exit signal, and this settle may just be a between-pass pause
					if (!tracked) this.hooks.endRun();
					parsedAt = s.mtimeMs;
				} catch {
					/* transient read race with the engine; next poll retries */
				}
			}
			if (elapsed < 180000) {
				this.watchLog(gen, logPath, before, tracked, elapsed + 1200, { mtimeMs: s.mtimeMs, size: s.size }, parsedAt);
			} else {
				this.logTimer = null;
				this.hooks.endRun();
			}
		}, 1200);
	}
}
