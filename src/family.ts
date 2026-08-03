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
import {
  type Curve,
  type CurveSpec,
  compile,
  isCurveSpec,
  constant,
  defaultLightness,
  defaultChroma,
  bumpPeakFor,
} from './curves.js';
import { STEP_COUNT, makeScale, type StepName } from './naming.js';
import { parse, gamutClamp, normalize, toHex, toCss, type Oklch } from './color/oklch.js';

/** Chroma difference below this is float noise, not a real gamut loss. */
const CLAMP_EPSILON = 1e-6;

export interface FamilySpec {
  /** Family name, used as the token group name (e.g. "blue", "danger"). */
  name: string;
  /** Base hue in degrees, or a curve spec for hue "torsion" across the ramp. */
  hue: number | CurveSpec;
  /** Chroma policy. Number = peak chroma with the default bump; or a full curve spec. */
  chroma?: number | CurveSpec;
  /** Lightness ramp. Defaults to a bright-tint -> deep-shade gamma ramp. */
  lightness?: CurveSpec;
  /** Number of steps in the ramp. Default 12 (the canonical named scale). */
  steps?: number;
  /** Pinned colors: step name ("500") or index -> any CSS color / OKLCH. */
  locks?: Partial<Record<StepName, string | Oklch>> | Record<number, string | Oklch>;
  /** Vendor data the engine carries but never reads. See `PaletteSpec.$extensions`. */
  $extensions?: Record<string, unknown>;
}

export interface Swatch {
  /** Step name, e.g. "500". */
  name: string;
  /** 0-based position on the ramp. */
  index: number;
  /** Position on the 0..1 ramp. */
  t: number;
  /** Displayable OKLCH (already gamut-mapped). */
  oklch: Oklch;
  /**
   * What the curves (or the lock) actually asked for, before gamut mapping.
   *
   * sRGB cannot hold the same chroma at every hue — magenta reaches C 0.309,
   * cyan only 0.150 — so a chroma the spec requests is often silently
   * unreachable. Keeping the request alongside the result is what lets the
   * engine say so instead of quietly delivering something else.
   */
  requested: Oklch;
  /** True when gamut mapping had to reduce chroma to make this displayable. */
  clamped: boolean;
  /** #rrggbb. */
  hex: string;
  /** CSS `oklch(...)` string. */
  css: string;
  /** Whether this step was pinned by a lock. */
  locked: boolean;
}

/** How much chroma the gamut cost this swatch. Zero when nothing was lost. */
export function chromaLoss(s: Swatch): number {
  return Math.max(0, s.requested.c - s.oklch.c);
}

export interface Family {
  name: string;
  swatches: Swatch[];
  /** True if lightness is strictly decreasing (monotone) across the ramp. */
  monotone: boolean;
  /** Steps where a lock broke lightness ordering, if any (names). */
  monotoneBreaks: string[];
  /** Steps whose chroma the sRGB gamut reduced (names, light -> dark). */
  clampedSteps: string[];
}

export function resolveFamily(spec: FamilySpec): Family {
  const scale = makeScale(spec.steps ?? STEP_COUNT);
  const hueCurve: Curve = typeof spec.hue === 'number' ? constant(spec.hue) : compile(spec.hue);
  const chromaCurve: Curve = isCurveSpec(spec.chroma)
    ? compile(spec.chroma)
    : defaultChroma(spec.chroma ?? 0.14);
  const lightCurve: Curve = spec.lightness ? compile(spec.lightness) : defaultLightness();

  // Normalize locks to index -> OKLCH.
  const locks = new Map<number, Oklch>();
  for (const [key, val] of Object.entries(spec.locks ?? {})) {
    // Lock keys are step names ("700") or raw indices (7). Names and the index
    // range never overlap, so prefer a name match, else treat the key as an index.
    const idx = scale.names.includes(key) ? scale.indexOf(key) : scale.indexOf(Number(key));
    locks.set(idx, parse(val as string | Oklch));
  }

  // Base curves.
  const baseL = scale.t.map((t) => lightCurve(t));
  const baseC = scale.t.map((t) => chromaCurve(t));
  const baseH = scale.t.map((t) => hueCurve(t));

  // Lightness residual anchoring: residual = lockedL - baseL at locked steps and
  // at the two endpoints (0 there unless they are themselves locked). Interpolate
  // residual linearly across indices, then add back — base curve shape preserved,
  // locked lightness hit exactly.
  const anchors: Array<{ i: number; r: number }> = [];
  const endpoints = [0, scale.count - 1];
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

  const swatches: Swatch[] = scale.names.map((name, i) => {
    const lock = locks.get(i);
    // What the spec asked for, in canonical range but not yet made displayable.
    const requested = normalize(lock ?? { l: baseL[i]! + residual(i), c: baseC[i]!, h: baseH[i]! });
    const oklch = gamutClamp(requested);
    return {
      name,
      index: i,
      t: scale.t[i]!,
      oklch,
      requested,
      // Chroma is the only axis gamut mapping moves, so a reduction in it is
      // exactly the loss. The epsilon keeps float noise from reading as a clamp.
      clamped: requested.c - oklch.c > CLAMP_EPSILON,
      hex: toHex(oklch),
      css: toCss(oklch),
      locked: !!lock,
    };
  });

  // Monotonicity check (lightness strictly decreasing light -> dark).
  const breaks: string[] = [];
  for (let i = 1; i < swatches.length; i++) {
    if (swatches[i]!.oklch.l >= swatches[i - 1]!.oklch.l) breaks.push(swatches[i]!.name);
  }

  return {
    name: spec.name,
    swatches,
    monotone: breaks.length === 0,
    monotoneBreaks: breaks,
    clampedSteps: swatches.filter((s) => s.clamped).map((s) => s.name),
  };
}

export interface SeedSpec {
  /** Family name / token group name. */
  name: string;
  /** The fixed brand color that anchors the family (any CSS color or OKLCH). */
  seed: string | Oklch;
  /** Number of steps in the ramp. Default 12 (the canonical named scale). */
  steps?: number;
  /**
   * Step the seed lands on — a step name ("500") or 0-based index. Defaults to
   * the middle step of the scale (which is "500" on the default 12-step scale).
   */
  step?: StepName | number;
  /**
   * Total hue rotation across the ramp, in degrees. The hue still equals the
   * seed's exactly at the seed's own step, so the pinned color is honored and
   * its neighbors rotate around it. Default 0 (constant hue).
   */
  hueTorsion?: number;
  /** Lightness ramp. Defaults to the standard bright-tint -> deep-shade ramp. */
  lightness?: CurveSpec;
  /**
   * Peak chroma, or a full chroma curve spec. Default: derived from the seed so
   * the chroma ramp passes through the seed's own chroma at its step — the
   * family inherits the seed's colorfulness instead of a fixed default.
   */
  chroma?: number | CurveSpec;
}

/**
 * Build a FamilySpec anchored to a single fixed color.
 *
 * The family's hue — and, by default, its chroma level — are read FROM the
 * seed; the full ramp is generated around it; and the seed is pinned at its
 * step via a lock. This is the "one brand color -> full tonal family" entry
 * point: pass it a resolvable spec and hand the result to `resolveFamily`.
 */
export function seedFamily(spec: SeedSpec): FamilySpec {
  const seed = parse(spec.seed);
  const scale = makeScale(spec.steps ?? STEP_COUNT);
  const idx = spec.step != null ? scale.indexOf(spec.step) : Math.round((scale.count - 1) / 2);
  const tSeed = scale.t[idx]!;
  const torsion = spec.hueTorsion ?? 0;
  // Torsion as data: a linear hue sweep whose value at the seed's own t equals
  // the seed's hue exactly, so the pinned color is honored and its neighbors
  // rotate around it. Equivalent to (t) => seed.h + torsion * (t - tSeed).
  const hue: number | CurveSpec =
    torsion === 0
      ? seed.h
      : { kind: 'hueRamp', start: seed.h - torsion * tSeed, end: seed.h + torsion * (1 - tSeed) };
  const chroma = spec.chroma ?? bumpPeakFor(seed.c, tSeed);
  return {
    name: spec.name,
    hue,
    chroma,
    lightness: spec.lightness,
    steps: spec.steps,
    locks: { [scale.names[idx]!]: seed } as FamilySpec['locks'],
  };
}
