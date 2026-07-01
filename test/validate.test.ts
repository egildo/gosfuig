import { describe, it, expect } from 'vitest';
import { resolveFamily } from '../src/family.js';
import {
  checkContract,
  contrastMatrix,
  summarizeContract,
  LIGHTEST_4,
  DARKEST_4,
  AA,
} from '../src/validate.js';

describe('checkContract', () => {
  it('passes for a default chromatic family', () => {
    const r = checkContract(resolveFamily({ name: 'green', hue: 150 }));
    expect(r.passes).toBe(true);
    expect(r.failures).toEqual([]);
    // Regression pin: worst contract pair is 700/200 at ~4.78 with defaults.
    expect(r.worst.fg.name).toBe('700');
    expect(r.worst.bg.name).toBe('200');
    expect(r.worst.contrast.wcag).toBeCloseTo(4.78, 1);
  });

  it('fails when a locked brand color breaks the innermost pair', () => {
    const r = checkContract(resolveFamily({ name: 'blue', hue: 259, locks: { '700': '#1d4ed8' } }));
    expect(r.passes).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.worst.fg.name).toBe('700');
    expect(r.worst.bg.name).toBe('200');
    expect(r.worst.contrast.wcag).toBeCloseTo(3.8, 1);
    expect(r.worst.contrast.wcag).toBeLessThan(AA);
  });

  it('only inspects the darkest-4 x lightest-4 region', () => {
    const fam = resolveFamily({ name: 'green', hue: 150 });
    const r = checkContract(fam);
    // Every failure (if any) and the worst pair come from the contract region.
    for (const p of [r.worst, ...r.failures]) {
      expect(DARKEST_4).toContain(p.fg.index);
      expect(LIGHTEST_4).toContain(p.bg.index);
    }
  });

  it('honors custom indices and threshold', () => {
    const fam = resolveFamily({ name: 'green', hue: 150 });
    const r = checkContract(fam, { fgIndices: [11], bgIndices: [0], threshold: 7 });
    expect(r.worst.fg.index).toBe(11);
    expect(r.worst.bg.index).toBe(0);
  });
});

describe('contrastMatrix', () => {
  it('is N x N with a ~1.0 diagonal', () => {
    const fam = resolveFamily({ name: 'blue', hue: 259 });
    const m = contrastMatrix(fam);
    expect(m).toHaveLength(fam.swatches.length);
    for (const row of m) expect(row).toHaveLength(fam.swatches.length);
    for (let i = 0; i < m.length; i++) expect(m[i]![i]!.wcag).toBeCloseTo(1, 5);
  });
});

describe('summarizeContract', () => {
  it('renders PASS/FAIL summaries', () => {
    const pass = summarizeContract(checkContract(resolveFamily({ name: 'green', hue: 150 })));
    expect(pass).toContain('green: PASS');
    const fail = summarizeContract(
      checkContract(resolveFamily({ name: 'blue', hue: 259, locks: { '700': '#1d4ed8' } })),
    );
    expect(fail).toContain('blue: FAIL');
    expect(fail).toContain('below AA');
  });
});
