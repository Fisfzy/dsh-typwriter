// the thread whose drawing is under the pointer: its tint, its struck words, its break bar
export function threadAtPointer(target: EventTarget | null): string | null {
	return (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-comment]')?.dataset.comment ?? null;
}
