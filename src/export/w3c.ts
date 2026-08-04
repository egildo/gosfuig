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
import { shapeEntries, assemble, slugify, referenceFor, type TokenShape } from './shape.js';

export interface W3CExportOptions extends TokenShape {
  /** Stored color space. 'oklch' keeps the perceptual definition (default); 'srgb' emits hex only. */
  colorSpace?: 'oklch' | 'srgb';
  /** Include a `hex` fallback alongside oklch components. Default true. */
  hexFallback?: boolean;
  /** Round OKLCH components to this many decimals. Default 4. */
  precision?: number;
  /**
   * How a named color's `alias` is emitted, flat at the root.
   *
   *   'reference' — a DTCG pointer, `{ "$value": "{green.500}" }` (default)
   *   'inline'    — the color itself, duplicated, for consumers that do not
   *                 resolve references (Figma variables, some pipelines)
   *   'off'       — omit aliases entirely
   *
   * A pointer is the honest form: it says the alias IS that step, so the two
   * cannot drift. Inline trades that guarantee for reach.
   */
  aliases?: 'reference' | 'inline' | 'off';
}

export const ALIAS_MODES = ['reference', 'inline', 'off'] as const;

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
      swatch: s,
    })),
  );

  const shaped = shapeEntries(inputs, opts);
  const out = assemble(shaped, opts, { $type: 'color' });

  // Aliases go flat at the root, alongside the family groups rather than inside
  // one — an alias names a color, not a step of a ramp, and nesting it would
  // start a hierarchy this layer has no business inventing.
  if ((opts.aliases ?? 'reference') !== 'off') {
    const inline = opts.aliases === 'inline';
    const claimed = new Map<string, string>();

    shaped.forEach((entry, i) => {
      const s = inputs[i]!.swatch;
      if (s.alias === undefined) return;

      const key = slugify(s.alias, opts.slug ?? 'kebab', opts.separator ?? '-');
      const source = `${inputs[i]!.group}.${s.name}`;

      if (key in out && !claimed.has(key)) {
        throw new Error(
          `gosfuig: alias "${s.alias}" emits as "${key}", which is already a token group. ` +
            `Rename the alias, or the family it collides with.`,
        );
      }
      const clash = claimed.get(key);
      if (clash !== undefined && clash !== source) {
        throw new Error(
          `gosfuig: two colors both emit the alias "${key}" — ${clash} and ${source}. ` +
            `An alias must point at one color.`,
        );
      }
      claimed.set(key, source);

      out[key] = inline
        ? { $type: 'color', ...token(s, colorSpace, hexFallback, precision) }
        : { $type: 'color', $value: referenceFor(entry.path, opts) };
    });
  }

  return out;
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
