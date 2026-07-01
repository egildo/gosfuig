# gosfuig

Perceptual (OKLCH) design-system palette generator, with contrast validation and W3C design-token export.

Describe a color family declaratively — or hand it a single brand color — and gosfuig resolves it into an even, gamut-safe ramp of named steps, checks the accessibility contract (WCAG 2.1 + APCA), and emits [DTCG](https://tr.designtokens.org/format/) design tokens.

- **Perceptual by construction.** All math runs in OKLCH, where lightness, chroma, and hue are independent and perceptually even. Every color that leaves the engine is gamut-mapped into sRGB by reducing chroma, preserving L and H.
- **One brand color → a full family.** `seedFamily` reads a family's hue (and, by default, its chroma level) *from* a fixed color, builds the ramp around it, and pins the color at its step.
- **Contrast is a first-class output.** Both WCAG 2.1 ratios and APCA Lc, plus a "contract": the darkest steps must be readable (WCAG AA) on the lightest.
- **Tokens, not screenshots.** Export to the DTCG color format with an OKLCH definition and a hex fallback.

## Install

```sh
npm install gosfuig
```

## Quickstart

```ts
import { resolvePalette, seedFamily, checkContract, summarizeContract, toW3CTokens } from 'gosfuig';

const palette = resolvePalette({
  name: 'brand',
  families: [
    { name: 'blue', hue: 259 },                          // hue-driven family
    { name: 'gray', hue: 260, chroma: 0.01 },            // near-neutral
    seedFamily({ name: 'accent', seed: '#e11d48', step: '500' }), // one color -> a family
  ],
});

for (const family of palette.families) {
  console.log(summarizeContract(checkContract(family)));
}

const tokens = toW3CTokens(palette); // DTCG { $type: 'color', ... }
```

## Concepts

### Families and curves

A family is three curves over `t ∈ [0,1]` (t=0 lightest, t=1 darkest) — **lightness**, **chroma**, **hue** — plus optional **locks** (pinned colors).

```ts
resolveFamily({
  name: 'blue',
  hue: 259,                        // constant, or a Curve for hue torsion
  chroma: 0.14,                    // peak chroma with the default bump, or a Curve
  lightness: ramp({ max: 0.98, min: 0.18, sCurve: 0.13 }), // optional
  steps: 12,                       // default 12
  locks: { '700': '#1d4ed8' },     // pin an exact color at a step
});
```

Curve builders: `constant`, `linear`, `gamma`, `ramp` (lightness), `bump` (chroma), `hueRamp` (hue torsion), and the defaults `defaultLightness` / `defaultChroma`.

### Seed-driven families

Instead of dialing a hue, hand `seedFamily` a fixed color. It derives the family's hue from the seed, derives the chroma level so the ramp passes through the seed's own chroma, and pins the seed at its step:

```ts
seedFamily({
  name: 'brand',
  seed: '#1d4ed8',   // any CSS color or OKLCH
  step: '700',       // where the seed lands (default: the middle step)
  hueTorsion: 0,     // optional: rotate hue across the ramp, honoring the seed at its step
  steps: 12,
});
```

`seedFamily` returns a `FamilySpec`, so it drops straight into a palette's `families` array.

### Step scales

The default scale is 12 steps (`25`, `50`, `100` … `950`). Any family can pick a different count via `steps`; names for non-default counts are generated on a `50…950` ladder. `makeScale(n)` exposes a scale directly.

### The contract

The accessibility contract is: the **darkest K** steps, used as foreground text, must clear **WCAG AA (≥ 4.5)** on the **lightest K** steps, with `K = round(N/3)` (the familiar lightest-4 / darkest-4 at N=12). `checkContract` reports pass/fail, the worst pair, and every failing pair — it never mutates the palette. Locks are sacred: if a pinned brand color can't meet AA at its step, gosfuig tells you which pairs fail and by how much rather than "fixing" it.

### Export

```ts
toW3CTokens(palette);                          // OKLCH components + hex fallback (default)
toW3CTokens(palette, { colorSpace: 'srgb' });  // hex strings only
```

`renderDashboard(palette)` returns a self-contained HTML page with each family's swatch strip and full pairwise contrast grid.

## CLI

```sh
gosfuig <config> [options]
```

Resolves a palette spec, prints the contract summary, and writes `tokens.json` (and an HTML dashboard) to an output directory. The config is a `.json` PaletteSpec, or a `.js`/`.mjs` module whose default export is a PaletteSpec (this form can use `seedFamily` and curve builders).

```sh
gosfuig palette.config.mjs -o tokens        # emit to ./tokens
gosfuig palette.json --srgb --no-dashboard  # hex-only tokens, no dashboard
gosfuig palette.json --strict               # exit 1 if any family fails the contract (CI)
```

## Studio

An interactive browser front-end lives in `src/studio`.

```sh
npm run dev          # dev server
npm run studio:build # single-file HTML into dist-studio/
```

Each family has a hue source — **from color** (a base-color picker drives the hue and, by default, the chroma; the color is pinned at a chosen step) or **free hue** (a hue slider). A per-family curves panel exposes lightness, chroma shape, and hue torsion; a palette-wide control sets the step count. Export W3C tokens from the toolbar.

## Development

```sh
npm run typecheck   # tsc, no emit
npm test            # vitest
npm run check       # typecheck + test
npm run build       # emit the library to dist/
npm run demo        # run examples/run.ts -> out/
```

## License

MIT
