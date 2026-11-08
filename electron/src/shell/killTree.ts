// ends a process and everything it spawned
import { execFile } from 'node:child_process';

/** on macOS and Linux the process must lead its own group: an interactive shell's job, or a detached spawn */
export function killTree(pid: number): void {
	if (process.platform === 'win32') {
		execFile('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, () => {});
		return;
	}
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {
			/* already gone */
		}
	}
}
