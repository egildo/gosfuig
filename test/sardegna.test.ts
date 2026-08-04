/**
 * Palette Sardegna — the worked example, held to its source data.
 *
 * Twelve families, each named for a place and anchored to a verified Pantone.
 * The reference hexes below come from the palette document, not from gosfuig,
 * which is the point: if the engine ever stops delivering a brand colour
 * exactly, this fails against the branding book rather than against itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolvePalette } from '../src/palette.js';
import { parseConfig } from '../src/config.js';
import { applyTemplate, isTemplate } from '../src/template.js';
import { toW3CTokens } from '../src/export/w3c.js';
import { checkContract, summarizeNotes, STRAIN_LIGHTNESS } from '../src/validate.js';

const config = parseConfig(
  readFileSync('examples/sardegna.config.json', 'utf8'),
  'sardegna.config',
);
const templateRaw: unknown = JSON.parse(readFileSync('examples/sardegna.template.json', 'utf8'));
if (!isTemplate(templateRaw)) throw new Error('sardegna.template.json is not a template');
/** The config with the house style resolved in — what the CLI actually runs. */
const merged = applyTemplate(config, templateRaw);
const palette = resolvePalette(merged);

/** name -> the Pantone-derived hex from the palette document. */
const REFERENCE: Record<string, string> = {
  'Busachi Red': '#da291c', // 485 C
  'Monreale Yellow': '#fedd00', // Yellow C
  'Carbonia Black': '#101820', // Black 6 C
  'Bosa Magenta': '#d62598', // Pink C
  'Goloritzè Teal': '#008578', // 3282 C
  'Chia Orange': '#de7c00', // 138 C
  'La Pelosa Pink': '#ffb0b7', // 176 C
  'La Maddalena Blue': '#1b365d', // 534 C
  'Bovale Purple': '#3c1053', // 2627 C
  'Murta Green': '#546223', // 371 C
  'Murdegu White': '#f8f7f2', // P 1-1 C
  'Nuragus Lime': '#c4d601', // 382 C — see the note below
};

const named = () =>
  palette.families.map((f) => {
    const pinned = f.swatches.find((s) => s.locked);
    if (!pinned) throw new Error(`${f.name} has no named colour`);
    return pinned;
  });

describe('the palette itself', () => {
  it('has the twelve families the document lists', () => {
    expect(palette.families).toHaveLength(12);
    expect(palette.name).toBe('Palette Sardegna');
  });

  it('gives every family exactly one named colour', () => {
    for (const f of palette.families) {
      expect(
        f.swatches.filter((s) => s.locked),
        f.name,
      ).toHaveLength(1);
    }
  });

  it('delivers every brand colour at its reference hex', () => {
    for (const s of named()) {
      expect(s.colorName).toBeDefined();
      expect(s.hex, s.colorName).toBe(REFERENCE[s.colorName!]);
    }
  });

  /**
   * The one place the source document disagrees with itself. Nuragus Lime's
   * OKLCH — oklch(0.834 0.190 115.7) — renders as #c4d601, while the table's
   * indicative hex reads #c4d600: one step of blue, from rounding chroma to
   * three decimals. The OKLCH is the anchor (it is derived from the verified
   * Pantone 382 C RGB), so gosfuig follows it and this records the divergence.
   */
  it('follows the OKLCH anchor where the indicative hex differs by a byte', () => {
    const lime = named().find((s) => s.colorName === 'Nuragus Lime')!;
    expect(lime.hex).toBe('#c4d601');
    expect(lime.hex).not.toBe('#c4d600');
  });

  it('passes the contract in every family', () => {
    for (const f of palette.families) {
      expect(checkContract(f).passes, f.name).toBe(true);
    }
  });

  it('keeps every ramp monotone in lightness', () => {
    for (const f of palette.families) expect(f.monotone, f.name).toBe(true);
  });

  /**
   * Every family threads its own hue ramp exactly through its colour, so no
   * colour has to drag the hue at all. Lightness is a different matter: the
   * steps here are chosen deliberately rather than fitted, so a colour may sit
   * well away from where its curve would have put it. That is an authoring
   * decision, and the ramps stay monotone and pass the contract regardless —
   * which is why this asserts the hue invariant and merely records the rest.
   */
  it('needs no hue correction at any named colour', () => {
    for (const s of named()) {
      expect(Math.abs(s.pull!.h), s.colorName).toBeLessThan(0.001);
    }
  });

  it('reports the lightness a deliberately placed colour costs its curve', () => {
    const pulled = named().filter((s) => Math.abs(s.pull!.l) >= STRAIN_LIGHTNESS);
    // Several colours sit away from their curve's natural lightness, and the
    // strain report is what makes that visible rather than silent.
    expect(pulled.length).toBeGreaterThan(0);
    for (const s of pulled) {
      const family = palette.families.find((f) => f.swatches.includes(s))!;
      expect(summarizeNotes(family), s.colorName).toContain('pulls the ramp');
    }
  });
});

describe('the emitted tokens', () => {
  // The export block rides on the spec, not the palette, exactly as the CLI
  // passes it — so this exercises the template's prefix and alias mode too.
  const tokens = toW3CTokens(palette, { ...merged.export, colorSpace: 'srgb' }) as Record<
    string,
    any
  >;

  it('nests the ramps under the prefix the template sets', () => {
    expect(tokens.color).toBeDefined();
    expect(Object.keys(tokens.color)).toContain('busachi-red');
    expect(Object.keys(tokens.color)).toHaveLength(12);
  });

  it('gives every family a generic alias at the root', () => {
    // Read the aliases from the palette rather than repeating them here: the
    // config is the source of truth, and this should follow a rename, not
    // fight it.
    const aliases = named().map((s) => s.alias);
    expect(aliases.filter(Boolean)).toHaveLength(12);
    expect(new Set(aliases).size, 'aliases must be unique').toBe(12);
    for (const a of aliases) expect(Object.keys(tokens), a).toContain(a);
  });

  it('resolves every alias, through its reference, to that colour’s hex', () => {
    for (const swatch of named()) {
      const alias = swatch.alias!;
      const ref = tokens[alias]?.$value as string | undefined;
      expect(ref, alias).toMatch(/^\{.+\}$/);

      // Walk the DTCG reference to the token it points at, and check it is the
      // brand colour — the whole chain, not just that the alias exists.
      const target = ref!
        .slice(1, -1)
        .split('.')
        .reduce<any>((node, key) => node?.[key], tokens);
      expect(target?.$value, alias).toBe(REFERENCE[swatch.colorName!]);
    }
  });
});
