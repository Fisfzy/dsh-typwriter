// Import this DIRECTLY, never through the image barrel: the barrel pulls in svelte and the DOM,
// and the serializer runs in a worker.

/**
 * How wide an editor-created figure is when nothing has set a width. The serializer writes it and
 * the settings panel reads it back, so the slider cannot claim 100% over a `0.5\textwidth` line.
 */
export const DEFAULT_FIGURE_FRACTION = 0.5;

/** what a dragged figure snaps to, as a fraction of \textwidth */
export const FIGURE_SIZE_STEP = 0.1;
