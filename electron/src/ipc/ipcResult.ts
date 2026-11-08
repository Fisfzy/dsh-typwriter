// failures come back as { ok: false, error } instead of rejecting: a rejected handler makes
// Electron dump a stack trace to the main-process console, and some failures here are routine
import { ipcMain } from 'electron';

export type FsResult = { ok: true; value: unknown } | { ok: false; error: string };

export function handleFs(channel: string, fn: (...args: never[]) => Promise<unknown>): void {
	ipcMain.handle(channel, async (_e, ...args: unknown[]): Promise<FsResult> => {
		try {
			return { ok: true, value: await (fn as (...a: unknown[]) => Promise<unknown>)(...args) };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	});
}

/** like handleFs, for handlers that need the sender (dialog parenting, draft-engine ownership) */
export function handleFsE(channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: never[]) => Promise<unknown>): void {
	ipcMain.handle(channel, async (e, ...args: unknown[]): Promise<FsResult> => {
		try {
			return { ok: true, value: await (fn as (e: Electron.IpcMainInvokeEvent, ...a: unknown[]) => Promise<unknown>)(e, ...args) };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	});
}
