/**
 * Aliases: a second way to point at a named colour in the token file.
 *
 * `green.600` is where the colour lives on the ramp. `brand-green` is what a
 * developer types. DTCG already has the mechanism — a token whose `$value` is
 * `"{group.token}"` — so an alias is a pointer, not a copy, and the two cannot
 * drift apart.
 *
 * This is the one thing the emission layer does that isn't pure reshape: an
 * alias is a token that was not in the ramp.
 */
import { describe, it, expect } from 'vitest';
import { resolvePalette } from '../src/palette.js';
import { toW3CTokens } from '../src/export/w3c.js';
import { referenceFor } from '../src/export/shape.js';
import { resolveFamily, seedFamily } from '../src/family.js';
import { validateFamilySpec, validatePaletteSpec } from '../src/spec.js';
import { stringifyConfig, parseConfig } from '../src/config.js';
import { fromConfig, toSpec } from '../src/studio/model.js';

const BRAND = {
  families: [
    {
      name: 'green',
      hue: 150,
      colors: [{ name: 'Acme Forest Green', alias: 'brand green', value: '#0f7b4a', step: '600' }],
    },
    {
      name: 'signal blue',
      hue: 259,
      colors: [{ name: 'Acme Signal Blue', alias: 'brand blue', value: '#3b82f6', step: '500' }],
    },
  ],
};

const tokens = (opts = {}) =>
  toW3CTokens(resolvePalette(BRAND), { colorSpace: 'srgb', ...opts }) as Record<string, any>;

describe('an alias points at the colour', () => {
  it('emits a DTCG reference, flat at the root', () => {
    const t = tokens();
    expect(t['brand-green']).toEqual({ $type: 'color', $value: '{green.600}' });
    expect(t['brand-blue']).toEqual({ $type: 'color', $value: '{signal-blue.500}' });
  });

  it('points at a real token, not a made-up path', () => {
    const t = tokens();
    const path = t['brand-green'].$value.slice(1, -1).split('.');
    expect(t[path[0]!][path[1]!].$value).toBe('#0f7b4a');
  });

  it('is slugged like everything else', () => {
    expect(Object.keys(tokens())).toContain('brand-green');
    expect(Object.keys(tokens({ slug: 'camel' }))).toContain('brandGreen');
    expect(Object.keys(tokens({ slug: 'snake' }))).toContain('brand_green');
  });

  it('does not disturb the ramp it names', () => {
    const withAlias = tokens();
    const without = tokens({ aliases: 'off' });
    expect(withAlias.green).toEqual(without.green);
    expect(without['brand-green']).toBeUndefined();
  });

  it('appears only where an alias was authored', () => {
    const plain = toW3CTokens(
      resolvePalette({ families: [{ name: 'green', hue: 150, locks: { '600': '#0f7b4a' } }] }),
    );
    // A lock has no alias, so nothing is invented.
    expect(Object.keys(plain)).toEqual(['green']);
  });
});

describe('the reference follows the shaped path', () => {
  it('picks up a prefix and a group rename', () => {
    const t = tokens({ prefix: 'color', groups: { 'signal blue': 'brand' } });
    expect(t.color.brand['500'].$value).toBe('#3b82f6');
    expect(t['brand-blue'].$value).toBe('{color.brand.500}');
  });

  it('picks up a step rename', () => {
    const t = tokens({ steps: { '600': 'base' } });
    expect(t['brand-green'].$value).toBe('{green.base}');
  });

  it('uses the joined key when the tree is flattened', () => {
    const t = tokens({ flatten: true });
    expect(t['brand-blue'].$value).toBe('{signal-blue-500}');
    expect(t['signal-blue-500']).toBeDefined();
  });

  it('stays at the root even under a prefix — an alias is not part of the ramp', () => {
    const t = tokens({ prefix: 'color' });
    expect(t['brand-green']).toBeDefined();
    expect(t.color['brand-green']).toBeUndefined();
  });

  it('referenceFor agrees with what the exporter emits', () => {
    expect(referenceFor(['color', 'brand', '500'])).toBe('{color.brand.500}');
    expect(referenceFor(['a', 'b'], { flatten: true })).toBe('{a-b}');
    expect(referenceFor(['a', 'b'], { flatten: true, separator: '.' })).toBe('{a.b}');
  });
});

describe('alias modes', () => {
  it('inline duplicates the colour for consumers that cannot resolve references', () => {
    const t = tokens({ aliases: 'inline' });
    expect(t['brand-green']).toEqual({ $type: 'color', $value: '#0f7b4a' });
    expect(t['brand-green'].$value).toBe(t.green['600'].$value);
  });

  it('inline carries the oklch form too', () => {
    const t = toW3CTokens(resolvePalette(BRAND), { aliases: 'inline' }) as Record<string, any>;
    expect(t['brand-green'].$value.colorSpace).toBe('oklch');
  });

  it('off omits them entirely', () => {
    expect(Object.keys(tokens({ aliases: 'off' }))).toEqual(['green', 'signal-blue']);
  });

  it('reference is the default', () => {
    expect(tokens()['brand-green']).toEqual(tokens({ aliases: 'reference' })['brand-green']);
  });
});

describe('collisions are refused, never merged', () => {
  it('refuses an alias that collides with a family group', () => {
    const spec = {
      families: [
        { name: 'green', hue: 150 },
        { name: 'blue', hue: 259, colors: [{ alias: 'green', value: '#3b82f6', step: '500' }] },
      ],
    };
    expect(() => toW3CTokens(resolvePalette(spec))).toThrow(/already a token group/);
  });

  it('refuses two colours claiming the same alias', () => {
    const spec = {
      families: [
        { name: 'a', hue: 150, colors: [{ alias: 'brand', value: '#0f7b4a', step: '600' }] },
        { name: 'b', hue: 259, colors: [{ alias: 'brand', value: '#3b82f6', step: '500' }] },
      ],
    };
    expect(() => toW3CTokens(resolvePalette(spec))).toThrow(/both emit the alias/);
  });

  it('names both offenders so you know what to rename', () => {
    const spec = {
      families: [
        { name: 'a', hue: 150, colors: [{ alias: 'brand', value: '#0f7b4a', step: '600' }] },
        { name: 'b', hue: 259, colors: [{ alias: 'Brand', value: '#3b82f6', step: '500' }] },
      ],
    };
    expect(() => toW3CTokens(resolvePalette(spec))).toThrow(/a\.600.*b\.500|b\.500.*a\.600/);
  });
});

describe('aliases in a config', () => {
  it('validate as a non-empty string', () => {
    expect(
      validateFamilySpec({ name: 'g', hue: 150, colors: [{ alias: 'brand green', value: '#fff' }] })
        .ok,
    ).toBe(true);

    const r = validateFamilySpec({ name: 'g', hue: 150, colors: [{ alias: '  ', value: '#fff' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.path).toBe('family.colors[0].alias');
  });

  it('validate the export mode', () => {
    expect(validatePaletteSpec({ families: [], export: { aliases: 'inline' } }).ok).toBe(true);
    const r = validatePaletteSpec({ families: [], export: { aliases: 'yes please' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.path).toBe('export.aliases');
  });

  it('survive the config round trip', () => {
    const back = parseConfig(stringifyConfig(BRAND));
    expect(back.families[0]!.colors).toEqual(BRAND.families[0]!.colors);
  });
});

describe('the alias reaches the swatch and the studio', () => {
  it('lands on the swatch it names', () => {
    const fam = resolveFamily(BRAND.families[0]!);
    const pinned = fam.swatches.find((s) => s.locked)!;
    expect(pinned.alias).toBe('brand green');
    expect(pinned.colorName).toBe('Acme Forest Green');
    for (const s of fam.swatches) if (!s.locked) expect(s.alias).toBeUndefined();
  });

  it('seedFamily carries one when given one', () => {
    const spec = seedFamily({ name: 'brand', seed: '#0f7b4a', colorAlias: 'brand green' });
    expect(spec.colors?.[0]!.alias).toBe('brand green');
    expect(resolveFamily(spec).swatches.find((s) => s.locked)!.alias).toBe('brand green');
  });

  it('survives a trip through studio state', () => {
    const session = fromConfig(parseConfig(stringifyConfig(BRAND)));
    expect(session.families[0]!.seedAlias).toBe('brand green');

    const back = toSpec(session.families[0]!, session.steps);
    expect(back.colors?.[0]!.alias).toBe('brand green');
    expect(resolveFamily(back).swatches.find((s) => s.locked)!.alias).toBe('brand green');
  });
});
