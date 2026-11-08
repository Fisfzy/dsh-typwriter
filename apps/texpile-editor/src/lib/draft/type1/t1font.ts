/* eslint-disable @typescript-eslint/naming-convention -- Type 1 charstring convention: X/Y are the glyph's placement coordinates */
// Turns a real Type1 font (.pfb + .enc) into canvas glyph paths -- nothing else.
// Parsed with the vendored pdf.js Type1Parser; glyphs addressed by slot through the
// map-file .enc vector, so the ink is the REAL font's, at the engine's exact
// coordinates. Unknown/failed glyphs return null (absent, never wrong).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Type1Parser } from './type1_parser.js';
import { interpret } from './t1charstrings';
import { Stream } from './stream.js';
import { getEncoding, StandardEncoding } from './encodings.js';
import { getGlyphsUnicode } from './glyphlist.js';

export type Cmd = { type: 'M' | 'L' | 'C' | 'Z'; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };

// mirrors the opentype.js Path surface renderCore/DraftView use (commands, fill, draw, bbox)
export class T1Path {
	commands: Cmd[];
	fill = '#000';
	constructor(commands: Cmd[]) {
		this.commands = commands;
	}
	draw(ctx: CanvasRenderingContext2D) {
		ctx.beginPath();
		for (const c of this.commands) {
			if (c.type === 'M') ctx.moveTo(c.x!, c.y!);
			else if (c.type === 'L') ctx.lineTo(c.x!, c.y!);
			else if (c.type === 'C') ctx.bezierCurveTo(c.x1!, c.y1!, c.x2!, c.y2!, c.x!, c.y!);
			else ctx.closePath();
		}
		// eslint-disable-next-line no-param-reassign -- drawing sets the canvas context's state
		ctx.fillStyle = this.fill;
		ctx.fill();
	}
	getBoundingBox() {
		let x1 = Infinity,
			y1 = Infinity,
			x2 = -Infinity,
			y2 = -Infinity;
		for (const c of this.commands) {
			for (const k of ['x', 'x1', 'x2'] as const) {
				const v = c[k];
				if (v !== undefined) {
					if (v < x1) x1 = v;
					if (v > x2) x2 = v;
				}
			}
			for (const k of ['y', 'y1', 'y2'] as const) {
				const v = c[k];
				if (v !== undefined) {
					if (v < y1) y1 = v;
					if (v > y2) y2 = v;
				}
			}
		}
		if (x1 === Infinity) x1 = y1 = x2 = y2 = 0;
		return { x1, y1, x2, y2 };
	}
}

export type T1Font = {
	pathForSlot(slot: number, x: number, y: number, sizePx: number): T1Path | null;
	/** slot -> Unicode (AGL/uniXXXX), 0 = unknown; for word extraction, not ink */
	textMap: number[];
};

function pfbToProgram(bytes: Uint8Array): { header: Uint8Array; eexec: Uint8Array } | null {
	if (bytes[0] !== 0x80) return null; // PFA and bare formats: not handled, glyphs stay absent
	const ascii: Uint8Array[] = [];
	const binary: Uint8Array[] = [];
	for (let off = 0; off < bytes.length;) {
		if (bytes[off] !== 0x80) break;
		const type = bytes[off + 1];
		if (type === 3) break;
		const len = bytes[off + 2] | (bytes[off + 3] << 8) | (bytes[off + 4] << 16) | (bytes[off + 5] << 24);
		(type === 1 ? ascii : binary).push(bytes.subarray(off + 6, off + 6 + len));
		off += 6 + len;
	}
	if (!ascii.length || !binary.length) return null;
	function cat(parts: Uint8Array[]) {
		const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		let o = 0;
		for (const p of parts) {
			out.set(p, o);
			o += p.length;
		}
		return out;
	}
	return { header: cat([ascii[0]]), eexec: cat(binary) };
}

/** 256 glyph names from a dvips .enc vector (the same one the engine's map file names). */
export function parseEncVector(text: string): (string | null)[] | null {
	const body = text.replace(/%[^\n]*/g, '');
	const open = body.indexOf('[');
	const close = body.indexOf(']');
	if (open < 0 || close < 0) return null;
	const names = [...body.slice(open, close).matchAll(/\/([A-Za-z0-9._]+)/g)].map((m) => m[1]);
	if (names.length !== 256) return null;
	return names.map((n) => (n === '.notdef' ? null : n));
}

export function parseT1(pfb: Uint8Array, encText: string | null): T1Font | null {
	const prog = pfbToProgram(pfb);
	if (!prog) return null;
	let charstrings: any[];
	const properties: any = { type: 'Type1', widths: [], firstChar: 0 };
	try {
		new (Type1Parser as any)(new (Stream as any)(prog.header), false, true).extractFontHeader(properties);
		const program = new (Type1Parser as any)(new (Stream as any)(prog.eexec), true, true).extractFontProgram(properties);
		charstrings = program.charstrings;
	} catch {
		return null;
	}
	const glyphs = new Map<string, any>();
	for (const c of charstrings) glyphs.set(c.glyphName, c);

	// slot -> name: the map file's .enc vector, else the font's own encoding, else Standard
	let names: (string | null)[];
	const fromEnc = encText ? parseEncVector(encText) : null;
	if (fromEnc) names = fromEnc;
	else if (Array.isArray(properties.builtInEncoding)) names = properties.builtInEncoding;
	else names = (getEncoding as any)(properties.baseEncodingName) || StandardEncoding;

	const [ma, mb, mc, md, me, mf] = (properties.fontMatrix as number[] | undefined) ?? [0.001, 0, 0, 0.001, 0, 0];

	const agl = (getGlyphsUnicode as any)();
	const textMap = Array.from({ length: 256 }, (_, s) => {
		const nm = names[s];
		if (!nm) return 0;
		const u = agl[nm];
		if (u) return u;
		const m = /^uni([0-9A-Fa-f]{4,6})$|^u([0-9A-Fa-f]{4,6})$/.exec(nm);
		return m ? parseInt(m[1] || m[2], 16) : 0;
	});

	const compiled = new Map<string, Cmd[] | null>();
	function compile(nm: string): Cmd[] | null {
		if (compiled.has(nm)) return compiled.get(nm)!;
		const g = glyphs.get(nm);
		let out: Cmd[] | null = null;
		if (g) {
			out = interpret(g.charstring, glyphs, 0);
			// analyzed seac arrives as a property, not endchar args
			if (out && g.seac) {
				const [adx, ady, bchar, achar] = g.seac;
				const b = compile(StandardEncoding[bchar]);
				const a = compile(StandardEncoding[achar]);
				out =
					b && a
						? [
								...b,
								...a.map((c) => ({
									...c,
									...(c.x !== undefined && { x: c.x + adx }),
									...(c.x1 !== undefined && { x1: c.x1 + adx }),
									...(c.x2 !== undefined && { x2: c.x2 + adx }),
									...(c.y !== undefined && { y: c.y + ady }),
									...(c.y1 !== undefined && { y1: c.y1 + ady }),
									...(c.y2 !== undefined && { y2: c.y2 + ady })
								}))
							]
						: null;
			}
		}
		compiled.set(nm, out);
		return out;
	}

	return {
		textMap,
		pathForSlot(slot: number, X: number, Y: number, sizePx: number): T1Path | null {
			const nm = names[slot & 0xff];
			if (!nm) return null;
			const src = compile(nm);
			if (!src || !src.length) return null;
			function tx(gx: number, gy: number) {
				return X + (ma * gx + mc * gy + me) * sizePx;
			}
			function ty(gx: number, gy: number) {
				return Y - (mb * gx + md * gy + mf) * sizePx;
			}
			const out: Cmd[] = new Array(src.length);
			for (let i = 0; i < src.length; i++) {
				const c = src[i];
				if (c.type === 'Z') out[i] = { type: 'Z' };
				else if (c.type === 'C')
					out[i] = {
						type: 'C',
						x1: tx(c.x1!, c.y1!),
						y1: ty(c.x1!, c.y1!),
						x2: tx(c.x2!, c.y2!),
						y2: ty(c.x2!, c.y2!),
						x: tx(c.x!, c.y!),
						y: ty(c.x!, c.y!)
					};
				else out[i] = { type: c.type, x: tx(c.x!, c.y!), y: ty(c.x!, c.y!) };
			}
			return new T1Path(out);
		}
	};
}
