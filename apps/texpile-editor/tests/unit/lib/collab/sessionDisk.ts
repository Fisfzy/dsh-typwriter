// the host's disk in the session tests, shared between the harness and each test file's fs mocks
export const disk: Record<string, string> = {};

export function resetDisk(files: Record<string, string>): void {
	for (const k of Object.keys(disk)) delete disk[k];
	Object.assign(disk, files);
}
