# gosfuig

Perceptual (OKLCH) design-system palette generator, with contrast validation and W3C design-token export.

Describe a color family declaratively — or hand it a single brand color — and gosfuig resolves it into an even, gamut-safe ramp of named steps, checks the accessibility contract (WCAG 2.1 + APCA), and emits [DTCG](https://tr.designtokens.org/format/) design tokens.

- **Perceptual by construction.** All math runs in OKLCH, where lightness, chroma, and hue are independent and perceptually even. Every color that leaves the engine is gamut-mapped into sRGB by reducing chroma, preserving L and H.
- **Your brand colors → full families.** Declare the colors a branding book already gives you and the ramp is built as a path through them — routed in lightness, chroma _and_ hue, so a pinned color is a waypoint rather than a spike. Several per family is normal.
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
    { name: 'blue', hue: 259 }, // hue-driven family
    { name: 'gray', hue: 260, chroma: 0.01 }, // near-neutral
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

A family is three curves over `t ∈ [0,1]` (t=0 lightest, t=1 darkest) — **lightness**, **chroma**, **hue** — plus the [named colors](#named-colours-and-the-path-through-them) the ramp must pass through.

```ts
resolveFamily({
  name: 'blue',
  hue: 259, // a number, or a CurveSpec for hue torsion
  chroma: 0.14, // peak chroma with the default bump, or a CurveSpec
  lightness: { kind: 'ramp', max: 0.98, min: 0.18, sCurve: 0.13 }, // optional
  steps: 12, // default 12
  colors: [{ name: 'Corporate Blue', value: '#1d4ed8', step: '700' }], // see below
});
```

**A curve is data, not a function.** Every curve is a plain tagged object — a `CurveSpec` — which is what makes a spec serializable:

| `kind`     | fields                              | used for     |
| ---------- | ----------------------------------- | ------------ |
| `constant` | `value`                             | a fixed hue  |
| `linear`   | `from`, `to`                        | anything     |
| `gamma`    | `from`, `to`, `gamma?`              | biased ramps |
| `hueRamp`  | `start`, `end`                      | hue torsion  |
| `ramp`     | `max`, `min`, `gamma?`, `sCurve?`   | lightness    |
| `bump`     | `peak`, `tPeak?`, `light?`, `dark?` | chroma       |

Because a spec is data, a `.json` config and a `.js` config express exactly the same things, and a palette built in the studio can be written to disk, read by the CLI, and handed to CI unchanged. `compile(spec)` turns a `CurveSpec` into the `(t) => number` closure the engine evaluates; the same-named builders (`constant`, `linear`, `gamma`, `ramp`, `bump`, `hueRamp`, `defaultLightness`, `defaultChroma`) construct that closure directly. `defaultLightnessSpec()` and `defaultChromaSpec(peak)` give the defaults in data form.

### Validation

`parsePaletteSpec(input)` turns untrusted input into a `PaletteSpec` or throws with every problem located:

```
gosfuig: invalid palette spec (3 problems)
  families[0].lightness.kind: unknown curve kind "smoothstep" (expected one of constant, linear, gamma, hueRamp, ramp, bump)
  families[1].hue: expected a number or a curve spec, got "blue"
  families[1].lightnes: unknown field (expected name, hue, chroma, lightness, steps, colors, locks, $extensions)
```

Unknown fields are errors, not warnings, so a typo fails loudly instead of silently resolving to the default. `validatePaletteSpec` / `validateFamilySpec` return `{ ok, value }` or `{ ok, errors }` if you would rather not catch.

### Named colours, and the path through them

A branding book says "our blue is `#1d4ed8`". It does not say "our blue is step 700" — that's a decision someone makes afterwards. So a family declares the colours the brand already owns, and the ramp is built as a **path that passes through them**:

```json
{
  "name": "blue",
  "hue": 259,
  "colors": [
    { "name": "Acme Signal Blue", "value": "#3b82f6", "step": "500" },
    { "name": "Acme Deep Navy", "value": "#172554" }
  ]
}
```

**Several per family is the normal case.** Brands routinely own a bright blue _and_ a deep navy; they become waypoints on one ramp rather than two unrelated families.

**Omit `step` and the engine places the colour** where the ramp's own lightness already comes closest — the placement that pulls the curve least. `locks` still works as the terse form (`{ "700": "#1d4ed8" }`) and desugars into the same thing, without a name.

The path is routed in **all three axes**. This matters more than it sounds: routing only lightness — which is what gosfuig did until now — leaves a pinned colour as a _spike_. Its neighbours keep the curve's chroma and hue while it jumps to its own:

```
                     before                    after
step    C      H                  C      H
 500  0.138  259                0.206  263
 600  0.138  259                0.224  264
 700  0.217  264  ★             0.217  264  ★
 800  0.089  259                0.154  263
 900  0.061  259                0.094  261
```

Chroma towered at the pinned step and dropped off a cliff; with two colours of different hues the hue snapped away and back across a single step. Now the ramp arcs through them, and hue takes the short way round the circle — `350°` to `10°` is +20°, not −340°.

One consequence worth knowing: routing makes the _request_ more ambitious, so more steps get gamut-clamped than before — the demo blue went from 1 clamped step to 7. The realized ramp is smoother and more colourful than it was; the engine simply now asks for more than sRGB can give in the light half. This is the strongest argument yet for expressing chroma relative to the per-hue cusp.

#### When colours disagree

Routing hits every named colour exactly, so a conflict never shows up as a missed colour — it shows up as a **distorted ramp**. A colour pinned where its lightness doesn't belong drags the whole curve, and every other step pays for it. Each swatch records how far it pulled:

```
  dragged: FAIL — worst 700 on 200 = 2.20 WCAG; 8 pair(s) below AA
    ↳ "Signal Blue" (800) pulls the ramp lightness by +0.312 — it may belong on another step
  wrong hue: FAIL — worst 700 on 200 = 4.10 WCAG
    ↳ "House Teal" (700) pulls the ramp lightness by +0.051 and hue by -55° — it may belong on another step
```

Deliberate hue torsion lives in the hue _curve_, so a seed sitting on it pulls nothing — anything reported here is the colours disagreeing with the family they're in. Two colours claiming the same step is refused outright at validation, since one of them would otherwise be silently discarded.

#### Aliases

`green.600` is where a colour sits on its ramp. `brand-green` is what a developer types. A named colour can carry an `alias` — a second way to point at it in the token file:

```json
{ "name": "Acme Forest Green", "alias": "brand green", "value": "#0f7b4a", "step": "600" }
```

which emits, flat at the root beside the family groups:

```json
{
  "green": { "$type": "color", "600": { "$value": "#0f7b4a" } },
  "brand-green": { "$type": "color", "$value": "{green.600}" }
}
```

`alias` is deliberately separate from `name`. A name is prose on a swatch; an alias is an identifier. Deriving one from the other would give you `acme-forest-green`, which nobody wants to type. **Omitting it emits nothing** — token files never grow entries on their own.

It's a DTCG reference, not a copy, so the alias _is_ that step and the two can't drift. The reference addresses the **emitted** tree, so it composes with the whole shaping layer — under `prefix: "color"` and a group rename it becomes `{color.brand.500}`, and under `flatten` it becomes `{signal-blue-500}`.

`export.aliases` picks the form: `reference` (default), `inline` — the colour duplicated, for consumers that don't resolve references, like Figma variables — or `off`. An alias colliding with a family group, or two colours claiming one alias, is refused with both offenders named.

> This is the one thing the export layer does that isn't pure reshape: an alias is a token that wasn't in the ramp. It stays at the root rather than nesting under a group, which keeps it an alias rather than the beginning of a semantic hierarchy.

### Templates

The reusable half of a palette, saved under a name. Take any config apart and the fields fall into two piles: the brand's own colours and which families exist — the branding book, different every time — and the curves, step count, chroma shape and export block, which are house style and identical across every palette you'll make.

A template is the second pile. It is **not a second file format**: it resolves _into_ a `PaletteSpec`, and the config always wins where the two disagree.

```sh
gosfuig --templates                                    # list the built-ins
gosfuig brand.json --template contrast                 # apply a house style
gosfuig brand.json --template ./house.template.json    # or your own
gosfuig brand.json --emit-template house               # save this one as a file
gosfuig brand.json --template contrast --emit-config   # freeze it in
```

#### Saving and loading one

A template is a small JSON file, and both front-ends read and write it:

|            | load                              | save                                    |
| ---------- | --------------------------------- | --------------------------------------- |
| **CLI**    | `--template <name \| path.json>`  | `--emit-template <name>`                |
| **studio** | house style ▾ → _load from file…_ | house style ▾ → _save current as file…_ |

Saving reads the house style back out of a palette you already tuned, so you produce a template from real work rather than hand-writing one:

```json
{
  "name": "house",
  "description": "our style",
  "steps": 12,
  "lightness": { "kind": "ramp", "max": 0.985, "min": 0.15, "gamma": 1, "sCurve": 0.3 },
  "export": { "prefix": "color" }
}
```

Those five fields are the whole format — `name` is required, the rest optional, and anything else is rejected. **Brand facts are never written into a template**: no colors, no hues, no family names. That's the point of the split, and there's a test asserting it.

| built-in   | what it is                                                           |
| ---------- | -------------------------------------------------------------------- |
| `default`  | the shipped defaults: 12 steps, gentle S-curve                       |
| `contrast` | stronger S-curve, for palettes that must clear AA with room to spare |
| `flat`     | linear lightness, evenly spaced steps, tighter contrast              |
| `fine`     | 16 steps on a wider range                                            |

So a new brand is a short file — house style, plus the colours you own:

```json
{
  "families": [
    { "name": "blue", "hue": 259, "colors": [{ "name": "Acme Blue", "value": "#3b82f6" }] },
    { "name": "green", "hue": 150, "colors": [{ "name": "Acme Green", "value": "#0f7b4a" }] }
  ]
}
```

**`--emit-config` resolves the template away.** The written config carries the merged values and no memory of where they came from, so it stands on its own and produces byte-identical tokens without `--template`. That's what keeps a project portable despite presets living outside it.

**One interaction to know about.** Step _names_ are scale-dependent — `500` is on the 12-step scale and not on the 16-step one — so a template that changes `steps` invalidates any colour that named its step. That's reported as an ordinary located error:

```
gosfuig: invalid palette spec (1 problem)
  families[0].colors[0].step: not a step of this 16-step scale (names: 50, 100, 150, …)
```

A colour that leaves placement to the engine has no such problem, which is a good reason to omit `step` when you want a config that travels across house styles.

**The studio applies a template as a visible edit**, not as a silent base. A studio family always carries explicit curves, so `applyTemplate`'s fill-the-gaps behaviour would change nothing at all there; the picker writes the values into every family and says what it did.

### A worked example: Palette Sardegna

`examples/sardegna.config.json` and `examples/sardegna.template.json` are a real palette, not a toy: twelve families named for Sardinian places and beaches, each anchored to a verified Pantone.

```sh
gosfuig examples/sardegna.config.json -o tokens \
  --template examples/sardegna.template.json
```

It exercises the whole model at once, and every piece earns its place:

- **The compound name is the family, the generic word is the alias.** `busachi red` is the ramp; `red` is what a developer types. The token file gets twelve ramps under `color.` and twelve aliases beside them — `red → {color.busachi-red.400}`.
- **No colour names its step.** Each is placed where the ramp's own lightness comes closest, and no colour ends up pulling its family by more than 0.04 — there is a test asserting it.
- **The template holds the house style**, the config holds the brand facts. Config wins: the neutrals override the template's chroma because a near-grey family has no business at peak 0.14.

All twelve pass the contract, all twelve ramps stay monotone, and every brand colour is delivered at its reference hex. That last one is a test against the branding book's own values, so if the engine ever stops honouring a pinned colour it fails against your document rather than against itself.

**Two honest notes it surfaced.**

The palette document's OKLCH and hex columns disagree by one byte for Nuragus Lime: `oklch(0.834 0.190 115.7)` renders `#c4d601`, the table's indicative hex says `#c4d600`. Chroma rounded to three decimals is not quite enough to round-trip a Pantone. gosfuig follows the OKLCH, since that is the anchor derived from the verified RGB.

And **"chroma clamped" does not mean "bad ramp"**. Yellow and lime clamp at most steps here, because those hues hold roughly 0.098 where purple holds 0.238 — a factor of 2.4. The delivered ramps ride the gamut ceiling smoothly and look right; what is wrong is the _request_, which asks for a chroma that hue never had. Per-family peaks measured at 85% of each hue's cusp improve it a lot (purple went from clamped to clean) but cannot fix it, because the routing residual is linear in step index and knows nothing about the gamut. This is the clearest argument yet for expressing chroma as a fraction of the cusp rather than an absolute.

### Seed-driven families

Instead of dialing a hue, hand `seedFamily` a fixed color. It derives the family's hue from the seed, derives the chroma level so the ramp passes through the seed's own chroma, and pins the seed at its step:

```ts
seedFamily({
  name: 'brand',
  seed: '#1d4ed8', // any CSS color or OKLCH
  step: '700', // where the seed lands (default: the middle step)
  hueTorsion: 0, // optional: rotate hue across the ramp, honoring the seed at its step
  steps: 12,
});
```

`seedFamily` returns a `FamilySpec`, so it drops straight into a palette's `families` array.

### Step scales

The default scale is 12 steps (`25`, `50`, `100` … `950`). Any family can pick a different count via `steps`; names for non-default counts are generated on a `50…950` ladder. `makeScale(n)` exposes a scale directly.

### Fidelity: what the engine could not deliver

sRGB does not hold the same chroma at every hue. Magenta reaches C 0.309, cyan only 0.150 — a factor of two — so a chroma your spec asks for is often simply unreachable. The engine used to reduce it and hand back the result as though it were what you requested.

Now every swatch keeps both:

```ts
s.oklch; // what you got — displayable
s.requested; // what the curves asked for, before gamut mapping
s.clamped; // true when chroma had to be reduced
chromaLoss(s); // how much
```

and the family lists `clampedSteps` alongside the `monotoneBreaks` it already computed. All three front-ends surface it: the CLI prints a note under each family, the dashboard marks the swatch with `~` and outlines a non-monotone step, and the studio does the same with the request in the tooltip.

```
cyan: PASS — worst 700 on 200 = 5.03 WCAG (APCA 52)
  ↳ chroma clamped at 4 step(s) [400, 500, 600, 700] — worst 500: 0.157 → 0.115
    (sRGB cannot hold this chroma at this hue)
```

`summarizeNotes` ranks by `MINOR_CHROMA_LOSS` (0.01) so a float-level difference doesn't read like a real one; the underlying data is exact regardless.

> **Known defect, deliberately not fixed here.** With the shipped defaults the lightest step clamps at **49 of 72 hues**, by up to 0.0157: `defaultChroma`'s floor of C 0.025 sits above what L 0.98 — `defaultLightness`'s `max` — can hold, which is only 0.0093–0.0705 depending on hue. The fix is to the defaults (a floor near 0.009, or a `lightMax` near 0.95 where 0.0236 is reachable), and it would move the lightest step of every existing palette. It is pinned by a characterization test rather than papered over.

### The contract

The accessibility contract is: the **darkest K** steps, used as foreground text, must clear **WCAG AA (≥ 4.5)** on the **lightest K** steps, with `K = round(N/3)` (the familiar lightest-4 / darkest-4 at N=12). `checkContract` reports pass/fail, the worst pair, and every failing pair — it never mutates the palette. Locks are sacred: if a pinned brand color can't meet AA at its step, gosfuig tells you which pairs fail and by how much rather than "fixing" it.

### Export

```ts
toW3CTokens(palette); // OKLCH components + hex fallback (default)
toW3CTokens(palette, { colorSpace: 'srgb' }); // hex strings only
```

#### Shaping the emitted tree

What the tokens are **called** and how they **nest** is separate from what they are. Reshape only — no token is invented, aliased, or given a meaning; the colors are byte-for-byte the same whatever shape you pick. It is all plain data, so it lives in the config file:

```json
{
  "export": {
    "prefix": "color",
    "groups": { "signal blue": "brand" },
    "steps": { "25": "lightest" },
    "slug": "kebab",
    "flatten": false,
    "separator": "-"
  }
}
```

| field       | effect                                                                  |
| ----------- | ----------------------------------------------------------------------- |
| `prefix`    | wrapping group(s): `"color"` → `color.brand.500`. A string or an array. |
| `groups`    | rename family → token group, applied before slugging                    |
| `steps`     | rename step → token name, applied before slugging                       |
| `slug`      | `kebab` (default), `camel`, `snake`, `none`                             |
| `flatten`   | one level of joined keys (`color-brand-500`) instead of nested groups   |
| `separator` | joiner for `flatten`, and for the `kebab` style. Default `-`            |

**Names are made safe by default.** The default `kebab` style is what turns a family called `signal blue` into `signal-blue` — a group key with a space in it is legal DTCG but breaks CSS variable names, Tailwind keys and Figma variable paths. `slug: "none"` preserves your spacing and case, but still strips `.`, `{` and `}`, since those break `{group.token}` reference resolution.

**Collisions are refused, never silently merged.** If two families would emit the same name, the export fails and says which two:

```
gosfuig: token name collision — "signal blue.25" and "Signal-Blue.25" both emit as
"signal-blue-25". Rename one, or use a different slug style.
```

CLI flags override the config block, since a flag is the more specific instruction — so `--srgb` wins over `"colorSpace": "oklch"`.

`renderDashboard(palette)` returns a self-contained HTML page with each family's swatch strip and full pairwise contrast grid.

## CLI

```sh
gosfuig <config> [options]
```

Resolves a palette spec, prints the contract summary, and writes `tokens.json` (and an HTML dashboard) to an output directory. The config is a `.json` PaletteSpec, or a `.js`/`.mjs` module whose default export is a PaletteSpec. Both forms are equally expressive — curves are data, so JSON carries them too; the module form is for when you want `seedFamily()` to compute the spec for you. Either way the config is validated before it reaches the engine, and a malformed one exits 1 with every problem located.

```sh
gosfuig palette.config.mjs -o tokens        # emit to ./tokens
gosfuig palette.json --srgb --no-dashboard  # hex-only tokens, no dashboard
gosfuig palette.json --strict               # exit 1 if any family fails the contract (CI)
gosfuig palette.config.mjs --emit-config    # also freeze the spec to palette.config.json
gosfuig --templates                         # list the built-in house styles
gosfuig brand.json --template contrast      # apply one
gosfuig brand.json --emit-template house    # save this palette's house style
```

## The config file

One format, three producers and three consumers: the studio writes it, the CLI reads and writes it, and you can hand-author it. It is a `PaletteSpec` in JSON, plus two file-level fields:

- `export` — how the token file is shaped on the way out. See [Shaping the emitted tree](#shaping-the-emitted-tree).
- `$version` — the config format version. A config newer than your build is rejected rather than half-read.
- `$extensions` — vendor data keyed by owner, which the engine carries and never reads. The studio stores its authoring state (which families are "from color", whether chroma is auto) under `"gosfuig.studio"`, so a session round-trips exactly while the CLI reads the same file and ignores what it doesn't own.

```sh
# studio → save config ↓ → palette.config.json
gosfuig palette.config.json -o tokens --strict
```

A config with no studio extension still loads into the studio; the state is reconstructed from the spec itself. That reconstruction is faithful in color but not always in authoring shape — a family pinned by a lone lock comes back as "from color", and a hue torsion authored on a seed family comes back centered rather than pivoted on the seed's step.

## Studio

An interactive browser front-end lives in `src/studio`.

```sh
npm run dev          # dev server
npm run studio:build # single-file HTML into dist-studio/
```

Each family has a hue source — **from color** (a base-color picker drives the hue and, by default, the chroma) or **free hue** (a hue slider). A "from color" family also carries a **color name** and a **token alias**, so the brand fact and the token identifier are authored where you can see the ramp react. A per-family curves panel exposes lightness, chroma shape, and hue torsion; a palette-wide control sets the step count.

A sticky bar at the top holds everything you reach for repeatedly: the pass count, the **house style** picker, add family, save/load config, reset, and export tokens. It stays one row at every width and scrolls sideways rather than wrapping, because a sticky element that changes height makes the page jump.

Config save/load uses the same `palette.config.json` the CLI takes, so a session hands off to CI directly. The session is also kept in `localStorage`, so a reload doesn't discard an afternoon of slider work; **reset** clears it back to the demo palette.

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
