/* eslint-disable @typescript-eslint/no-explicit-any */
/** `y` rounded to 0.1pt, which is what rows cluster on; `base` the engine's own baseline */
export type GlyphRow = { y: number; base: number; cs: number[]; xs: number[]; left: number };

export type PageRecord = any;
