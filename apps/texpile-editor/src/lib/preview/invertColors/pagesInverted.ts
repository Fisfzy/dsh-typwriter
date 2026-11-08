import { resolvedMode } from '$lib/theme';
import { layout, updateLayout } from '$lib/storage/layout';

export function pagesInverted(): boolean {
	return resolvedMode.current === 'dark' ? layout.current.pdfDarkPages : layout.current.pdfDarkPagesInLight;
}

export function togglePagesInverted(): void {
	const on = !pagesInverted();
	updateLayout(resolvedMode.current === 'dark' ? { pdfDarkPages: on } : { pdfDarkPagesInLight: on });
}
