/**
 * W3C Design Tokens (DTCG) export.
 *
 * Each swatch becomes a `$type: "color"` token. The `$value` uses the DTCG
 * color object form so the perceptual OKLCH definition survives — this is the
 * structured shape the Toghen pipeline consumes (colorSpace + components),
 * with a `hex` fallback for consumers that only read sRGB.
 *
 * What the tree is *called* and how it nests is a separate concern, owned by
 * `./shape.js`: prefixes, group and step renames, slug style, flattening. That
 * is reshape only — it never changes a color, and it is all plain data, so it
 * can live in the config file alongside the palette.
 *
 * Shape (default):
 *   {
 *     "signal-blue": {
 *       "$type": "color",
 *       "500": { "$value": { "colorSpace": "oklch", "components": [L, C, H], "hex": "#..." } }
 *     }
 *   }
 */
import type { Palette } from '../palette.js';
import type { Swatch } from '../family.js';
import { shapeEntries, assemble, type TokenShape } from './shape.js';

export interface W3CExportOptions extends TokenShape {
  /** Stored color space. 'oklch' keeps the perceptual definition (default); 'srgb' emits hex only. */
  colorSpace?: 'oklch' | 'srgb';
  /** Include a `hex` fallback alongside oklch components. Default true. */
  hexFallback?: boolean;
  /** Round OKLCH components to this many decimals. Default 4. */
  precision?: number;
}

type ColorValue =
  string | { colorSpace: 'oklch'; components: [number, number, number]; hex?: string };

export interface ColorToken {
  $value: ColorValue;
}

export function toW3CTokens(
  palette: Palette,
  opts: W3CExportOptions = {},
): Record<string, unknown> {
  const { colorSpace = 'oklch', hexFallback = true, precision = 4 } = opts;

  const inputs = palette.families.flatMap((family) =>
    family.swatches.map((s) => ({
      group: family.name,
      step: s.name,
      value: token(s, colorSpace, hexFallback, precision),
    })),
  );

  return assemble(shapeEntries(inputs, opts), opts, { $type: 'color' });
}

function token(
  s: Swatch,
  colorSpace: 'oklch' | 'srgb',
  hexFallback: boolean,
  precision: number,
): ColorToken {
  if (colorSpace === 'srgb') return { $value: s.hex };
  return {
    $value: {
      colorSpace: 'oklch',
      components: [round(s.oklch.l, precision), round(s.oklch.c, precision), round(s.oklch.h, 2)],
      ...(hexFallback ? { hex: s.hex } : {}),
    },
  };
}

const round = (x: number, p: number) => {
  const f = 10 ** p;
  return Math.round(x * f) / f;
};

export type { TokenShape, SlugStyle } from './shape.js';
