import { describe, it, expect } from 'vitest';
import {
  parse,
  isInGamut,
  gamutClamp,
  toHex,
  toRgb255,
  toCss,
  type Oklch,
} from '../src/color/oklch.js';

describe('parse', () => {
  it('parses hex to OKLCH', () => {
    const o = parse('#ffffff');
    expect(o.l).toBeCloseTo(1, 2);
    expect(o.c).toBeCloseTo(0, 3);
  });

  it('round-trips an oklch() string', () => {
    const o = parse('oklch(50% 0.1 200)');
    expect(o.l).toBeCloseTo(0.5, 3);
    expect(o.c).toBeCloseTo(0.1, 3);
    expect(o.h).toBeCloseTo(200, 1);
  });

  it('passes an Oklch object through normalization', () => {
    expect(parse({ l: 0.5, c: 0.1, h: 120 })).toEqual({ l: 0.5, c: 0.1, h: 120 });
  });

  it('throws on unparseable input', () => {
    expect(() => parse('not-a-color')).toThrow(/cannot parse/);
  });

  it('normalizes hue into [0,360)', () => {
    expect(parse({ l: 0.5, c: 0.1, h: -30 }).h).toBeCloseTo(330, 6);
    expect(parse({ l: 0.5, c: 0.1, h: 400 }).h).toBeCloseTo(40, 6);
  });

  it('maps a non-finite hue (achromatic) to 0', () => {
    expect(parse({ l: 0.5, c: 0, h: NaN }).h).toBe(0);
  });

  it('clamps lightness to [0,1] and chroma to >= 0', () => {
    expect(parse({ l: 2, c: -1, h: 0 })).toEqual({ l: 1, c: 0, h: 0 });
  });
});

describe('gamut', () => {
  it('recognizes an in-gamut color', () => {
    expect(isInGamut({ l: 0.6, c: 0.05, h: 200 })).toBe(true);
  });

  it('recognizes an out-of-gamut color', () => {
    expect(isInGamut({ l: 0.5, c: 0.4, h: 0 })).toBe(false);
  });

  it('gamut-maps by reducing chroma while preserving L and H', () => {
    const src: Oklch = { l: 0.5, c: 0.4, h: 30 };
    const mapped = gamutClamp(src);
    expect(mapped.l).toBeCloseTo(src.l, 6);
    expect(mapped.h).toBeCloseTo(src.h, 6);
    expect(mapped.c).toBeLessThan(src.c);
    expect(isInGamut(mapped)).toBe(true);
  });

  it('leaves an already-displayable color essentially unchanged', () => {
    const src: Oklch = { l: 0.6, c: 0.05, h: 200 };
    const mapped = gamutClamp(src);
    expect(mapped.c).toBeCloseTo(src.c, 4);
  });
});

describe('output formats', () => {
  it('toHex is lowercase #rrggbb', () => {
    expect(toHex(parse('#FFFFFF'))).toBe('#ffffff');
    expect(toHex(parse('#000000'))).toBe('#000000');
    expect(toHex({ l: 0.6, c: 0.05, h: 200 })).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('toRgb255 returns byte triples', () => {
    expect(toRgb255(parse('#ffffff'))).toEqual([255, 255, 255]);
    expect(toRgb255(parse('#000000'))).toEqual([0, 0, 0]);
  });

  it('toCss emits oklch(L% C H)', () => {
    expect(toCss({ l: 0.5, c: 0.1, h: 200 })).toBe('oklch(50% 0.1 200)');
  });
});
