// types shared by suggestion placement
import type { Mark, Node as PMNode } from 'prosemirror-model';
import type { SourceMap } from '../sourceSpans';

/** a run of the words a change took out: text with its marks, or a node standing as one character */
export type OldRun = { text: string; marks: readonly Mark[]; node?: PMNode };

/**
 * content taken out across block edges: the end of the block it started in, whole blocks, the start of
 * the one it ended in. `depth` is the level the blocks were taken from
 */
export type GoneContent = { head: OldRun[]; blocks: PMNode[]; tail: OldRun[]; depth: number };

export type PmSuggestionRange = {
	id: string;
	from: number;
	to: number;
	restore: string;
	mine: boolean;
	/** what stood at `from`, struck out there */
	old: OldRun[];
	/** the blocks the change is in, tinted whole: the map places it no closer */
	partial: boolean;
	/** the same words with other formatting: the tint says it all, nothing is struck */
	format?: boolean;
	/** a node that draws its own content, tinted whole */
	node?: boolean;
	/** the node it was, set beside the one it is now */
	was?: PMNode;
	/** what was taken out across block edges, drawn as a block of its own where it stood */
	gone?: GoneContent;
	/** a change that only moves a block boundary, and which way it went */
	brk?: 'added' | 'removed';
};

export type Span = { from: number; to: number };
export type Side = -1 | 1;

/** one mark's share of a change: a range of the document before and the one after */
export type Piece = { A: Span; B: Span };

/** the stretch as the editor shows it: its document, where its bytes are, and the top-level nodes the stretch's own stand for */
export type Shown = { doc: PMNode; map: SourceMap; at: number; tops: number[] };
