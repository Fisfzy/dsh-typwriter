// apart from its client so launch can warm the worker without pulling the schemas into the boot chunk
let worker: Worker | null = null;

export function latexParserWorker(): Worker {
	return (worker ??= new Worker(new URL('./latexParser.worker.ts', import.meta.url), { type: 'module' }));
}

/** drop the worker (crash, runaway parse); the next call boots a fresh one */
export function resetLatexParserWorker(): void {
	worker?.terminate();
	worker = null;
}
