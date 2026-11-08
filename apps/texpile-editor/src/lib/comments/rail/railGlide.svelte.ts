// sliding the pane sideways to the margin cards and back
type RailGlideParts = {
	rail: HTMLElement | null;
	box: HTMLElement | null;
	inflow: number;
	showing: boolean;
};

function behavior(): ScrollBehavior {
	return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function slideCardsIntoView(el: HTMLElement, box: HTMLElement, afterJump: boolean): void {
	function whole() {
		const edge = box.getBoundingClientRect().left + box.clientWidth + 1;
		return [...el.querySelectorAll('.comment-card')].every((c) => c.getBoundingClientRect().right <= edge);
	}
	function go(again = 2) {
		if (whole()) return;
		const edge = box.getBoundingClientRect().left + box.clientWidth;
		const over = Math.max(...[...el.querySelectorAll('.comment-card')].map((c) => c.getBoundingClientRect().right - edge));
		box.scrollTo({ left: box.scrollLeft + over, behavior: behavior() });
		let last = box.scrollLeft;
		function stop() {
			box.removeEventListener('scroll', onScroll);
			clearTimeout(timer);
		}
		function onScroll() {
			const now = box.scrollLeft;
			if (whole() || now < last) return stop();
			if (now === last) {
				stop();
				if (again > 0) go(again - 1);
			}
			last = now;
		}
		const timer = setTimeout(() => {
			stop();
			if (again > 0 && !whole()) go(0);
		}, 900);
		box.addEventListener('scroll', onScroll);
	}
	if (afterJump) setTimeout(go, 120);
	else go();
}

export class RailGlide {
	leaving = $state(false);

	constructor(private readonly parts: () => RailGlideParts) {}

	reveal(afterJump = false): void {
		const { rail, box } = this.parts();
		if (rail && box) slideCardsIntoView(rail, box, afterJump);
	}

	retreat(): void {
		const { rail: el, box, inflow, showing } = this.parts();
		if (!el || !box || !showing) return;
		const rest = Math.max(
			0,
			el.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft + inflow - box.clientWidth
		);
		if (box.scrollLeft <= rest + 1) return;
		box.scrollTo({ left: rest, behavior: behavior() });
	}

	closeColumn(): void {
		const { box } = this.parts();
		if (!box || box.scrollLeft <= 0) return;
		this.leaving = true;
		const done = () => {
			box.removeEventListener('scrollend', done);
			this.leaving = false;
		};
		box.addEventListener('scrollend', done);
		box.scrollTo({ left: 0, behavior: behavior() });
	}
}
