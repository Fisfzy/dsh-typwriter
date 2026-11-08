import type { PageRecord } from '../geometry/geometry.types';

/** page records [from, to) move down by dy; a glue record there takes the width it was set to (w) and its new natural size */
export type RecordMove = { from: number; to: number; dy: number; w?: number; nw?: number; st?: number; sh?: number; gk?: number };

/** page records [from, to) leave, and `recs` (page coordinates, their own font records included) go in their place */
export type RecordSplice = { from: number; to: number; recs: PageRecord[] };

// A patch in the page's list order: an item that leaves takes its own records, an item that comes in brings
// its own, and every other item of the column moves by its own displacement, as the engine packed the edited
// column (or as nothing moved).
export type Patch = {
	/** in record order, none overlapping */
	splices: RecordSplice[];
	moves: RecordMove[];
	/** where the edited block now sits, for the focus band */
	band: { top: number; bottom: number; colL: number; colR: number };
	// the patch's CLAIM about the rows it moves without redrawing: verifyPatches grades it against the fresh
	// compile, which is the only place a render that put a row elsewhere shows
	flowPred?: { y: number; cs: number[] }[];
};

/** every record the patch brings in */
export function patchInk(p: Patch): PageRecord[] {
	return p.splices.flatMap((s) => s.recs);
}

export type PatchReq = {
	file: string;
	line: number;
	endLine?: number;
	text: string;
	orig: string;
	listItem?: boolean;
	transient?: boolean;
	floatInner?: boolean;
	/** the floated part is a tabular, not a caption (see PatchAction) */
	floatTabular?: boolean;
	// the edit changed the paragraph's SET of TeX commands: a command can carry
	// semantics invisible to glyph geometry, so the patch may render but never
	// claim exact -- the reconcile certifies (undetected drift beats no one)
	cmdChanged?: boolean;
	// interior-tier edit (text inside unchanged structure): renders, never adopts, always reconciles
	interiorEdit?: boolean;
	onRecompile?: () => void | Promise<void>;
	/** advance the patch baseline WITHOUT saving or compiling. Used when the patch produced the
	 *  page's new records itself: baseline and record store must move in the SAME tick, or the
	 *  next edit diffs its `orig` against a page that already shows the newer text. */
	onBaseline?: () => void;
	/** decide the edit again from the text as it is now. A request held behind another patch was
	 *  diffed against the baseline of its keystroke, which that patch may have moved on */
	redecide?: () => void;
};
