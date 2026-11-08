// A guest's local-only folders. The host's manifest has no entry for an empty directory (the
// git model), so a folder a guest creates is nothing but a remembered name until a shared file
// lands inside it - at which point the manifest carries it and the ghost is dropped.
export class GhostDirs {
	private ghosts = new Set<string>();

	constructor(private readonly onChange: () => void) {}

	list(): string[] {
		return [...this.ghosts];
	}

	add(rel: string): void {
		if (!rel) return;
		this.ghosts.add(rel);
		this.onChange();
	}

	/** true when rel was a ghost; deleting a ghost parent takes its ghost children with it */
	drop(rel: string): boolean {
		const hit = this.ghosts.delete(rel);
		for (const g of this.ghosts) if (g.startsWith(rel + '/')) this.ghosts.delete(g);
		if (hit) this.onChange();
		return hit;
	}

	/** true when rel was a ghost and got renamed locally */
	rename(from: string, to: string): boolean {
		if (!this.ghosts.delete(from)) return false;
		this.ghosts.add(to);
		for (const g of [...this.ghosts]) {
			if (g.startsWith(from + '/')) {
				this.ghosts.delete(g);
				this.ghosts.add(to + g.slice(from.length));
			}
		}
		this.onChange();
		return true;
	}

	clear(): void {
		this.ghosts.clear();
	}

	/** a ghost becomes real once a shared file lands inside it */
	prune(files: { rel: string }[]): void {
		for (const g of this.ghosts) if (files.some((f) => f.rel.startsWith(g + '/'))) this.ghosts.delete(g);
	}
}
