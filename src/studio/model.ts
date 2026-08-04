/**
 * The studio's document model, and its bridge to the shared config format.
 *
 * `FamilyState` is what the sliders edit. `toSpec` turns one into a library
 * FamilySpec — both plain data since Phase 1, so a studio session serializes
 * with no lossy step in the middle.
 *
 * Two things a FamilySpec cannot carry, because the engine has no use for them:
 * whether a family is being authored "from color" or on a free hue, and whether
 * its chroma is derived from the seed. Those are authoring intent, not palette
 * definition. They ride along under `$extensions["gosfuig.studio"]`, which the
 * CLI reads past without caring — so one file serves both, losslessly.
 */
import { seedFamily, type FamilySpec, type NamedColor } from '../family.js';
import { type CurveSpec, isCurveSpec } from '../curves.js';
import { makeScale } from '../naming.js';
import { parse, toHex } from '../color/oklch.js';
import { readExtension, withExtension } from '../config.js';
import type { PaletteSpec } from '../palette.js';
import type { W3CExportOptions } from '../export/w3c.js';

export type Mode = 'seed' | 'free';

export interface FamilyState {
  name: string;
  mode: Mode;
  hue: number;
  seed: string;
  seedStep: number;
  chromaAuto: boolean;
  chroma: number;
  tPeak: number;
  chromaLight: number;
  chromaDark: number;
  hueTorsion: number;
  /** The brand's name for the seed colour, when the config gave one. */
  seedName?: string;
  /**
   * Named colours beyond the first. The studio edits one per family; these are
   * carried verbatim so importing and re-exporting a richer config is lossless.
   */
  carriedColors?: NamedColor[];
  lightMax: number;
  lightMin: number;
  gamma: number;
  sCurve: number;
}

export const LIGHT_DEFAULT = { lightMax: 0.98, lightMin: 0.18, gamma: 1.0, sCurve: 0.13 };
export const CHROMA_DEFAULT = { chroma: 0.14, tPeak: 0.6, chromaLight: 0.025, chromaDark: 0.05 };

export function mkFamily(over: Partial<FamilyState> = {}): FamilyState {
  return {
    name: 'family',
    mode: 'seed',
    hue: 259,
    seed: '#1d4ed8',
    seedStep: 6,
    chromaAuto: true,
    hueTorsion: 0,
    ...LIGHT_DEFAULT,
    ...CHROMA_DEFAULT,
    ...over,
  };
}

export const DEFAULT_STEPS = 12;

export function defaultFamilies(): FamilyState[] {
  return [
    mkFamily({ name: 'signal blue', seed: '#1d4ed8', seedStep: 8 }),
    mkFamily({ name: 'clay', seed: '#ac543f', seedStep: 6 }),
    mkFamily({ name: 'plum', seed: '#512c59', seedStep: 8 }),
    mkFamily({ name: 'sage', seed: '#4a7c59', seedStep: 7 }),
    mkFamily({ name: 'ember amber', seed: '#c26300', seedStep: 6 }),
    mkFamily({ name: 'slate', seed: '#5b6270', seedStep: 6, chroma: 0.02 }),
  ];
}

// ---- studio state -> library spec ----

export function lightnessOf(f: FamilyState): CurveSpec {
  return { kind: 'ramp', max: f.lightMax, min: f.lightMin, gamma: f.gamma, sCurve: f.sCurve };
}

export function chromaCurveOf(f: FamilyState): CurveSpec {
  return { kind: 'bump', peak: f.chroma, tPeak: f.tPeak, light: f.chromaLight, dark: f.chromaDark };
}

export function toSpec(f: FamilyState, steps: number): FamilySpec {
  const lightness = lightnessOf(f);
  if (f.mode === 'seed') {
    const spec = seedFamily({
      name: f.name,
      seed: f.seed,
      step: Math.min(f.seedStep, steps - 1),
      steps,
      hueTorsion: f.hueTorsion,
      lightness,
      chroma: f.chromaAuto ? undefined : chromaCurveOf(f),
      ...(f.seedName !== undefined ? { colorName: f.seedName } : {}),
    });
    if (!f.carriedColors?.length) return spec;
    // Fold the seed and the carried colours into one list, so a family the
    // studio cannot fully edit still round-trips through it intact.
    const seedColor: NamedColor = spec.colors?.[0] ?? {
      value: f.seed,
      step: Math.min(f.seedStep, steps - 1),
    };
    return { ...spec, locks: undefined, colors: [seedColor, ...f.carriedColors] };
  }
  const hue: number | CurveSpec =
    f.hueTorsion !== 0
      ? { kind: 'hueRamp', start: f.hue - f.hueTorsion / 2, end: f.hue + f.hueTorsion / 2 }
      : f.hue;
  return { name: f.name, hue, chroma: chromaCurveOf(f), lightness, steps };
}

// ---- the config file ----

export const STUDIO_OWNER = 'gosfuig.studio';

export interface StudioSession {
  steps: number;
  families: FamilyState[];
  /**
   * Token shape carried through from an imported config. The studio has no UI
   * for it yet, but dropping it on re-export would silently undo whatever the
   * author declared, so it rides along.
   */
  export?: W3CExportOptions;
}

/** A studio session as a config file: a real PaletteSpec, plus authoring intent. */
export function toConfig(session: StudioSession, name = 'gosfuig studio'): PaletteSpec {
  const spec: PaletteSpec = {
    name,
    families: session.families.map((f) => toSpec(f, session.steps)),
  };
  if (session.export) spec.export = session.export;
  return withExtension(spec, STUDIO_OWNER, session);
}

/**
 * Read a config back into studio state.
 *
 * When the file carries our extension the session is restored exactly. When it
 * doesn't — a hand-written config, or one from the CLI — the state is
 * reconstructed from the spec itself. That reconstruction is faithful in color
 * (the same ramps resolve) but not necessarily in authoring shape: a family
 * pinned by a lock comes back as "from color", and a hue torsion authored on a
 * seed family comes back centered rather than pivoted on the seed's step.
 */
export function fromConfig(spec: PaletteSpec): StudioSession {
  const restored = readExtension<StudioSession>(spec, STUDIO_OWNER);
  if (isSession(restored)) {
    return {
      steps: restored.steps,
      families: restored.families.map((f) => mkFamily(f)),
      ...(spec.export ? { export: spec.export } : {}),
    };
  }

  const steps = spec.families[0]?.steps ?? DEFAULT_STEPS;
  return {
    steps,
    families: spec.families.map((f) => stateFromSpec(f, steps)),
    ...(spec.export ? { export: spec.export } : {}),
  };
}

function isSession(v: unknown): v is StudioSession {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isInteger((v as StudioSession).steps) &&
    Array.isArray((v as StudioSession).families)
  );
}

function stateFromSpec(fs: FamilySpec, steps: number): FamilyState {
  const state = mkFamily({ name: fs.name });

  // Lightness: a ramp maps onto the sliders one-for-one; anything else keeps
  // the defaults, since the studio has no control for it.
  if (isCurveSpec(fs.lightness) && fs.lightness.kind === 'ramp') {
    state.lightMax = fs.lightness.max;
    state.lightMin = fs.lightness.min;
    state.gamma = fs.lightness.gamma ?? 1;
    state.sCurve = fs.lightness.sCurve ?? 0;
  }

  // Chroma: a bump maps onto the sliders; a bare number is the peak.
  if (isCurveSpec(fs.chroma) && fs.chroma.kind === 'bump') {
    state.chroma = fs.chroma.peak;
    state.tPeak = fs.chroma.tPeak ?? CHROMA_DEFAULT.tPeak;
    state.chromaLight = fs.chroma.light ?? CHROMA_DEFAULT.chromaLight;
    state.chromaDark = fs.chroma.dark ?? CHROMA_DEFAULT.chromaDark;
    state.chromaAuto = false;
  } else if (typeof fs.chroma === 'number') {
    state.chroma = fs.chroma;
    state.chromaAuto = false;
  }

  // Hue, and the torsion implied by a hue ramp.
  if (typeof fs.hue === 'number') {
    state.hue = fs.hue;
  } else if (isCurveSpec(fs.hue) && fs.hue.kind === 'hueRamp') {
    state.hue = (fs.hue.start + fs.hue.end) / 2;
    state.hueTorsion = fs.hue.end - fs.hue.start;
  } else if (isCurveSpec(fs.hue) && fs.hue.kind === 'constant') {
    state.hue = fs.hue.value;
  }

  // Named colors and terse locks say the same thing, so read both. The first
  // becomes the editable seed — that is what `seedFamily` produces, and the
  // more useful reading when the authoring intent is unrecorded.
  const scale = makeScale(fs.steps ?? steps);
  const declared: NamedColor[] = [
    ...(fs.colors ?? []),
    ...Object.entries(fs.locks ?? {}).map(([step, value]) => ({
      value: value as string,
      step,
    })),
  ];

  if (declared.length > 0) {
    const [first, ...rest] = declared;
    const key = String(first!.step ?? '');
    const idx = scale.names.includes(key) ? scale.indexOf(key) : Number(key);
    state.mode = 'seed';
    state.seed = toHex(parse(first!.value));
    if (first!.name !== undefined) state.seedName = first!.name;
    // No step, or an unusable one: let the engine place it by lightness, which
    // is what `seedStep` on a fresh family already means.
    if (Number.isInteger(idx) && idx >= 0 && idx < scale.count) state.seedStep = idx;
    // The studio edits one color per family. Anything else the config declared
    // is carried verbatim so re-exporting does not silently drop it.
    if (rest.length > 0) state.carriedColors = rest;
  } else {
    state.mode = 'free';
  }

  return state;
}

// ---- session persistence ----

const SESSION_KEY = 'gosfuig.studio.session';

/** Save the session so a reload doesn't discard an afternoon of slider work. */
export function saveSession(session: StudioSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Private mode, quota, or no storage at all — persistence is a convenience,
    // never a precondition for the studio working.
  }
}

export function loadSession(): StudioSession | null {
  try {
    const text = localStorage.getItem(SESSION_KEY);
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    if (!isSession(parsed)) return null;
    return { steps: parsed.steps, families: parsed.families.map((f) => mkFamily(f)) };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // See saveSession.
  }
}
