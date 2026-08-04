/**
 * The config file: one format, three producers (studio, CLI, hand-authoring)
 * and three consumers (the same three).
 *
 * A config *is* a PaletteSpec in JSON. Since Phase 1 made curves data, there is
 * nothing in a spec that JSON cannot carry, so this module is deliberately thin
 * — it is a serializer and a parser, not a second schema. What it adds is the
 * things a file needs that an in-memory object doesn't: a declared version, a
 * stable key order so diffs are readable, and errors that name the file.
 *
 * Front-end authoring state (which family was in "seed" mode, whether chroma
 * was auto) lives under `$extensions`, so the studio can restore a session
 * exactly while the CLI reads the same file and ignores what it doesn't own.
 */
import { CONFIG_VERSION, parsePaletteSpec } from './spec.js';
import type { PaletteSpec } from './palette.js';
import type { FamilySpec } from './family.js';

export { CONFIG_VERSION };

/** Key order in the emitted file: identity first, then the ramp, then locks. */
const FAMILY_ORDER = [
  'name',
  'hue',
  'chroma',
  'lightness',
  'steps',
  'colors',
  'locks',
  '$extensions',
] as const;

/** Reorder an object's keys, dropping undefined values. */
function ordered<T extends object>(o: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (o as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  // Anything not in the order list keeps its original position, at the end.
  for (const [k, v] of Object.entries(o)) {
    if (!keys.includes(k) && v !== undefined) out[k] = v;
  }
  return out as T;
}

/**
 * Normalize a spec into its on-disk shape: version stamped, keys in a stable
 * order, `undefined` fields dropped. Resolving the result is identical to
 * resolving the input — this only touches presentation.
 */
export function normalizeConfig(spec: PaletteSpec): PaletteSpec {
  return ordered(
    {
      $version: spec.$version ?? CONFIG_VERSION,
      name: spec.name,
      export: spec.export,
      families: spec.families.map((f) => ordered(f, FAMILY_ORDER) as FamilySpec),
      $extensions: spec.$extensions,
    },
    ['$version', 'name', 'export', 'families', '$extensions'],
  );
}

/** Serialize a spec to the config file text (trailing newline included). */
export function stringifyConfig(spec: PaletteSpec, indent = 2): string {
  return JSON.stringify(normalizeConfig(spec), null, indent) + '\n';
}

/**
 * Parse config file text into a validated PaletteSpec. `label` names the source
 * in error messages (a path, a filename, "pasted config").
 */
export function parseConfig(text: string, label = 'config'): PaletteSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`gosfuig: ${label} is not valid JSON — ${(err as Error).message}`);
  }
  return parsePaletteSpec(raw);
}

/** Read one owner's slice of a spec's `$extensions`, or undefined. */
export function readExtension<T>(spec: PaletteSpec, owner: string): T | undefined {
  const ext = spec.$extensions?.[owner];
  return ext === undefined ? undefined : (ext as T);
}

/** Return a copy of `spec` carrying `data` under `owner` in `$extensions`. */
export function withExtension(spec: PaletteSpec, owner: string, data: unknown): PaletteSpec {
  return { ...spec, $extensions: { ...spec.$extensions, [owner]: data } };
}
