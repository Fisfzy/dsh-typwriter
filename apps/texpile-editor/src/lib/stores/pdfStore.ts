import { box } from '$lib/runes/box.svelte';

// raw PDF bytes (ArrayBuffer) or a direct URL string; null when unset
export const pdfStore = box<ArrayBuffer | string | null>(null);
