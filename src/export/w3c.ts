/**
 * W3C Design Tokens (DTCG) export.
 *
 * Each swatch becomes a `$type: "color"` token. The `$value` uses the DTCG
 * color object form so the perceptual OKLCH definition survives — this is the
 * structured shape the Toghen pipeline consumes (colorSpace + components),
 * with a `hex` fallback for consumers that only read sRGB.
 *
 * Shape:
 *   {
 *     "blue": {
 *       "$type": "color",
 *       "500": { "$value": { "colorSpace": "oklch", "components": [L, C, H], "hex": "#..." } }
 *     }
 *   }
 */
import type { Palette } from '../palette.js';
import type { Family } from '../family.js';

export interface W3CExportOptions {
  /** Stored color space. 'oklch' keeps the perceptual definition (default); 'srgb' emits hex only. */
  colorSpace?: 'oklch' | 'srgb';
  /** Include a `hex` fallback alongside oklch components. Default true. */
  hexFallback?: boolean;
  /** Round OKLCH components to this many decimals. Default 4. */
  precision?: number;
}

type ColorValue =
  | string
  | { colorSpace: 'oklch'; components: [number, number, number]; hex?: string };

interface TokenGroup {
  $type: 'color';
  [step: string]: { $value: ColorValue } | 'color';
}

export function toW3CTokens(
  palette: Palette,
  opts: W3CExportOptions = {},
): Record<string, TokenGroup> {
  const { colorSpace = 'oklch', hexFallback = true, precision = 4 } = opts;
  const out: Record<string, TokenGroup> = {};

  for (const family of palette.families) {
    out[family.name] = familyGroup(family, colorSpace, hexFallback, precision);
  }
  return out;
}

function familyGroup(
  family: Family,
  colorSpace: 'oklch' | 'srgb',
  hexFallback: boolean,
  precision: number,
): TokenGroup {
  const group = { $type: 'color' } as TokenGroup;
  for (const s of family.swatches) {
    const value: ColorValue =
      colorSpace === 'srgb'
        ? s.hex
        : {
            colorSpace: 'oklch',
            components: [
              round(s.oklch.l, precision),
              round(s.oklch.c, precision),
              round(s.oklch.h, 2),
            ],
            ...(hexFallback ? { hex: s.hex } : {}),
          };
    group[s.name] = { $value: value };
  }
  return group;
}

const round = (x: number, p: number) => {
  const f = 10 ** p;
  return Math.round(x * f) / f;
};
