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

/**
 * Put an OKLCH triple in canonical range: L into [0,1], C non-negative, H wrapped
 * into [0,360). Says nothing about whether the result is displayable.
 */
export function normalize(o: Oklch): Oklch {
  const h = Number.isFinite(o.h) ? ((o.h % 360) + 360) % 360 : 0;
  return { l: clamp(o.l, 0, 1), c: Math.max(0, o.c), h };
}

/**
 * How far an sRGB channel may sit outside [0,1] and still count as displayable.
 *
 * Half a byte step. The point is that `toRgb255` clamps and rounds, so a channel
 * at -0.0008 and a channel at exactly 0 produce the same byte — they are the
 * same displayable color, and treating one of them as out of gamut is wrong.
 *
 * This is not pedantry. A hex color converted to OKLCH and back lands a hair
 * outside on any channel that was at 0 or 255, and a strict test then hands it
 * to the chroma clamp, which "fixes" a color that was already perfect by
 * desaturating it hard: #0000ff came back as #0031e5, a ΔE of 0.047. Saturated
 * primaries are exactly where brand colors live, so a strict test breaks the
 * one promise the engine makes about them.
 */
const GAMUT_EPSILON = 1 / 512;

/** Largest amount by which any sRGB channel falls outside [0,1]. 0 when inside. */
function srgbOvershoot(o: Oklch): number {
  const c = rgb({ mode: 'oklch', ...o });
  return Math.max(0, -c.r, -c.g, -c.b, c.r - 1, c.g - 1, c.b - 1);
}

/**
 * Is this OKLCH color displayable in sRGB?
 *
 * True when every channel is inside [0,1] to within half a byte — i.e. when the
 * color survives the trip to bytes unchanged.
 */
export function isInGamut(o: Oklch): boolean {
  return srgbOvershoot(normalize(o)) <= GAMUT_EPSILON;
}

/** Strict membership, with no tolerance. Exported for tests and diagnostics. */
export function isStrictlyInGamut(o: Oklch): boolean {
  return inSrgb({ mode: 'oklch', ...normalize(o) });
}

/**
 * Gamut-map into sRGB by reducing chroma (preserving L and H). Returns an
 * OKLCH color guaranteed to be displayable. This is culori's chroma-clamp,
 * the standard CSS Color 4 gamut-mapping approach for OKLCH.
 *
 * A color that is already displayable is returned untouched — never routed
 * through the clamp, which cannot be trusted to be a no-op at the boundary.
 */
export function gamutClamp(o: Oklch): Oklch {
  const n = normalize(o);
  if (isInGamut(n)) return n;
  const clamped = clampChroma({ mode: 'oklch', ...n }, 'oklch', 'rgb');
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
