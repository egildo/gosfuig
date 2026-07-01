import { describe, it, expect } from 'vitest';
import { seedFamily, resolveFamily } from '../src/family.js';
import { parse, toHex } from '../src/color/oklch.js';
import { defaultChroma, bumpPeakFor } from '../src/curves.js';
import { STEP_NAMES, STEP_T } from '../src/naming.js';

describe('bumpPeakFor', () => {
  it('inverts bump: the derived peak makes the curve pass through the target', () => {
    for (const t of [0.2, 0.45, 0.6, 0.8]) {
      const peak = bumpPeakFor(0.11, t);
      expect(defaultChroma(peak)(t)).toBeCloseTo(0.11, 10);
    }
  });

  it('returns the value itself at the endpoints (floor-only, peak-independent)', () => {
    expect(bumpPeakFor(0.09, 0)).toBe(0.09);
    expect(bumpPeakFor(0.09, 1)).toBe(0.09);
  });
});

describe('seedFamily', () => {
  const SEED = '#1d4ed8';

  it('pins the seed exactly at its step and marks it locked', () => {
    const fam = resolveFamily(seedFamily({ name: 'brand', seed: SEED, step: '700' }));
    const s = fam.swatches.find((x) => x.name === '700')!;
    expect(s.locked).toBe(true);
    expect(s.hex).toBe(SEED);
  });

  it('defaults the seed to step 500', () => {
    const fam = resolveFamily(seedFamily({ name: 'brand', seed: SEED }));
    expect(fam.swatches.find((x) => x.name === '500')!.locked).toBe(true);
  });

  it('derives the family hue from the seed (neighbors share the seed hue)', () => {
    const seedHue = parse(SEED).h;
    const fam = resolveFamily(seedFamily({ name: 'brand', seed: SEED, step: '700' }));
    for (const s of fam.swatches) {
      // Chromatic steps track the seed hue; near-achromatic ends may drift, so
      // only assert where there is enough chroma for hue to be meaningful.
      if (s.oklch.c > 0.03) expect(s.oklch.h).toBeCloseTo(seedHue, 0);
    }
  });

  it('derives chroma so the ramp passes through the seed chroma at its step', () => {
    const seed = parse(SEED);
    const spec = seedFamily({ name: 'brand', seed: SEED, step: '700' });
    // The derived chroma peak, evaluated at the seed step, reproduces seed chroma.
    const tSeed = STEP_T[STEP_NAMES.indexOf('700')]!;
    expect(defaultChroma(spec.chroma as number)(tSeed)).toBeCloseTo(seed.c, 6);
  });

  it('is NOT desaturated to gray — the seed color survives (the studio bug)', () => {
    // Regression for the old lock-defaults-to-#888888 behavior: a seeded family
    // keeps real chroma at its anchor rather than collapsing to neutral.
    const fam = resolveFamily(seedFamily({ name: 'brand', seed: SEED, step: '700' }));
    const s = fam.swatches.find((x) => x.name === '700')!;
    expect(s.oklch.c).toBeGreaterThan(0.1);
  });

  it('hue torsion still honors the seed hue exactly at the seed step', () => {
    const seedHue = parse(SEED).h;
    const fam = resolveFamily(
      seedFamily({ name: 'brand', seed: SEED, step: '500', hueTorsion: 30 }),
    );
    const anchor = fam.swatches.find((x) => x.name === '500')!;
    expect(anchor.oklch.h).toBeCloseTo(seedHue, 1);
    // Lightest and darkest ends are rotated away from the seed hue.
    const light = fam.swatches[1]!; // '50', chromatic enough to read hue
    const dark = fam.swatches.find((x) => x.name === '800')!;
    expect(light.oklch.h).not.toBeCloseTo(dark.oklch.h, 0);
  });

  it('respects an explicit chroma override', () => {
    const spec = seedFamily({ name: 'brand', seed: SEED, chroma: 0.2 });
    expect(spec.chroma).toBe(0.2);
  });

  it('resolves to a fully displayable family', () => {
    const fam = resolveFamily(seedFamily({ name: 'brand', seed: SEED, step: '700' }));
    for (const s of fam.swatches) expect(s.hex).toBe(toHex(s.oklch));
  });
});
