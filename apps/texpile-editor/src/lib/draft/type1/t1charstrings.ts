/* eslint-disable @typescript-eslint/no-explicit-any -- mirrors the vendored pdf.js parser's untyped glyph records */
// the Type 1 charstring interpreter: one converted charstring to absolute font-unit commands
import { StandardEncoding } from './encodings.js';
import type { Cmd } from './t1font';

// interpret one converted charstring into absolute font-unit commands (see the vendored
// parser's COMMAND_MAP for the op set; loop shapes mirror pdf.js font_renderer.js)
export function interpret(code: number[] | Uint8Array, glyphs: Map<string, any>, depth: number): Cmd[] | null {
	const cmds: Cmd[] = [];
	const st: number[] = [];
	let x = 0,
		y = 0,
		open = false;
	function moveTo(nx: number, ny: number) {
		if (open) cmds.push({ type: 'Z' });
		cmds.push({ type: 'M', x: nx, y: ny });
		open = true;
	}
	function lineTo(nx: number, ny: number) {
		return cmds.push({ type: 'L', x: nx, y: ny });
	}
	function curveTo(xa: number, ya: number, xb: number, yb: number, nx: number, ny: number) {
		return cmds.push({ type: 'C', x1: xa, y1: ya, x2: xb, y2: yb, x: nx, y: ny });
	}
	let i = 0;
	const n = code.length;
	while (i < n) {
		let v = code[i++];
		if (v >= 32) {
			if (v <= 246) st.push(v - 139);
			else if (v <= 250) st.push((v - 247) * 256 + code[i++] + 108);
			else if (v <= 254) st.push(-(v - 251) * 256 - code[i++] - 108);
			else {
				st.push(((code[i] << 24) | (code[i + 1] << 16) | (code[i + 2] << 8) | code[i + 3] | 0) / 65536);
				i += 4;
			}
			continue;
		}
		if (v === 28) {
			st.push(((code[i] << 24) | (code[i + 1] << 16)) >> 16);
			i += 2;
			continue;
		}
		if (v === 12) v = (12 << 8) + code[i++];
		let xa: number, ya: number, xb: number, yb: number;
		switch (v) {
			case 1:
			case 3:
				st.length = 0;
				break;
			case 4:
				y += st.pop()!;
				moveTo(x, y);
				st.length = 0;
				break;
			case 21:
				y += st.pop()!;
				x += st.pop()!;
				moveTo(x, y);
				st.length = 0;
				break;
			case 22:
				x += st.pop()!;
				moveTo(x, y);
				st.length = 0;
				break;
			case 5:
				while (st.length >= 2) {
					x += st.shift()!;
					y += st.shift()!;
					lineTo(x, y);
				}
				st.length = 0;
				break;
			case 6:
			case 7: {
				let horiz = v === 6;
				while (st.length) {
					if (horiz) x += st.shift()!;
					else y += st.shift()!;
					lineTo(x, y);
					horiz = !horiz;
				}
				break;
			}
			case 8:
				while (st.length >= 6) {
					xa = x + st.shift()!;
					ya = y + st.shift()!;
					xb = xa + st.shift()!;
					yb = ya + st.shift()!;
					x = xb + st.shift()!;
					y = yb + st.shift()!;
					curveTo(xa, ya, xb, yb, x, y);
				}
				st.length = 0;
				break;
			case 30:
			case 31: {
				let horiz = v === 31;
				while (st.length > 0) {
					if (horiz) {
						xa = x + st.shift()!;
						ya = y;
						xb = xa + st.shift()!;
						yb = ya + st.shift()!;
						y = yb + st.shift()!;
						x = xb + (st.length === 1 ? st.shift()! : 0);
					} else {
						xa = x;
						ya = y + st.shift()!;
						xb = xa + st.shift()!;
						yb = ya + st.shift()!;
						x = xb + st.shift()!;
						y = yb + (st.length === 1 ? st.shift()! : 0);
					}
					curveTo(xa, ya, xb, yb, x, y);
					horiz = !horiz;
				}
				break;
			}
			case (12 << 8) + 35: // flex: two curves, then drop fd
				for (let k = 0; k < 2; k++) {
					xa = x + st.shift()!;
					ya = y + st.shift()!;
					xb = xa + st.shift()!;
					yb = ya + st.shift()!;
					x = xb + st.shift()!;
					y = yb + st.shift()!;
					curveTo(xa, ya, xb, yb, x, y);
				}
				st.length = 0;
				break;
			case (12 << 8) + 18: // drop
				st.pop();
				break;
			case 14: {
				// endchar with 4 args = un-analyzed seac composite (base + accent)
				if (st.length >= 4 && depth < 2) {
					const achar = st.pop()!;
					const bchar = st.pop()!;
					const ady = st.pop()!;
					const adx = st.pop()!;
					const base = glyphs.get(StandardEncoding[bchar]);
					const accent = glyphs.get(StandardEncoding[achar]);
					if (!base || !accent) return null;
					const b = interpret(base.charstring, glyphs, depth + 1);
					const a = interpret(accent.charstring, glyphs, depth + 1);
					if (!b || !a) return null;
					cmds.push(...b);
					for (const c of a)
						cmds.push({
							...c,
							...(c.x !== undefined && { x: c.x + adx }),
							...(c.x1 !== undefined && { x1: c.x1 + adx }),
							...(c.x2 !== undefined && { x2: c.x2 + adx }),
							...(c.y !== undefined && { y: c.y + ady }),
							...(c.y1 !== undefined && { y1: c.y1 + ady }),
							...(c.y2 !== undefined && { y2: c.y2 + ady })
						});
				}
				if (open) cmds.push({ type: 'Z' });
				return cmds;
			}
			default:
				return null; // unknown op (callsubr leftovers etc): absent beats wrong ink
		}
	}
	if (open) cmds.push({ type: 'Z' });
	return cmds;
}
