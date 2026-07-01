/**
 * OKLCH core: the engine's internal color representation.
 *
 * Everything upstream (curves, families, locks) reasons in OKLCH, where the
 * three axes are perceptually meaningful and independent:
 *   L  lightness   0..1   (drives contrast)
 *   C  chroma      0..~0.37 (colorfulness; gamut-limited)
 *   H  hue         0..360  (the "tone" dial: cold / green / red ...)
 *
 * OKLCH can describe colors outside the sRGB gamut, so every value that leaves
 * the engine is gamut-mapped first: chroma is reduced until the color is
 * displayable, preserving L and H (the perceptually load-bearing axes).
 */
import { oklch as toOklch, rgb, clampChroma, inGamut, formatHex } from 'culori';

export interface Oklch {
  /** Lightness, 0..1 */
  l: number;
  /** Chroma, 0..~0.37 */
  c: number;
  /** Hue in degrees, 0..360 (undefined/NaN hue is normalized to 0 for achromatic) */
  h: number;
}

const inSrgb = inGamut('rgb');

/** Parse any CSS color string (hex, rgb(), oklch(), named, ...) into OKLCH. */
export function parse(input: string | Oklch): Oklch {
  if (typeof input !== 'string') return normalize(input);
  const o = toOklch(input);
  if (!o) throw new Error(`gosfuig: cannot parse color "${input}"`);
  return normalize({ l: o.l, c: o.c, h: o.h ?? 0 });
}

function normalize(o: Oklch): Oklch {
  const h = Number.isFinite(o.h) ? ((o.h % 360) + 360) % 360 : 0;
  return { l: clamp(o.l, 0, 1), c: Math.max(0, o.c), h };
}

/** Is this OKLCH color displayable in sRGB without clipping? */
export function isInGamut(o: Oklch): boolean {
  return inSrgb({ mode: 'oklch', ...o });
}

/**
 * Gamut-map into sRGB by reducing chroma (preserving L and H). Returns an
 * OKLCH color guaranteed to be displayable. This is culori's chroma-clamp,
 * the standard CSS Color 4 gamut-mapping approach for OKLCH.
 */
export function gamutClamp(o: Oklch): Oklch {
  const clamped = clampChroma({ mode: 'oklch', ...normalize(o) }, 'oklch', 'rgb');
  return { l: clamped.l, c: clamped.c, h: clamped.h ?? 0 };
}

/** OKLCH -> #rrggbb, gamut-mapped. */
export function toHex(o: Oklch): string {
  return formatHex({ mode: 'oklch', ...gamutClamp(o) })!.toLowerCase();
}

/** OKLCH -> sRGB byte triple [0..255], gamut-mapped. Used by APCA. */
export function toRgb255(o: Oklch): [number, number, number] {
  const c = rgb({ mode: 'oklch', ...gamutClamp(o) });
  return [r255(c.r), r255(c.g), r255(c.b)];
}

/** OKLCH -> CSS `oklch(L% C H)` string (not gamut-mapped; faithful to the spec value). */
export function toCss(o: Oklch, precision = 4): string {
  const n = normalize(o);
  const L = round(n.l * 100, 2);
  const C = round(n.c, precision);
  const H = round(n.h, 2);
  return `oklch(${L}% ${C} ${H})`;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r255 = (x: number) => Math.round(clamp(x, 0, 1) * 255);
const round = (x: number, p: number) => {
  const f = 10 ** p;
  return Math.round(x * f) / f;
};
