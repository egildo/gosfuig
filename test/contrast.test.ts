import { describe, it, expect } from 'vitest';
import { wcag, apca, evaluate } from '../src/color/contrast.js';
import { parse } from '../src/color/oklch.js';

describe('wcag', () => {
  it('is ~21 for black on white and ~1 for white on white', () => {
    expect(wcag('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(wcag('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is symmetric in its arguments', () => {
    expect(wcag('#123456', '#abcdef')).toBeCloseTo(wcag('#abcdef', '#123456'), 6);
  });
});

describe('apca', () => {
  it('is positive for dark text on a light background', () => {
    expect(apca('#000000', '#ffffff')).toBeGreaterThan(100);
  });

  it('is negative for light text on a dark background', () => {
    expect(apca('#ffffff', '#000000')).toBeLessThan(-100);
  });
});

describe('evaluate', () => {
  it('flags all thresholds for a maximal pair', () => {
    const v = evaluate('#000000', '#ffffff');
    expect(v.passesAALarge).toBe(true);
    expect(v.passesAA).toBe(true);
    expect(v.passesAAA).toBe(true);
  });

  it('fails AA/AAA for a low-contrast pair', () => {
    const v = evaluate('#bbbbbb', '#ffffff');
    expect(v.passesAA).toBe(false);
    expect(v.passesAAA).toBe(false);
  });

  it('accepts both string and Oklch inputs', () => {
    const a = evaluate('#000000', '#ffffff');
    const b = evaluate(parse('#000000'), parse('#ffffff'));
    expect(b.wcag).toBeCloseTo(a.wcag, 6);
    expect(b.apca).toBeCloseTo(a.apca, 6);
  });
});
