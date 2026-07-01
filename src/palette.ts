/** A palette is just a set of families resolved together. */
import { resolveFamily, type Family, type FamilySpec } from './family.js';

export interface PaletteSpec {
  name?: string;
  families: FamilySpec[];
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
