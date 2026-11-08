export function median(values: number[]): number {
	return values.length ? values.slice().sort((x, y) => x - y)[Math.floor(values.length / 2)] : 0;
}
