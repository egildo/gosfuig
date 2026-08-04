/**
 * Family resolution: a declarative FamilySpec -> named, gamut-safe swatches.
 *
 * The ramp is a path through OKLCH space, and a family's named colors are
 * waypoints it must pass through. A branding book gives you the waypoints; this
 * builds the path.
 *
 * Pipeline per step i:
 *   1. base L from the lightness curve, C from the chroma curve, H from the hue
 *      curve — the shape of the path before any color pulls it
 *   2. place each named color on a step (its own, or the best lightness fit)
 *   3. route the path through them: per-axis residual interpolation, so the base
 *      curve keeps its shape and every named color is hit exactly
 *   4. gamut-map every swatch (chroma clamp) so the stored OKLCH is displayable,
 *      recording what the path asked for and could not have
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
import { STEP_COUNT, makeScale, type Scale, type StepName } from './naming.js';
import { parse, gamutClamp, normalize, toHex, toCss, type Oklch } from './color/oklch.js';

/** Chroma difference below this is float noise, not a real gamut loss. */
const CLAMP_EPSILON = 1e-6;

/** A residual per axis at one step, used to route the ramp through its colors. */
interface Anchor {
  i: number;
  l: number;
  c: number;
  h: number;
}

/**
 * Signed hue difference `to - from`, taken the short way around the circle.
 *
 * Hue is the one axis where plain subtraction is wrong: 350° to 10° is +20°,
 * not −340°. Get this wrong and a family routed through a named color spins the
 * long way through every hue on the wheel to reach it.
 */
export function hueDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** A named color resolved to a step. */
interface PinnedColor {
  name?: string;
  oklch: Oklch;
}

/**
 * Resolve every named color (and every terse lock) to a step index.
 *
 * A color that names its step goes there. A color that doesn't goes where the
 * ramp's own lightness comes closest to it — the least violent placement, and a
 * down payment on letting the step be negotiated properly later. Ties and
 * collisions resolve in favour of the color declared first.
 */
function placeColors(spec: FamilySpec, scale: Scale, baseL: number[]): Map<number, PinnedColor> {
  const declared: NamedColor[] = [...(spec.colors ?? [])];

  // The terse form desugars into the same list, with no name attached.
  for (const [key, val] of Object.entries(spec.locks ?? {})) {
    declared.push({ value: val as string | Oklch, step: key as StepName });
  }

  const placed = new Map<number, PinnedColor>();
  const taken = new Set<number>();

  // Explicit steps are claimed first, so an unplaced color cannot steal one.
  const resolved = declared.map((color) => {
    const oklch = parse(color.value);
    if (color.step === undefined) return { color, oklch, index: -1 };
    // Step keys are names ("700") or raw indices (7). Names and the index range
    // never overlap, so prefer a name match, else treat the key as an index.
    const key = color.step;
    const index =
      typeof key === 'string' && scale.names.includes(key)
        ? scale.indexOf(key)
        : scale.indexOf(typeof key === 'string' ? Number(key) : key);
    taken.add(index);
    return { color, oklch, index };
  });

  for (const r of resolved) {
    const index = r.index >= 0 ? r.index : nearestFreeByLightness(r.oklch.l, baseL, taken);
    taken.add(index);
    if (!placed.has(index)) {
      placed.set(index, {
        oklch: r.oklch,
        ...(r.color.name !== undefined ? { name: r.color.name } : {}),
      });
    }
  }
  return placed;
}

/** The step whose base lightness is closest to `l` and not already claimed. */
function nearestFreeByLightness(l: number, baseL: number[], taken: Set<number>): number {
  let best = -1;
  let bestGap = Infinity;
  for (let i = 0; i < baseL.length; i++) {
    if (taken.has(i)) continue;
    const gap = Math.abs(baseL[i]! - l);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  // Every step already claimed: fall back to the closest overall.
  if (best < 0) {
    best = baseL.reduce((b, v, i) => (Math.abs(v - l) < Math.abs(baseL[b]! - l) ? i : b), 0);
  }
  return best;
}

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
  /**
   * The brand's own colors, which this family's ramp must pass through.
   *
   * A list rather than a map keyed by step, because which step a color lands on
   * is a decision, not a fact — a branding book says "our blue is #1d4ed8", not
   * "our blue is step 700". Omit `step` and the engine places it where the
   * ramp's lightness already comes closest.
   */
  colors?: NamedColor[];
  /**
   * Pinned colors, terse form: step -> color. Desugars into `colors` with no
   * name attached. Kept because it reads well when the name doesn't matter.
   */
  locks?: Partial<Record<StepName, string | Oklch>> | Record<number, string | Oklch>;
  /** Vendor data the engine carries but never reads. See `PaletteSpec.$extensions`. */
  $extensions?: Record<string, unknown>;
}

/**
 * A color the brand already owns, and which the family is built around.
 *
 * Several per family is the normal case, not the exception: a branding book
 * routinely lists a bright blue and a deep navy. They become waypoints on one
 * ramp rather than two unrelated families.
 */
export interface NamedColor {
  /** The brand's name for it, e.g. "Corporate Blue". */
  name?: string;
  /** Any CSS color or OKLCH. */
  value: string | Oklch;
  /**
   * Step name ("700") or 0-based index. Omitted = best lightness fit.
   *
   * `string & {}` keeps autocomplete on the canonical names while still
   * accepting the generated names of a non-default step count.
   */
  step?: StepName | number | (string & {});
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
  /** Whether this step is one of the family's named colors. */
  locked: boolean;
  /** The brand's name for this color, when it has one. */
  colorName?: string;
  /**
   * How far this named color pulled the base curve, per axis. Pinned steps only.
   *
   * A brand color that sits close to where the ramp was already going pulls
   * almost nothing. One pinned somewhere its lightness does not belong drags
   * the whole curve to reach it, and every other step pays for it — which is
   * the difference between a palette built around a color and one fighting it.
   */
  pull?: { l: number; c: number; h: number };
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

  // Base curves, before any named color pulls them.
  const baseL = scale.t.map((t) => lightCurve(t));
  const baseC = scale.t.map((t) => chromaCurve(t));
  const baseH = scale.t.map((t) => hueCurve(t));

  const pinned = placeColors(spec, scale, baseL);

  // Route the ramp through its named colors.
  //
  // For each axis, take the residual (what the color is, minus what the base
  // curve would have given) at every pinned step, and zero at the two endpoints
  // unless those are pinned themselves. Interpolate the residuals across
  // indices and add them back: the base curve keeps its shape, and the pinned
  // colors are hit exactly.
  //
  // All three axes, not just lightness. Routing only L leaves a pinned color as
  // a spike — its neighbours keep the curve's chroma and hue while it jumps to
  // its own, which is visible as a bright step in an otherwise even ramp and as
  // a hue that snaps away and back in a single step.
  const endpoints = [0, scale.count - 1];
  const anchors: Anchor[] = [];
  for (const i of endpoints) {
    const c = pinned.get(i);
    anchors.push(
      c
        ? {
            i,
            l: c.oklch.l - baseL[i]!,
            c: c.oklch.c - baseC[i]!,
            h: hueDelta(baseH[i]!, c.oklch.h),
          }
        : { i, l: 0, c: 0, h: 0 },
    );
  }
  for (const [i, c] of pinned) {
    if (!endpoints.includes(i)) {
      anchors.push({
        i,
        l: c.oklch.l - baseL[i]!,
        c: c.oklch.c - baseC[i]!,
        h: hueDelta(baseH[i]!, c.oklch.h),
      });
    }
  }
  anchors.sort((a, b) => a.i - b.i);

  const residual = (i: number): Anchor => {
    let lo = anchors[0]!;
    let hi = anchors[anchors.length - 1]!;
    for (let k = 0; k < anchors.length - 1; k++) {
      if (i >= anchors[k]!.i && i <= anchors[k + 1]!.i) {
        lo = anchors[k]!;
        hi = anchors[k + 1]!;
        break;
      }
    }
    if (hi.i === lo.i) return lo;
    const f = (i - lo.i) / (hi.i - lo.i);
    return {
      i,
      l: lo.l + (hi.l - lo.l) * f,
      c: lo.c + (hi.c - lo.c) * f,
      h: lo.h + (hi.h - lo.h) * f,
    };
  };

  const swatches: Swatch[] = scale.names.map((name, i) => {
    const pin = pinned.get(i);
    const r = residual(i);
    // What the spec asked for, in canonical range but not yet made displayable.
    // A pinned step uses its color verbatim; residual interpolation hits it
    // exactly anyway, but going through the arithmetic would cost precision.
    const requested = normalize(
      pin ? pin.oklch : { l: baseL[i]! + r.l, c: baseC[i]! + r.c, h: baseH[i]! + r.h },
    );
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
      locked: !!pin,
      ...(pin?.name !== undefined ? { colorName: pin.name } : {}),
      ...(pin ? { pull: { l: r.l, c: r.c, h: r.h } } : {}),
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
  /**
   * The brand's name for the seed, e.g. "Corporate Blue". The seed usually IS
   * a named color — this is where the name goes.
   */
  colorName?: string;
}

/**
 * Build a FamilySpec anchored to a single fixed color.
 *
 * The family's hue — and, by default, its chroma level — are read FROM the
 * seed; the full ramp is generated around it; and the seed becomes the family's
 * named color at its step. This is the "one brand color -> full tonal family"
 * entry point: pass it a resolvable spec and hand the result to `resolveFamily`.
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
    // Named form when the seed has a name, terse form otherwise — so specs that
    // don't care about naming keep serializing exactly as they did.
    ...(spec.colorName !== undefined
      ? { colors: [{ name: spec.colorName, value: seed, step: scale.names[idx]! }] }
      : { locks: { [scale.names[idx]!]: seed } as FamilySpec['locks'] }),
  };
}
