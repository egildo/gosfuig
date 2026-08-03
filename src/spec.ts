/**
 * Spec validation: turn untrusted input (a parsed JSON file, a module's default
 * export, a message from a front-end) into a PaletteSpec, or into located
 * errors explaining why it isn't one.
 *
 * This exists because a spec is now data. Before, `lightness` was a function
 * and a malformed config produced `lightCurve is not a function` from deep
 * inside `resolveFamily` — a stack trace pointing at the engine for a mistake
 * made in the config. Every error here names its path instead:
 *
 *   families[1].lightness.kind: unknown curve kind "smoothstep"
 *
 * Unknown keys are errors, not warnings, so a typo (`lightnes`) fails loudly
 * rather than silently resolving to the default.
 */
import { CURVE_KINDS, type CurveSpec } from './curves.js';
import { SLUG_STYLES } from './export/shape.js';
import { makeScale, STEP_COUNT } from './naming.js';
import { parse } from './color/oklch.js';
import type { FamilySpec } from './family.js';
import type { PaletteSpec } from './palette.js';

export interface SpecError {
  /** Where the problem is, e.g. `families[0].locks.700`. */
  path: string;
  message: string;
}

export type SpecResult<T> = { ok: true; value: T } | { ok: false; errors: SpecError[] };

/** Required and optional numeric fields of each curve kind. */
const CURVE_FIELDS: Record<string, { required: string[]; optional: string[] }> = {
  constant: { required: ['value'], optional: [] },
  linear: { required: ['from', 'to'], optional: [] },
  gamma: { required: ['from', 'to'], optional: ['gamma'] },
  hueRamp: { required: ['start', 'end'], optional: [] },
  ramp: { required: ['max', 'min'], optional: ['gamma', 'sCurve'] },
  bump: { required: ['peak'], optional: ['tPeak', 'light', 'dark'] },
};

const FAMILY_KEYS = ['name', 'hue', 'chroma', 'lightness', 'steps', 'locks', '$extensions'];
const PALETTE_KEYS = ['name', 'families', 'export', '$version', '$extensions'];

const EXPORT_KEYS = [
  'colorSpace',
  'hexFallback',
  'precision',
  'prefix',
  'groups',
  'steps',
  'slug',
  'flatten',
  'separator',
];

/** The config format this build writes and understands. */
export const CONFIG_VERSION = 1;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validateCurveSpec(input: unknown, path: string, errors: SpecError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: `expected a curve spec object, got ${describe(input)}` });
    return;
  }
  const kind = input.kind;
  if (typeof kind !== 'string' || !(kind in CURVE_FIELDS)) {
    errors.push({
      path: `${path}.kind`,
      message:
        kind === undefined
          ? `missing "kind" (one of ${CURVE_KINDS.join(', ')})`
          : `unknown curve kind ${JSON.stringify(kind)} (expected one of ${CURVE_KINDS.join(', ')})`,
    });
    return;
  }

  const { required, optional } = CURVE_FIELDS[kind]!;
  for (const f of required) {
    if (!(f in input))
      errors.push({ path: `${path}.${f}`, message: `missing (required for "${kind}")` });
    else if (!isFiniteNumber(input[f]))
      errors.push({
        path: `${path}.${f}`,
        message: `expected a finite number, got ${describe(input[f])}`,
      });
  }
  for (const f of optional) {
    if (f in input && input[f] !== undefined && !isFiniteNumber(input[f]))
      errors.push({
        path: `${path}.${f}`,
        message: `expected a finite number, got ${describe(input[f])}`,
      });
  }
  for (const key of Object.keys(input)) {
    if (key !== 'kind' && !required.includes(key) && !optional.includes(key)) {
      errors.push({
        path: `${path}.${key}`,
        message: `unknown field for curve kind "${kind}" (expected ${[...required, ...optional].join(', ') || 'none'})`,
      });
    }
  }
}

/** A number, or a curve spec. Used for `hue` and `chroma`. */
function validateNumberOrCurve(
  input: unknown,
  path: string,
  errors: SpecError[],
  opts: { min?: number } = {},
): void {
  if (isFiniteNumber(input)) {
    if (opts.min != null && input < opts.min)
      errors.push({ path, message: `expected a number >= ${opts.min}, got ${input}` });
    return;
  }
  if (isRecord(input)) {
    validateCurveSpec(input, path, errors);
    return;
  }
  errors.push({ path, message: `expected a number or a curve spec, got ${describe(input)}` });
}

function validateLocks(
  locks: unknown,
  steps: number | undefined,
  path: string,
  errors: SpecError[],
): void {
  if (!isRecord(locks)) {
    errors.push({ path, message: `expected an object of step -> color, got ${describe(locks)}` });
    return;
  }
  // Only check key membership when the step count itself is usable.
  const scale =
    steps === undefined || (Number.isInteger(steps) && steps >= 2)
      ? makeScale(steps ?? STEP_COUNT)
      : null;

  for (const [key, value] of Object.entries(locks)) {
    if (scale) {
      const known = scale.names.includes(key) || isStepIndex(key, scale.count);
      if (!known) {
        errors.push({
          path: `${path}.${key}`,
          message: `not a step of this ${scale.count}-step scale (names: ${scale.names.join(', ')}; or an index 0..${scale.count - 1})`,
        });
        continue;
      }
    }
    if (isRecord(value)) {
      for (const c of ['l', 'c', 'h']) {
        if (!isFiniteNumber(value[c]))
          errors.push({ path: `${path}.${key}.${c}`, message: `expected a finite number` });
      }
      continue;
    }
    if (typeof value !== 'string') {
      errors.push({
        path: `${path}.${key}`,
        message: `expected a CSS color string or an {l,c,h} object, got ${describe(value)}`,
      });
      continue;
    }
    try {
      parse(value);
    } catch {
      errors.push({
        path: `${path}.${key}`,
        message: `cannot parse color ${JSON.stringify(value)}`,
      });
    }
  }
}

const isStepIndex = (key: string, count: number): boolean => {
  const n = Number(key);
  return Number.isInteger(n) && n >= 0 && n < count;
};

/** A record whose values are all strings — used by the group and step rename maps. */
function validateStringMap(input: unknown, path: string, errors: SpecError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: `expected an object of name -> name, got ${describe(input)}` });
    return;
  }
  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== 'string' || v.trim() === '')
      errors.push({ path: `${path}.${k}`, message: `expected a non-empty string` });
  }
}

function validateExport(input: unknown, path: string, errors: SpecError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: `expected an export options object, got ${describe(input)}` });
    return;
  }

  const { colorSpace, hexFallback, precision, prefix, groups, steps, slug, flatten, separator } =
    input;

  if (colorSpace !== undefined && colorSpace !== 'oklch' && colorSpace !== 'srgb')
    errors.push({
      path: `${path}.colorSpace`,
      message: `expected "oklch" or "srgb", got ${describe(colorSpace)}`,
    });

  if (hexFallback !== undefined && typeof hexFallback !== 'boolean')
    errors.push({
      path: `${path}.hexFallback`,
      message: `expected a boolean, got ${describe(hexFallback)}`,
    });

  if (precision !== undefined && (!Number.isInteger(precision) || (precision as number) < 0))
    errors.push({
      path: `${path}.precision`,
      message: `expected a non-negative integer, got ${describe(precision)}`,
    });

  if (prefix !== undefined) {
    const parts = Array.isArray(prefix) ? prefix : [prefix];
    if (!parts.every((p) => typeof p === 'string' && p.trim() !== ''))
      errors.push({
        path: `${path}.prefix`,
        message: `expected a non-empty string or an array of them, got ${describe(prefix)}`,
      });
  }

  if (groups !== undefined) validateStringMap(groups, `${path}.groups`, errors);
  if (steps !== undefined) validateStringMap(steps, `${path}.steps`, errors);

  if (slug !== undefined && !(SLUG_STYLES as readonly unknown[]).includes(slug))
    errors.push({
      path: `${path}.slug`,
      message: `expected one of ${SLUG_STYLES.join(', ')}, got ${describe(slug)}`,
    });

  if (flatten !== undefined && typeof flatten !== 'boolean')
    errors.push({
      path: `${path}.flatten`,
      message: `expected a boolean, got ${describe(flatten)}`,
    });

  if (separator !== undefined && (typeof separator !== 'string' || separator === ''))
    errors.push({
      path: `${path}.separator`,
      message: `expected a non-empty string, got ${describe(separator)}`,
    });

  for (const key of Object.keys(input)) {
    if (!EXPORT_KEYS.includes(key))
      errors.push({
        path: `${path}.${key}`,
        message: `unknown field (expected ${EXPORT_KEYS.join(', ')})`,
      });
  }
}

export function validateFamilySpec(input: unknown, path = 'family'): SpecResult<FamilySpec> {
  const errors: SpecError[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: [{ path, message: `expected an object, got ${describe(input)}` }] };
  }

  if (typeof input.name !== 'string' || input.name.trim() === '') {
    errors.push({ path: `${path}.name`, message: `expected a non-empty string` });
  }

  if (!('hue' in input)) errors.push({ path: `${path}.hue`, message: 'missing (required)' });
  else validateNumberOrCurve(input.hue, `${path}.hue`, errors);

  if ('chroma' in input && input.chroma !== undefined)
    validateNumberOrCurve(input.chroma, `${path}.chroma`, errors, { min: 0 });

  if ('lightness' in input && input.lightness !== undefined)
    validateCurveSpec(input.lightness, `${path}.lightness`, errors);

  let steps: number | undefined;
  if ('steps' in input && input.steps !== undefined) {
    if (!Number.isInteger(input.steps) || (input.steps as number) < 2) {
      errors.push({
        path: `${path}.steps`,
        message: `expected an integer >= 2, got ${describe(input.steps)}`,
      });
    } else {
      steps = input.steps as number;
    }
  }

  if ('locks' in input && input.locks !== undefined)
    validateLocks(input.locks, steps, `${path}.locks`, errors);

  if ('$extensions' in input && input.$extensions !== undefined && !isRecord(input.$extensions))
    errors.push({
      path: `${path}.$extensions`,
      message: `expected an object keyed by owner, got ${describe(input.$extensions)}`,
    });

  for (const key of Object.keys(input)) {
    if (!FAMILY_KEYS.includes(key))
      errors.push({
        path: `${path}.${key}`,
        message: `unknown field (expected ${FAMILY_KEYS.join(', ')})`,
      });
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as FamilySpec };
}

export function validatePaletteSpec(input: unknown): SpecResult<PaletteSpec> {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        { path: '(root)', message: `expected a palette spec object, got ${describe(input)}` },
      ],
    };
  }

  const errors: SpecError[] = [];

  if ('name' in input && input.name !== undefined && typeof input.name !== 'string')
    errors.push({ path: 'name', message: `expected a string, got ${describe(input.name)}` });

  if ('$version' in input && input.$version !== undefined) {
    if (!Number.isInteger(input.$version) || (input.$version as number) < 1) {
      errors.push({
        path: '$version',
        message: `expected a positive integer, got ${describe(input.$version)}`,
      });
    } else if ((input.$version as number) > CONFIG_VERSION) {
      errors.push({
        path: '$version',
        message: `config format ${input.$version} is newer than this build understands (${CONFIG_VERSION}) — upgrade gosfuig`,
      });
    }
  }

  if ('$extensions' in input && input.$extensions !== undefined && !isRecord(input.$extensions))
    errors.push({
      path: '$extensions',
      message: `expected an object keyed by owner, got ${describe(input.$extensions)}`,
    });

  if ('export' in input && input.export !== undefined)
    validateExport(input.export, 'export', errors);

  if (!Array.isArray(input.families)) {
    errors.push({
      path: 'families',
      message: `expected an array of family specs, got ${describe(input.families)}`,
    });
  } else {
    input.families.forEach((f, i) => {
      const r = validateFamilySpec(f, `families[${i}]`);
      if (!r.ok) errors.push(...r.errors);
    });
  }

  for (const key of Object.keys(input)) {
    if (!PALETTE_KEYS.includes(key))
      errors.push({ path: key, message: `unknown field (expected ${PALETTE_KEYS.join(', ')})` });
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as PaletteSpec };
}

/** Render errors as a multi-line, human-readable block. */
export function formatSpecErrors(errors: SpecError[]): string {
  const head = `gosfuig: invalid palette spec (${errors.length} problem${errors.length === 1 ? '' : 's'})`;
  return [head, ...errors.map((e) => `  ${e.path}: ${e.message}`)].join('\n');
}

/** Validate, or throw a single error carrying every problem found. */
export function parsePaletteSpec(input: unknown): PaletteSpec {
  const r = validatePaletteSpec(input);
  if (!r.ok) throw new Error(formatSpecErrors(r.errors));
  return r.value;
}

/** Short, safe description of an arbitrary value, for error messages. */
function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'function') return 'a function (curves are data now — see CurveSpec)';
  if (typeof v === 'object') return 'an object';
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

export type { CurveSpec };
