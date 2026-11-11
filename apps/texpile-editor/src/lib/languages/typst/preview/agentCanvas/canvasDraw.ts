// 圈选画布的纯绘图函数：无状态，画布内容的全部像素输出都在这里。

export type Pt = { x: number; y: number };
export type Stroke = { kind: 'pen'; pts: Pt[] } | { kind: 'arrow'; from: Pt; to: Pt } | { kind: 'text'; at: Pt; text: string };
export type RegionRect = { x: number; y: number; w: number; h: number };

/** 单笔画/文字标注 */
export function drawStroke(g: CanvasRenderingContext2D, s: Stroke): void {
	// 别名以通过 no-param-reassign（绘图就是要在 ctx 上设置属性）
	const ctx = g;
	ctx.strokeStyle = 'rgba(99,102,241,0.9)';
	ctx.fillStyle = 'rgba(99,102,241,0.9)';
	ctx.lineWidth = 2;
	if (s.kind === 'pen') {
		ctx.beginPath();
		for (let i = 0; i < s.pts.length; i++) {
			const p = s.pts[i];
			if (i === 0) ctx.moveTo(p.x, p.y);
			else ctx.lineTo(p.x, p.y);
		}
		ctx.stroke();
	} else if (s.kind === 'arrow') {
		ctx.beginPath();
		ctx.moveTo(s.from.x, s.from.y);
		ctx.lineTo(s.to.x, s.to.y);
		ctx.stroke();
		const ang = Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x);
		ctx.beginPath();
		ctx.moveTo(s.to.x, s.to.y);
		ctx.lineTo(s.to.x - 10 * Math.cos(ang - 0.45), s.to.y - 10 * Math.sin(ang - 0.45));
		ctx.lineTo(s.to.x - 10 * Math.cos(ang + 0.45), s.to.y - 10 * Math.sin(ang + 0.45));
		ctx.closePath();
		ctx.fill();
	} else if (s.kind === 'text') {
		ctx.font = '13px ui-sans-serif, sans-serif';
		ctx.fillText(s.text, s.at.x, s.at.y);
	}
}

/** 活跃圈选区域：虚线框 + 两个角点标记（角点会被解析成源码位置） */
export function drawRegionBox(g: CanvasRenderingContext2D, r: RegionRect): void {
	const ctx = g;
	ctx.strokeStyle = '#6366f1';
	ctx.lineWidth = 1.5;
	ctx.setLineDash([6, 4]);
	ctx.strokeRect(r.x, r.y, r.w, r.h);
	ctx.setLineDash([]);
	ctx.fillStyle = '#6366f1';
	for (const [cx, cy] of [
		[r.x, r.y],
		[r.x + r.w, r.y + r.h]
	]) {
		ctx.fillRect(cx - 3, cy - 3, 6, 6);
	}
}

export function normRect(a: Pt, b: Pt): RegionRect {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		w: Math.abs(b.x - a.x),
		h: Math.abs(b.y - a.y)
	};
}
