// a wheel: every click is a push, friction slows it, and it comes to rest upright
export class LogoSpin {
	angle = $state(0);
	private velocity = 0;
	private frame = 0;
	private last = 0;

	kick = () => {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		this.velocity = Math.min(this.velocity + 600, 4000);
		if (!this.frame) {
			this.last = performance.now();
			this.frame = requestAnimationFrame(this.tick);
		}
	};

	private tick = (now: number) => {
		const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
		this.last = now;
		this.angle += this.velocity * dt;
		this.velocity *= Math.exp(-2.2 * dt);
		if (this.velocity > 60) {
			this.frame = requestAnimationFrame(this.tick);
			return;
		}
		const rest = Math.ceil(this.angle / 360) * 360;
		const left = rest - this.angle;
		if (left < 0.3) {
			this.angle = 0;
			this.velocity = 0;
			this.frame = 0;
			return;
		}
		this.angle += Math.min(left, Math.max(left * 6 * dt, 40 * dt));
		this.frame = requestAnimationFrame(this.tick);
	};
}
