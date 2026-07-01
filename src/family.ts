/**
 * Family resolution: a declarative FamilySpec -> 12 named, gamut-safe swatches.
 *
 * Pipeline per step i (t = i/11):
 *   1. base L from the lightness curve, C from the chroma curve, H from the hue curve
 *   2. apply locks: a locked step pins its EXACT OKLCH (L, C, H)
 *   3. re-smooth lightness through the locks via residual interpolation, so the
 *      value progression passes through pinned colors without kinks
 *   4. gamut-map every swatch (chroma clamp) so the stored OKLCH is displayable
 */
import { type Curve, constant, defaultLightness, defaultChroma } from './curves.js';
import { STEP_NAMES, STEP_T, STEP_COUNT, stepIndex, type StepName } from './naming.js';
import { parse, gamutClamp, toHex, toCss, type Oklch } from './color/oklch.js';

export interface FamilySpec {
  /** Family name, used as the token group name (e.g. "blue", "danger"). */
  name: string;
  /** Base hue in degrees, or a curve for hue "torsion" across the ramp. */
  hue: number | Curve;
  /** Chroma policy. Number = peak chroma with the default bump; or a full curve. */
  chroma?: number | Curve;
  /** Lightness ramp. Defaults to a bright-tint -> deep-shade gamma ramp. */
  lightness?: Curve;
  /** Pinned colors: step name ("500") or index -> any CSS color / OKLCH. */
  locks?: Partial<Record<StepName, string | Oklch>> | Record<number, string | Oklch>;
}

export interface Swatch {
  /** Step name, e.g. "500". */
  name: StepName;
  /** 0..11 position on the ramp. */
  index: number;
  /** Position on the 0..1 ramp. */
  t: number;
  /** Displayable OKLCH (already gamut-mapped). */
  oklch: Oklch;
  /** #rrggbb. */
  hex: string;
  /** CSS `oklch(...)` string. */
  css: string;
  /** Whether this step was pinned by a lock. */
  locked: boolean;
}

export interface Family {
  name: string;
  swatches: Swatch[];
  /** True if lightness is strictly decreasing (monotone) across the ramp. */
  monotone: boolean;
  /** Steps where a lock broke lightness ordering, if any (names). */
  monotoneBreaks: StepName[];
}

export function resolveFamily(spec: FamilySpec): Family {
  const hueCurve: Curve = typeof spec.hue === 'number' ? constant(spec.hue) : spec.hue;
  const chromaCurve: Curve =
    typeof spec.chroma === 'function' ? spec.chroma : defaultChroma(spec.chroma ?? 0.14);
  const lightCurve: Curve = spec.lightness ?? defaultLightness();

  // Normalize locks to index -> OKLCH.
  const locks = new Map<number, Oklch>();
  for (const [key, val] of Object.entries(spec.locks ?? {})) {
    // Lock keys are step names ("700") or raw indices (7). Step names and the
    // 0..11 index range never overlap, so prefer a name match, else treat as index.
    const idx = STEP_NAMES.includes(key as StepName) ? stepIndex(key as StepName) : stepIndex(Number(key));
    locks.set(idx, parse(val as string | Oklch));
  }

  // Base curves.
  const baseL = STEP_T.map((t) => lightCurve(t));
  const baseC = STEP_T.map((t) => chromaCurve(t));
  const baseH = STEP_T.map((t) => hueCurve(t));

  // Lightness residual anchoring: residual = lockedL - baseL at locked steps and
  // at the two endpoints (0 there unless they are themselves locked). Interpolate
  // residual linearly across indices, then add back — base curve shape preserved,
  // locked lightness hit exactly.
  const anchors: Array<{ i: number; r: number }> = [];
  const endpoints = [0, STEP_COUNT - 1];
  for (const i of endpoints) {
    const r = locks.has(i) ? locks.get(i)!.l - baseL[i]! : 0;
    anchors.push({ i, r });
  }
  for (const [i, c] of locks) {
    if (!endpoints.includes(i)) anchors.push({ i, r: c.l - baseL[i]! });
  }
  anchors.sort((a, b) => a.i - b.i);
  const residual = (i: number): number => {
    let lo = anchors[0]!;
    let hi = anchors[anchors.length - 1]!;
    for (let k = 0; k < anchors.length - 1; k++) {
      if (i >= anchors[k]!.i && i <= anchors[k + 1]!.i) {
        lo = anchors[k]!;
        hi = anchors[k + 1]!;
        break;
      }
    }
    if (hi.i === lo.i) return lo.r;
    const f = (i - lo.i) / (hi.i - lo.i);
    return lo.r + (hi.r - lo.r) * f;
  };

  const swatches: Swatch[] = STEP_NAMES.map((name, i) => {
    const lock = locks.get(i);
    const oklch = lock
      ? gamutClamp(lock)
      : gamutClamp({ l: baseL[i]! + residual(i), c: baseC[i]!, h: baseH[i]! });
    return {
      name,
      index: i,
      t: STEP_T[i]!,
      oklch,
      hex: toHex(oklch),
      css: toCss(oklch),
      locked: !!lock,
    };
  });

  // Monotonicity check (lightness strictly decreasing light -> dark).
  const breaks: StepName[] = [];
  for (let i = 1; i < swatches.length; i++) {
    if (swatches[i]!.oklch.l >= swatches[i - 1]!.oklch.l) breaks.push(swatches[i]!.name);
  }

  return { name: spec.name, swatches, monotone: breaks.length === 0, monotoneBreaks: breaks };
}
