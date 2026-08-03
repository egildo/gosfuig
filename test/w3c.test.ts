import { describe, it, expect } from 'vitest';
import { resolvePalette } from '../src/palette.js';
import { toW3CTokens } from '../src/export/w3c.js';

const palette = resolvePalette({
  name: 't',
  families: [{ name: 'blue', hue: 259 }],
});

describe('toW3CTokens', () => {
  it('emits a DTCG color group per family', () => {
    const out = toW3CTokens(palette);
    expect((out.blue as any).$type).toBe('color');
    expect(Object.keys(out.blue as object)).toContain('500');
  });

  it('stores the oklch color object with a hex fallback by default', () => {
    const v = (toW3CTokens(palette).blue as any)['500'].$value;
    expect(v.colorSpace).toBe('oklch');
    expect(v.components).toHaveLength(3);
    expect(v.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('emits a plain hex string in srgb mode', () => {
    const v = (toW3CTokens(palette, { colorSpace: 'srgb' }).blue as any)['500'].$value;
    expect(typeof v).toBe('string');
    expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('omits the hex fallback when disabled', () => {
    const v = (toW3CTokens(palette, { hexFallback: false }).blue as any)['500'].$value;
    expect(v.hex).toBeUndefined();
  });

  it('rounds components to the requested precision', () => {
    const v = (toW3CTokens(palette, { precision: 2 }).blue as any)['500'].$value;
    const [l, c] = v.components;
    expect(l).toBe(Number(l.toFixed(2)));
    expect(c).toBe(Number(c.toFixed(2)));
  });
});
