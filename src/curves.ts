/**
 * Curves: pure functions of t in [0,1] (t=0 lightest step, t=1 darkest).
 *
 * The whole family is described by three of these — lightness, chroma, hue —
 * plus locks. Keeping them as plain (t) => number functions means a designer
 * can drop in any easing they like; the builders below cover the common cases.
 */
export type Curve = (t: number) => number;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Constant value across the whole ramp (e.g. a fixed hue). */
export const constant = (v: number): Curve => () => v;

/** Linear interpolation from `from` (t=0) to `to` (t=1). */
export const linear = (from: number, to: number): Curve => (t) => from + (to - from) * clamp01(t);

/**
 * Hue torsion: a linear hue sweep from `start` (t=0, lightest) to `end` (t=1,
 * darkest), in degrees. Values may run past 360 / below 0 — the engine
 * normalizes hue when it builds each swatch, so an increasing ramp reads as a
 * continuous rotation. Cool highlights / warm shadows are the classic use.
 */
export const hueRamp = (start: number, end: number): Curve => linear(start, end);

/**
 * Gamma-biased ramp from `from` (t=0) to `to` (t=1).
 *  gamma = 1  -> linear (perceptually even in OKLCH L)
 *  gamma > 1  -> steps bunch toward the `from` end (finer light shades)
 *  gamma < 1  -> steps bunch toward the `to` end (finer dark shades)
 */
export const gamma = (from: number, to: number, g = 1): Curve => (t) =>
  from + (to - from) * Math.pow(clamp01(t), g);

/**
 * Chroma bump: low at both ends, peaking at `tPeak`. Light tints and dark
 * shades cannot hold much chroma in sRGB, so tapering there is both tasteful
 * and gamut-friendly. Smooth (cosine) rise and fall on each side of the peak.
 */
export function bump(opts: {
  /** Maximum chroma, reached at tPeak. */
  peak: number;
  /** Where the peak sits on the ramp, default 0.6 (mid-dark). */
  tPeak?: number;
  /** Chroma floor at the light end (t=0). */
  light?: number;
  /** Chroma floor at the dark end (t=1). */
  dark?: number;
}): Curve {
  const { peak, tPeak = 0.6, light = 0.02, dark = 0.05 } = opts;
  const tp = clamp01(tPeak);
  return (t) => {
    const x = clamp01(t);
    if (x <= tp) {
      const u = tp === 0 ? 1 : x / tp; // 0..1 rising
      return light + (peak - light) * ease(u);
    }
    const u = tp === 1 ? 1 : (x - tp) / (1 - tp); // 0..1 falling
    return peak + (dark - peak) * ease(u);
  };
}

/** Smooth 0..1 ease-in-out (raised cosine). */
const ease = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(u));

/**
 * Inverse of `bump`: the `peak` value such that `bump(opts)` evaluated at `t`
 * equals `value`. Used to derive a family's peak chroma from a seed color, so
 * the chroma ramp passes through the seed's own chroma at its step. Defaults
 * mirror `defaultChroma` so the derivation is exact for the default policy.
 *
 * Degenerate at the endpoints (t=0 or t=1), where `bump` sits on its floor
 * independent of the peak — there we simply return `value`.
 */
export function bumpPeakFor(
  value: number,
  t: number,
  opts: { tPeak?: number; light?: number; dark?: number } = {},
): number {
  const { tPeak = 0.6, light = 0.025, dark = 0.05 } = opts;
  const tp = clamp01(tPeak);
  const x = clamp01(t);
  if (x <= tp) {
    // Rising: value = light + (peak - light) * e  ->  peak = light + (value - light) / e
    const e = ease(tp === 0 ? 1 : x / tp);
    return e === 0 ? value : light + (value - light) / e;
  }
  // Falling: value = peak + (dark - peak) * e  ->  peak = (value - dark * e) / (1 - e)
  const e = ease(tp === 1 ? 1 : (x - tp) / (1 - tp));
  return e === 1 ? value : (value - dark * e) / (1 - e);
}

/** Smootherstep (Perlin), 0..1: flat at both ends, steep in the middle. */
const smootherstep = (x: number) => {
  const v = clamp01(x);
  return v * v * v * (v * (v * 6 - 15) + 10);
};

/**
 * Lightness ramp from `max` (t=0) to `min` (t=1), blending a gamma ramp with a
 * smootherstep S-curve.
 *
 * The `sCurve` knob is the key to the darkest-on-lightest contrast contract:
 * even a small amount (~0.1–0.15) pushes the lightest steps higher and the
 * darkest steps lower — enough to clear WCAG AA on the innermost 700/200 pair —
 * while barely touching step-to-step differentiation at the extremes. Full
 * smootherstep (sCurve=1) would clear contrast trivially but crush the tints and
 * shades together, so keep it mild.
 */
export function ramp(opts: { max: number; min: number; gamma?: number; sCurve?: number }): Curve {
  const { max, min, gamma: g = 1, sCurve = 0 } = opts;
  const a = clamp01(sCurve);
  return (t) => {
    const x = clamp01(t);
    const e = (1 - a) * Math.pow(x, g) + a * smootherstep(x);
    return max - (max - min) * e;
  };
}

/**
 * Default lightness ramp: bright tint -> deep shade, with a gentle S-blend that
 * guarantees the 4 darkest steps clear WCAG AA as foregrounds on the 4 lightest
 * (worst innermost pair 700/200 ≈ 4.7) across hues, with crisp end steps.
 */
export const defaultLightness = (): Curve => ramp({ max: 0.98, min: 0.18, gamma: 1, sCurve: 0.13 });

/** Sensible default chroma policy: vivid mid-tones, soft ends. */
export const defaultChroma = (peak = 0.14): Curve => bump({ peak, tPeak: 0.6, light: 0.025, dark: 0.05 });
