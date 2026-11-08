// The selection toolbar in the source editor: the shared row of buttons, floating above the selection
import { type EditorView, ViewPlugin } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { settings } from '$lib/settings';
import { observe } from '$lib/runes/observe.svelte';
import { selectionToolbarRow, type SelectionToolbarRow } from '$lib/editor/selectionToolbarRow';
import { visibleBox } from '../visibleBox';

/** the row fades in rather than flashing under the pointer for every drag it passes through */
const SHOW_DELAY = 120;
const HEIGHT = 26;

/**
 * The row for a non-empty selection, floating ABOVE it, exactly as the visual editor places it.
 *
 * It used to sit in the left margin, right edge flush against the text, which is what Overleaf's
 * editor-floating-menu does. That put it on top of the line numbers: CodeMirror's gutter paints at
 * z-index 200, so the numbers showed through the row, and a click that missed one of the small
 * buttons landed on the gutter instead and selected that line, throwing away the selection the row
 * was offering to comment on.
 *
 * Measuring has to go through requestMeasure. coordsAtPos reads DOM layout, and CodeMirror forbids
 * that inside update() - it throws "Reading the editor layout isn't allowed during an update" and
 * disables the plugin, which is why calling it directly meant the row never appeared at all. The
 * read phase runs once the update has settled; write is where the style goes.
 */
export function cmSelectionToolbar(onAdd: (from: number, to: number) => void, label: string): Extension {
	return ViewPlugin.fromClass(
		class {
			private readonly row: SelectionToolbarRow;
			private timer: ReturnType<typeof setTimeout> | null = null;
			private shown = false;
			private added: { from: number; to: number } | null = null;
			private readonly resize: ResizeObserver;
			private readonly unsub: () => void;

			constructor(private readonly view: EditorView) {
				this.row = selectionToolbarRow(
					label,
					() => {
						const sel = view.state.selection.main;
						if (sel.empty) return;
						this.added = { from: sel.from, to: sel.to };
						onAdd(sel.from, sel.to);
						this.hide();
					},
					() => this.hide()
				);
				view.dom.appendChild(this.row.dom);
				// scrolling moves the line without changing the viewport, so update() alone would
				// leave the row behind; the observer catches pane and window resizes, which move
				// the text without any editor update at all
				view.scrollDOM.addEventListener('scroll', this.schedule);
				this.resize = new ResizeObserver(this.schedule);
				this.resize.observe(view.scrollDOM);
				// the toggle has to bite without waiting for the next selection change, both ways
				this.unsub = observe(
					() => settings.current,
					() => this.schedule()
				);
				this.schedule();
			}

			update() {
				this.schedule();
			}

			destroy() {
				this.view.scrollDOM.removeEventListener('scroll', this.schedule);
				this.resize.disconnect();
				this.unsub();
				if (this.timer) clearTimeout(this.timer);
				this.row.dom.remove();
			}

			private schedule = () => {
				this.view.requestMeasure<{ top: number; cx: number; width: number; left: number; right: number } | null>({
					key: 'cm-comment-add',
					read: (view) => {
						const sel = view.state.selection.main;
						// turned off in Preferences: the row never appears
						if (settings.current.commentPill === false || sel.empty) return null;
						if (this.added && this.added.from === sel.from && this.added.to === sel.to) return null;
						const a = view.coordsAtPos(sel.from);
						const b = view.coordsAtPos(sel.to);
						if (!a || !b) return null;
						const head = sel.head === sel.from ? a : b;
						const oneLine = Math.abs(a.top - b.top) < 2;
						const cx = oneLine ? (a.left + b.right) / 2 : (head.left + head.right) / 2;
						const anchor = oneLine ? a : head;
						// the PANE, not the window: the row is fixed, so nothing clips it, and a selection
						// scrolled out of the pane would otherwise park the row over the sidebar
						const pane = visibleBox(view.contentDOM);
						if (head.bottom < pane.top || head.top > pane.bottom || cx < pane.left || cx > pane.right) return null;
						return {
							// above the line, else below it when the selection starts at the top of the pane
							top: anchor.top - HEIGHT - 6 >= pane.top + 4 ? anchor.top - HEIGHT - 6 : anchor.bottom + 6,
							cx,
							// 0 while the row is hidden, which is the one frame write has to measure for itself
							width: this.row.dom.getBoundingClientRect().width,
							left: pane.left,
							right: pane.right
						};
					},
					// written straight to the DOM: this runs on every scroll frame, and routing it
					// through state would re-render the whole plugin each time
					write: (box) => {
						if (!box) {
							this.hide();
							return;
						}
						this.row.sync();
						this.row.dom.style.display = 'flex';
						const half = (box.width || this.row.dom.offsetWidth || 48) / 2;
						this.row.dom.style.top = `${box.top}px`;
						this.row.dom.style.left = `${Math.min(Math.max(box.cx - half, box.left + 4), box.right - half * 2 - 4)}px`;
						if (!this.shown && !this.timer) {
							this.timer = setTimeout(() => {
								this.timer = null;
								this.shown = true;
								this.row.dom.classList.add('cm-comment-add-visible');
							}, SHOW_DELAY);
						}
					}
				});
			};

			private hide() {
				if (this.timer) {
					clearTimeout(this.timer);
					this.timer = null;
				}
				this.shown = false;
				this.row.dom.classList.remove('cm-comment-add-visible');
				this.row.dom.style.display = 'none';
			}
		}
	);
}
