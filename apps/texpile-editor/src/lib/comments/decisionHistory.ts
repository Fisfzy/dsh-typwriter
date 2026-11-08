// an Accept leaves the text as it was, so each editor keeps it in its own undo history as a step that changes nothing:
// replayed backwards it reopens the suggestion, forwards it accepts it again, in its place among the typing around it
export type DecisionStep = { seq: number; undone: boolean };

let listener: ((step: DecisionStep) => void) | null = null;

export function onDecisionStep(fn: (step: DecisionStep) => void): () => void {
	listener = fn;
	return () => {
		if (listener === fn) listener = null;
	};
}

/** an editor's undo or redo replayed the decision numbered `seq` */
export function decisionStepped(step: DecisionStep): void {
	listener?.(step);
}
