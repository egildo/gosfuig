import { describe, it, expect } from 'vitest';
import { makeScale, STEP_NAMES, STEP_COUNT } from '../src/naming.js';
import { resolveFamily, seedFamily } from '../src/family.js';
import { checkContract, contractRegion } from '../src/validate.js';

describe('makeScale', () => {
  it('reproduces the canonical names/positions at the default count', () => {
    const s = makeScale(STEP_COUNT);
    expect(s.names).toEqual([...STEP_NAMES]);
    expect(s.t[0]).toBe(0);
    expect(s.t.at(-1)).toBe(1);
  });

  it('defaults to the 12-step scale', () => {
    expect(makeScale().count).toBe(12);
  });

  it('produces N ordered, unique names spanning t=0..1', () => {
    for (const n of [3, 5, 6, 8, 10, 16]) {
      const s = makeScale(n);
      expect(s.names).toHaveLength(n);
      expect(new Set(s.names).size).toBe(n); // unique
      expect(s.t[0]).toBe(0);
      expect(s.t.at(-1)).toBeCloseTo(1, 10);
      const nums = s.names.map(Number);
      for (let i = 1; i < nums.length; i++) expect(nums[i]!).toBeGreaterThan(nums[i - 1]!);
    }
  });

  it('resolves names and indices, rejecting unknown/out-of-range keys', () => {
    const s = makeScale(6);
    expect(s.indexOf(s.names[2]!)).toBe(2);
    expect(s.indexOf(3)).toBe(3);
    expect(() => s.indexOf(6)).toThrow(/out of range/);
    expect(() => s.indexOf('999')).toThrow(/unknown step/);
  });

  it('rejects nonsensical counts', () => {
    expect(() => makeScale(1)).toThrow(/>= 2/);
    expect(() => makeScale(2.5)).toThrow(/integer/);
  });
});

describe('contractRegion', () => {
  it('is lightest-4 / darkest-4 at N=12', () => {
    const r = contractRegion(12);
    expect(r.light).toEqual([0, 1, 2, 3]);
    expect(r.dark).toEqual([8, 9, 10, 11]);
  });

  it('scales K = round(N/3) and never overlaps', () => {
    for (const n of [3, 5, 6, 9, 16]) {
      const r = contractRegion(n);
      const k = Math.max(1, Math.min(Math.round(n / 3), Math.floor(n / 2)));
      expect(r.light).toHaveLength(k);
      expect(r.dark).toHaveLength(k);
      // no index appears in both regions
      expect(r.light.some((i) => r.dark.includes(i))).toBe(false);
    }
  });
});

describe('variable-step families', () => {
  it('resolveFamily honors a custom step count and stays monotone', () => {
    const fam = resolveFamily({ name: 'blue', hue: 259, steps: 6 });
    expect(fam.swatches).toHaveLength(6);
    expect(fam.monotone).toBe(true);
    expect(fam.swatches[0]!.t).toBe(0);
    expect(fam.swatches.at(-1)!.t).toBe(1);
  });

  it('seedFamily honors a custom step count and pins the seed', () => {
    const spec = seedFamily({ name: 'brand', seed: '#1d4ed8', steps: 8, step: 5 });
    const fam = resolveFamily(spec);
    expect(fam.swatches).toHaveLength(8);
    expect(fam.swatches[5]!.locked).toBe(true);
    expect(fam.swatches[5]!.hex).toBe('#1d4ed8');
  });

  it('seedFamily defaults the seed to the middle step of a custom scale', () => {
    const fam = resolveFamily(seedFamily({ name: 'brand', seed: '#1d4ed8', steps: 7 }));
    const locked = fam.swatches.filter((s) => s.locked);
    expect(locked).toHaveLength(1);
    expect(locked[0]!.index).toBe(3); // round((7-1)/2)
  });

  it('checkContract evaluates the scaled region for a custom count', () => {
    const fam = resolveFamily({ name: 'green', hue: 150, steps: 6 });
    const r = checkContract(fam);
    const region = contractRegion(6);
    for (const p of [r.worst, ...r.failures]) {
      expect(region.dark).toContain(p.fg.index);
      expect(region.light).toContain(p.bg.index);
    }
  });
});
