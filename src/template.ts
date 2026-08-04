/**
 * Templates: the reusable half of a palette, saved under a name.
 *
 * Take any config apart and the fields fall into two piles. The brand's own
 * colors, and which families exist — that is the branding book, different for
 * every client. The lightness curves, the step count, the chroma shape, the
 * export block — that is house style, identical across every palette you will
 * ever make. Interleaving them per-family is why there has been nothing to
 * reuse.
 *
 * A template is the second pile with a name on it. It is not a second file
 * format: it resolves INTO a PaletteSpec, and `--emit-config` writes the merged
 * result, so a project that used a template can always be frozen into a config
 * that stands on its own.
 *
 * Precedence is the ordinary cascade — a config beats the template it names,
 * because a config is the more specific instruction. The studio applies a
 * template differently: as a visible edit to the families, since a studio
 * family always carries explicit curves and a silent base would never show.
 */
import type { CurveSpec } from './curves.js';
import type { PaletteSpec } from './palette.js';
import type { FamilySpec } from './family.js';
import type { W3CExportOptions } from './export/w3c.js';

export interface Template {
  /** Identifier used by `--template` and the studio's preset list. */
  name: string;
  /** One line on what this house style is for. */
  description?: string;
  /** Step count applied to families that don't set their own. */
  steps?: number;
  /** Lightness ramp applied to families that don't set their own. */
  lightness?: CurveSpec;
  /**
   * Chroma policy applied to families that don't set their own.
   *
   * Usually left out. A seed-driven family derives its chroma peak from the
   * brand color, and forcing a peak here would overwrite exactly the thing the
   * brand is supplying. Set it only for a genuinely house-wide chroma shape.
   */
  chroma?: number | CurveSpec;
  /** Token shape, used when the config declares no `export` block of its own. */
  export?: W3CExportOptions;
}

/**
 * The templates that ship with gosfuig.
 *
 * Deliberately few and genuinely different. `contrast` exists because the
 * default `sCurve` of 0.13 clears the contract at 12 steps with little margin,
 * and any other step count can fall below it — a stronger S-curve buys the
 * margin back at the cost of crushing the tints and shades together slightly.
 */
export const BUILTIN_TEMPLATES: Template[] = [
  {
    name: 'default',
    description: 'The shipped defaults: 12 steps, gentle S-curve, kebab token names.',
    steps: 12,
    lightness: { kind: 'ramp', max: 0.98, min: 0.18, gamma: 1, sCurve: 0.13 },
  },
  {
    name: 'contrast',
    description: 'Stronger S-curve, for palettes that must clear AA with room to spare.',
    steps: 12,
    lightness: { kind: 'ramp', max: 0.985, min: 0.15, gamma: 1, sCurve: 0.3 },
  },
  {
    name: 'flat',
    description: 'Linear lightness, no S-curve — evenly spaced steps, tighter contrast.',
    steps: 12,
    lightness: { kind: 'ramp', max: 0.97, min: 0.2, gamma: 1, sCurve: 0 },
  },
  {
    name: 'fine',
    description: '16 steps on a wider range, for systems that want finer tonal control.',
    steps: 16,
    lightness: { kind: 'ramp', max: 0.99, min: 0.14, gamma: 1, sCurve: 0.18 },
  },
];

export function findTemplate(name: string, extra: Template[] = []): Template | undefined {
  return [...extra, ...BUILTIN_TEMPLATES].find((t) => t.name === name);
}

/** Names of every template available, for help text and error messages. */
export function templateNames(extra: Template[] = []): string[] {
  return [...new Set([...extra, ...BUILTIN_TEMPLATES].map((t) => t.name))];
}

/**
 * Resolve a template into a spec: the template is the base, the spec wins.
 *
 * Only fills what the spec left unsaid. A family that declares its own
 * lightness keeps it; a config with its own `export` block keeps that. The
 * result is a plain PaletteSpec with no memory of where the values came from,
 * which is what makes `--emit-config` produce something self-contained.
 */
export function applyTemplate(spec: PaletteSpec, template: Template): PaletteSpec {
  const families = spec.families.map((f): FamilySpec => {
    const out: FamilySpec = { ...f };
    if (out.steps === undefined && template.steps !== undefined) out.steps = template.steps;
    if (out.lightness === undefined && template.lightness !== undefined)
      out.lightness = template.lightness;
    if (out.chroma === undefined && template.chroma !== undefined) out.chroma = template.chroma;
    return out;
  });

  return {
    ...spec,
    families,
    ...(spec.export === undefined && template.export !== undefined
      ? { export: template.export }
      : {}),
  };
}

/**
 * Overwrite a spec's policy with a template's, rather than filling gaps.
 *
 * This is what "apply this house style" means when the palette already has
 * curves — the studio's case, where every family carries explicit values and
 * `applyTemplate` would therefore do nothing at all.
 */
export function forceTemplate(spec: PaletteSpec, template: Template): PaletteSpec {
  const families = spec.families.map((f): FamilySpec => ({
    ...f,
    ...(template.steps !== undefined ? { steps: template.steps } : {}),
    ...(template.lightness !== undefined ? { lightness: template.lightness } : {}),
    ...(template.chroma !== undefined ? { chroma: template.chroma } : {}),
  }));
  return {
    ...spec,
    families,
    ...(template.export !== undefined ? { export: template.export } : {}),
  };
}

const TEMPLATE_KEYS = ['name', 'description', 'steps', 'lightness', 'chroma', 'export'];

/** Structural check for a template read from a file or from storage. */
export function isTemplate(v: unknown): v is Template {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  if (typeof t.name !== 'string' || t.name.trim() === '') return false;
  return Object.keys(t).every((k) => TEMPLATE_KEYS.includes(k));
}
