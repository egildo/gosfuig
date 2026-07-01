import { describe, it, expect } from 'vitest';
import { resolveFamily } from '../src/family.js';
import { toHex, parse } from '../src/color/oklch.js';
import { STEP_NAMES } from '../src/naming.js';

describe('resolveFamily', () => {
  it('produces one swatch per step name, in order', () => {
    const fam = resolveFamily({ name: 'blue', hue: 259 });
    expect(fam.swatches.map((s) => s.name)).toEqual([...STEP_NAMES]);
    expect(fam.swatches).toHaveLength(STEP_NAMES.length);
  });

  it('assigns t from 0 (lightest) to 1 (darkest)', () => {
    const fam = resolveFamily({ name: 'blue', hue: 259 });
    expect(fam.swatches[0]!.t).toBe(0);
    expect(fam.swatches.at(-1)!.t).toBe(1);
  });

  it('is monotone (lightness strictly decreasing) by default', () => {
    const fam = resolveFamily({ name: 'green', hue: 150 });
    expect(fam.monotone).toBe(true);
    expect(fam.monotoneBreaks).toEqual([]);
    for (let i = 1; i < fam.swatches.length; i++) {
      expect(fam.swatches[i]!.oklch.l).toBeLessThan(fam.swatches[i - 1]!.oklch.l);
    }
  });

  it('every swatch is displayable (gamut-mapped)', () => {
    const fam = resolveFamily({ name: 'amber', hue: 75, chroma: 0.16 });
    for (const s of fam.swatches) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('pins a locked step to its exact color and marks it locked', () => {
    const fam = resolveFamily({ name: 'blue', hue: 259, locks: { '700': '#1d4ed8' } });
    const s = fam.swatches.find((x) => x.name === '700')!;
    expect(s.locked).toBe(true);
    expect(s.hex).toBe('#1d4ed8');
    const want = parse('#1d4ed8');
    expect(s.oklch.l).toBeCloseTo(want.l, 3);
    expect(s.oklch.h).toBeCloseTo(want.h, 1);
  });

  it('treats a numeric lock index the same as its step name', () => {
    const byName = resolveFamily({ name: 'b', hue: 259, locks: { '700': '#1d4ed8' } });
    const byIndex = resolveFamily({ name: 'b', hue: 259, locks: { 8: '#1d4ed8' } });
    expect(byIndex.swatches.map((s) => s.hex)).toEqual(byName.swatches.map((s) => s.hex));
  });

  it('flags a monotonicity break when a lock inverts lightness order', () => {
    // Lock a light step to something very dark -> breaks the decreasing order.
    const fam = resolveFamily({ name: 'x', hue: 200, locks: { '100': '#000000' } });
    expect(fam.monotone).toBe(false);
    expect(fam.monotoneBreaks.length).toBeGreaterThan(0);
  });

  it('reflects the hex/css derived from the stored oklch', () => {
    const fam = resolveFamily({ name: 'blue', hue: 259 });
    for (const s of fam.swatches) {
      expect(s.hex).toBe(toHex(s.oklch));
      expect(s.css).toMatch(/^oklch\(/);
    }
  });
});
