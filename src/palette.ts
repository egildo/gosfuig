/** A palette is just a set of families resolved together. */
import { resolveFamily, type Family, type FamilySpec } from './family.js';
import type { W3CExportOptions } from './export/w3c.js';

export interface PaletteSpec {
  name?: string;
  families: FamilySpec[];
  /**
   * How the token file is shaped on the way out: prefix, group and step
   * renames, slug style, flattening, color space. Reshape only — nothing here
   * changes a color, and the engine ignores it entirely.
   *
   * It lives in the config for the same reason curves do: so the studio, the
   * CLI, and a hand-written config all express it the same way.
   */
  export?: W3CExportOptions;
  /**
   * Config format version. Absent means 1. A config declaring a version this
   * build doesn't know is rejected rather than silently half-read.
   */
  $version?: number;
  /**
   * Vendor data, keyed by owner (e.g. `"gosfuig.studio"`). The engine never
   * reads it and never validates its contents; it exists so a front-end can
   * round-trip its own authoring state through the shared config format
   * without inventing a second file. Borrowed from DTCG's `$extensions`.
   */
  $extensions?: Record<string, unknown>;
}

export interface Palette {
  name: string;
  families: Family[];
}

export function resolvePalette(spec: PaletteSpec): Palette {
  return {
    name: spec.name ?? 'palette',
    families: spec.families.map(resolveFamily),
  };
}
