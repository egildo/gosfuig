import { describe, it, expect } from 'vitest';
import {
  constant,
  linear,
  gamma,
  bump,
  ramp,
  defaultLightness,
  defaultChroma,
} from '../src/curves.js';

describe('constant', () => {
  it('is flat across the ramp', () => {
    const c = constant(5);
    expect([c(0), c(0.5), c(1)]).toEqual([5, 5, 5]);
  });
});

describe('linear', () => {
  it('hits both endpoints and the midpoint', () => {
    const l = linear(0, 10);
    expect(l(0)).toBe(0);
    expect(l(1)).toBe(10);
    expect(l(0.5)).toBe(5);
  });

  it('clamps t outside [0,1]', () => {
    const l = linear(0, 10);
    expect(l(-1)).toBe(0);
    expect(l(2)).toBe(10);
  });
});

describe('gamma', () => {
  it('equals linear when gamma = 1', () => {
    const g = gamma(0, 10, 1);
    const l = linear(0, 10);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(g(t)).toBeCloseTo(l(t), 10);
  });

  it('bunches toward the from-end when gamma > 1', () => {
    expect(gamma(0, 1, 2)(0.5)).toBeCloseTo(0.25, 10);
  });
});

describe('bump', () => {
  it('peaks at tPeak and tapers to the floors', () => {
    const b = bump({ peak: 0.14, tPeak: 0.6, light: 0.02, dark: 0.05 });
    expect(b(0.6)).toBeCloseTo(0.14, 10);
    expect(b(0)).toBeCloseTo(0.02, 10);
    expect(b(1)).toBeCloseTo(0.05, 10);
    // strictly below the peak on both sides
    expect(b(0.3)).toBeLessThan(0.14);
    expect(b(0.8)).toBeLessThan(0.14);
  });
});

describe('ramp', () => {
  it('hits endpoints exactly regardless of sCurve', () => {
    for (const sCurve of [0, 0.13, 0.5, 1]) {
      const r = ramp({ max: 0.98, min: 0.18, sCurve });
      expect(r(0)).toBeCloseTo(0.98, 10);
      expect(r(1)).toBeCloseTo(0.18, 10);
    }
  });

  it('is monotonically decreasing light -> dark', () => {
    const r = ramp({ max: 0.98, min: 0.18, sCurve: 0.13 });
    let prev = r(0);
    for (let i = 1; i <= 20; i++) {
      const v = r(i / 20);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });
});

describe('defaults', () => {
  it('defaultLightness spans 0.98 -> 0.18', () => {
    const l = defaultLightness();
    expect(l(0)).toBeCloseTo(0.98, 10);
    expect(l(1)).toBeCloseTo(0.18, 10);
  });

  it('defaultChroma peaks at the configured value', () => {
    expect(defaultChroma(0.14)(0.6)).toBeCloseTo(0.14, 10);
  });
});
