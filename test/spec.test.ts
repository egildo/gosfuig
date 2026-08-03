import { describe, it, expect } from 'vitest';
import {
  compile,
  isCurveSpec,
  constant,
  linear,
  gamma,
  hueRamp,
  ramp,
  bump,
  defaultLightness,
  defaultChroma,
  defaultLightnessSpec,
  defaultChromaSpec,
  type CurveSpec,
} from '../src/curves.js';
import { resolveFamily, seedFamily } from '../src/family.js';
import { resolvePalette } from '../src/palette.js';
import { validatePaletteSpec, validateFamilySpec, parsePaletteSpec } from '../src/spec.js';

const SAMPLES = [0, 0.1, 0.25, 0.5, 0.6, 0.75, 0.9, 1];
const agree = (a: (t: number) => number, b: (t: number) => number) => {
  for (const t of SAMPLES) expect(b(t)).toBeCloseTo(a(t), 12);
};

describe('compile', () => {
  it('reproduces each builder exactly', () => {
    agree(constant(5), compile({ kind: 'constant', value: 5 }));
    agree(linear(0, 10), compile({ kind: 'linear', from: 0, to: 10 }));
    agree(gamma(0, 1, 2), compile({ kind: 'gamma', from: 0, to: 1, gamma: 2 }));
    agree(hueRamp(200, 260), compile({ kind: 'hueRamp', start: 200, end: 260 }));
    agree(
      ramp({ max: 0.98, min: 0.18, gamma: 1.2, sCurve: 0.2 }),
      compile({ kind: 'ramp', max: 0.98, min: 0.18, gamma: 1.2, sCurve: 0.2 }),
    );
    agree(
      bump({ peak: 0.14, tPeak: 0.5, light: 0.03, dark: 0.04 }),
      compile({ kind: 'bump', peak: 0.14, tPeak: 0.5, light: 0.03, dark: 0.04 }),
    );
  });

  it('applies builder defaults when optional fields are omitted', () => {
    agree(gamma(0, 1), compile({ kind: 'gamma', from: 0, to: 1 }));
    agree(ramp({ max: 1, min: 0 }), compile({ kind: 'ramp', max: 1, min: 0 }));
    agree(bump({ peak: 0.14 }), compile({ kind: 'bump', peak: 0.14 }));
  });

  it('gives the documented defaults a data form that matches the closure form', () => {
    agree(defaultLightness(), compile(defaultLightnessSpec()));
    agree(defaultChroma(0.14), compile(defaultChromaSpec(0.14)));
    agree(defaultChroma(0.2), compile(defaultChromaSpec(0.2)));
  });
});

describe('isCurveSpec', () => {
  it('distinguishes a curve spec from a plain number and from junk', () => {
    expect(isCurveSpec({ kind: 'ramp', max: 1, min: 0 })).toBe(true);
    expect(isCurveSpec(0.14)).toBe(false);
    expect(isCurveSpec(undefined)).toBe(false);
    expect(isCurveSpec(null)).toBe(false);
    expect(isCurveSpec({ kind: 'smoothstep' })).toBe(false);
    expect(isCurveSpec(() => 1)).toBe(false);
  });
});

describe('specs survive a JSON round trip', () => {
  const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  it('holds for every curve kind', () => {
    const specs: CurveSpec[] = [
      { kind: 'constant', value: 259 },
      { kind: 'linear', from: 0, to: 1 },
      { kind: 'gamma', from: 0.98, to: 0.18, gamma: 1.4 },
      { kind: 'hueRamp', start: 240, end: 280 },
      { kind: 'ramp', max: 0.98, min: 0.18, gamma: 1, sCurve: 0.13 },
      { kind: 'bump', peak: 0.14, tPeak: 0.6, light: 0.025, dark: 0.05 },
    ];
    for (const s of specs) {
      expect(roundTrip(s)).toEqual(s);
      agree(compile(s), compile(roundTrip(s)));
    }
  });

  it('holds for a seedFamily spec, torsion included', () => {
    const spec = seedFamily({ name: 'brand', seed: '#1d4ed8', step: '700', hueTorsion: 24 });
    expect(roundTrip(spec)).toEqual(spec);
    expect(resolveFamily(roundTrip(spec)).swatches.map((s) => s.hex)).toEqual(
      resolveFamily(spec).swatches.map((s) => s.hex),
    );
  });

  it('holds for a whole palette spec, and resolves identically', () => {
    const spec = {
      name: 'round trip',
      families: [
        { name: 'blue', hue: 259, locks: { '700': '#1d4ed8' } },
        {
          name: 'custom',
          hue: { kind: 'hueRamp', start: 140, end: 170 } as CurveSpec,
          chroma: { kind: 'bump', peak: 0.12, tPeak: 0.45 } as CurveSpec,
          lightness: { kind: 'ramp', max: 0.97, min: 0.2, sCurve: 0.2 } as CurveSpec,
          steps: 9,
        },
        seedFamily({ name: 'brand', seed: '#e11d48', step: '500' }),
      ],
    };
    expect(roundTrip(spec)).toEqual(spec);

    const before = resolvePalette(spec);
    const after = resolvePalette(parsePaletteSpec(roundTrip(spec)));
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

describe('validateFamilySpec', () => {
  const errs = (input: unknown) => {
    const r = validateFamilySpec(input);
    return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`);
  };

  it('accepts the shapes the engine actually supports', () => {
    expect(validateFamilySpec({ name: 'b', hue: 259 }).ok).toBe(true);
    expect(validateFamilySpec({ name: 'b', hue: 259, chroma: 0.01 }).ok).toBe(true);
    expect(
      validateFamilySpec({
        name: 'b',
        hue: { kind: 'hueRamp', start: 240, end: 280 },
        lightness: { kind: 'ramp', max: 0.98, min: 0.18 },
        steps: 8,
        // The 8-step ladder is 50 200 300 450 550 700 800 950 — not 25..950.
        locks: { '450': '#1d4ed8', 0: { l: 0.98, c: 0.01, h: 259 } },
      }).ok,
    ).toBe(true);
  });

  it('reports a missing hue', () => {
    expect(errs({ name: 'b' })).toContainEqual(
      expect.stringContaining('family.hue: missing (required)'),
    );
  });

  it('reports a missing or blank name', () => {
    expect(errs({ hue: 259 })).toContainEqual(
      expect.stringContaining('family.name: expected a non-empty string'),
    );
    expect(errs({ name: '  ', hue: 259 })).toContainEqual(
      expect.stringContaining('family.name: expected a non-empty string'),
    );
  });

  it('reports an unknown curve kind and lists the valid ones', () => {
    const e = errs({ name: 'b', hue: 259, lightness: { kind: 'smoothstep', max: 1, min: 0 } });
    expect(e.join('\n')).toContain('family.lightness.kind');
    expect(e.join('\n')).toContain('smoothstep');
    expect(e.join('\n')).toContain('ramp');
  });

  it('reports a missing required field of a curve kind', () => {
    expect(errs({ name: 'b', hue: 259, lightness: { kind: 'ramp', max: 0.98 } })).toContainEqual(
      expect.stringContaining('family.lightness.min: missing'),
    );
  });

  it('reports unknown fields rather than silently ignoring a typo', () => {
    expect(
      errs({ name: 'b', hue: 259, lightnes: { kind: 'ramp', max: 1, min: 0 } }),
    ).toContainEqual(expect.stringContaining('family.lightnes: unknown field'));
    expect(
      errs({ name: 'b', hue: 259, lightness: { kind: 'ramp', max: 1, min: 0, peak: 3 } }),
    ).toContainEqual(expect.stringContaining('family.lightness.peak: unknown field'));
  });

  it('names a function for what it is, since curves are data now', () => {
    expect(errs({ name: 'b', hue: 259, lightness: () => 0.5 }).join('\n')).toContain('CurveSpec');
  });

  it('rejects a bad step count and out-of-scale lock keys', () => {
    expect(errs({ name: 'b', hue: 259, steps: 1 })).toContainEqual(
      expect.stringContaining('family.steps: expected an integer >= 2'),
    );
    // 450 is on neither the 12-step scale nor the 9-step ladder
    // (50 150 300 400 500 600 750 850 950), so it is rejected against both.
    expect(errs({ name: 'b', hue: 259, locks: { '450': '#fff' } })).toContainEqual(
      expect.stringContaining('family.locks.450: not a step'),
    );
    expect(validateFamilySpec({ name: 'b', hue: 259, steps: 9, locks: { '450': '#fff' } }).ok).toBe(
      false,
    );
    // 300 is on both, and a raw index is always accepted.
    expect(validateFamilySpec({ name: 'b', hue: 259, steps: 9, locks: { '300': '#fff' } }).ok).toBe(
      true,
    );
    expect(validateFamilySpec({ name: 'b', hue: 259, steps: 9, locks: { 8: '#fff' } }).ok).toBe(
      true,
    );
    expect(errs({ name: 'b', hue: 259, steps: 9, locks: { 9: '#fff' } })).toContainEqual(
      expect.stringContaining('family.locks.9: not a step'),
    );
  });

  it('rejects an unparseable lock color', () => {
    expect(errs({ name: 'b', hue: 259, locks: { '500': 'not-a-color' } })).toContainEqual(
      expect.stringContaining('cannot parse color'),
    );
  });

  it('rejects a negative chroma', () => {
    expect(errs({ name: 'b', hue: 259, chroma: -0.1 })).toContainEqual(
      expect.stringContaining('family.chroma: expected a number >= 0'),
    );
  });
});

describe('validatePaletteSpec', () => {
  it('accepts a well-formed palette', () => {
    expect(validatePaletteSpec({ name: 'p', families: [{ name: 'b', hue: 259 }] }).ok).toBe(true);
    expect(validatePaletteSpec({ families: [] }).ok).toBe(true);
  });

  it('rejects non-objects and a missing families array', () => {
    expect(validatePaletteSpec(null).ok).toBe(false);
    expect(validatePaletteSpec([]).ok).toBe(false);
    expect(validatePaletteSpec('nope').ok).toBe(false);
    const r = validatePaletteSpec({ name: 'p' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.path).toBe('families');
  });

  it('indexes errors to the offending family', () => {
    const r = validatePaletteSpec({
      families: [{ name: 'ok', hue: 1 }, { name: 'bad' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path)).toEqual(['families[1].hue']);
  });

  it('collects every problem rather than stopping at the first', () => {
    const r = validatePaletteSpec({
      families: [{ name: '', hue: 'blue', steps: 0 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('parsePaletteSpec', () => {
  it('returns the spec when valid', () => {
    const spec = { families: [{ name: 'b', hue: 259 }] };
    expect(parsePaletteSpec(spec)).toEqual(spec);
  });

  it('throws one error naming every problem and its path', () => {
    let message = '';
    try {
      parsePaletteSpec({ families: [{ name: 'b', hue: 259, lightness: { kind: 'nope' } }] });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('invalid palette spec');
    expect(message).toContain('families[0].lightness.kind');
    // Crucially: not a TypeError from inside the engine.
    expect(message).not.toContain('is not a function');
  });
});
