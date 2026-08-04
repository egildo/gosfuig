# gosfuig — notes for a fresh session

A perceptual (OKLCH) palette generator. You give it the colors a brand already
owns; it builds even, gamut-safe ramps that pass through them, checks an
accessibility contract, and emits DTCG tokens.

The README covers usage. This file covers what a new session would otherwise
spend an hour re-deriving: the vocabulary, the decisions and why they were made,
what is deliberately not built, and the defects that are known and pinned.

## Shape

A pure core with three front-ends, all consuming the same public API in
`src/index.ts`. Nothing in the engine knows about a UI.

```
color/oklch · curves · family · palette      the engine (pure, no I/O)
spec · config · template                     input: validate, serialize, reuse
validate                                     contract + fidelity reporting
export/shape · export/w3c                    output: naming, nesting, DTCG
cli · dashboard · studio                     three consumers, zero forked math
```

`bin.ts` is the only file that touches `process`; `cli.ts` is side-effect free
and returns an exit code, which is what makes it testable in-process.

## Vocabulary that is load-bearing

**spec / resolution / emission.** Three different things that used to be one.
A *spec* is what you asked for (authored, serializable, round-trips). A
*resolution* is what the engine computed (derived, never authored). An
*emission* is the shape the tokens take on the way out (presentation). Keeping
them apart is the reason configs can round-trip at all.

**held / free.** The role a knob is in, declared rather than discovered. A held
knob is the author's; a free knob is the engine's to search. The same knob can
be either — `gamma` is a means until a team adopts a house ramp shape. Today's
engine holds everything (which is why it never solves); a naive optimizer frees
everything (which is why it goes dead). Both are endpoints of one dial.

**routing vs solving.** *Routing* a ramp through its named colors is
deterministic interpolation — one answer, no search. *Solving* is the parked
idea of searching free parameters to satisfy the contract. Do not let these
words blur; they are different operations.

**name vs alias.** A named color's `name` is prose for a human reading a swatch
("Acme Signal Blue"). Its `alias` is an identifier a developer types ("brand
blue"). Deriving one from the other gives `acme-signal-blue`, which nobody
wants. They stay separate on purpose.

## Decisions, and why

**A curve is data, not a function.** `{ kind: 'ramp', max, min, gamma, sCurve }`.
Closures cannot be JSON, so a spec containing them cannot round-trip. This is
what makes `.json` and `.mjs` configs equally expressive.

**Locks are sacred; report, never mutate.** When a pinned color breaks the
contract, gosfuig says which pairs fail and by how much. It does not "fix" the
palette.

**Data exact, presentation ranked.** `Swatch.clamped`, `requested` and
`familyNotes` are always precise. Thresholds (`MINOR_CHROMA_LOSS`,
`STRAIN_LIGHTNESS`, `STRAIN_HUE`) only decide what the one-line summary leads
with. Nothing is hidden, only ordered.

**Refuse rather than silently merge.** Two tokens with one name, two colors on
one step, two colors claiming one alias — all errors naming both offenders.
Silently dropping one is the worst available outcome for a token file.

**Emission is reshape only** — renaming, nesting, slugging. The one exception is
aliases, which add a token that was not in the ramp; they stay flat at the root
precisely so they remain aliases rather than the start of a semantic hierarchy.

**Templates are a base, the config wins** on the CLI. In the studio a template
must be a visible *edit*, because a studio family always carries explicit curves
and a silent base would change nothing at all.

## Known defects, deliberately not fixed

Each is pinned by a characterization test that will fail when it is fixed. That
failure is the fix landing — do not "repair" the test without reading it.

**`K = round(N/3)` holds at 12 steps by luck of rounding.** The innermost
contract pair's normalized gap oscillates and shrinks toward 1/3 as N grows.
Ten of twenty-three step counts fail at some hue; four (8, 11, 14, 15) sit
inside the studio's own slider range. `test/properties.test.ts`.

**The defaults request an unreachable chroma.** `defaultChroma`'s floor of
C 0.025 sits above what `defaultLightness`'s L 0.98 can hold at 49 of 72 hues,
losing up to 0.0157. `test/fidelity.test.ts`.

Both are math changes that would move every existing palette, which is why they
are decisions rather than bugs to be quietly patched.

## Open questions

**What the solver is for.** Circled and not landed. The fork is whether its job
is to *find a palette* or to *explain an impossibility*; the glimpse left on the
floor is that a finder is a degenerate explainer — compute the frontier and
picking a point is free, compute the point and the frontier is unrecoverable.
Candidate names carrying different registers: *envelope* (structural),
*frontier* (Pareto), *interaction diagram* (borrowed).

**The missing quantity.** Any solver needs a way to rank palettes, and gosfuig
can only answer *legal*. `monotone` is one organ of it; adjacent-step
differentiation does not exist; perceptual evenness is unmeasured.

**Cusp-relative chroma.** The best-evidenced of the three. sRGB holds
C 0.309 at magenta and 0.150 at cyan, so an absolute chroma number means
something different at every hue. Three independent arguments now: routing made
the engine ask for more than the light half can give; the defaults ask for the
unreachable; and in Palette Sardegna yellow holds ~0.098 where purple holds
0.238 and no per-family constant fixes it.

## Working here

```sh
npm run check          # typecheck + vitest + eslint — run before every commit
npm run dev            # studio dev server (port 5219, see .claude/launch.json)
npm run build          # library + bin to dist/
npm run studio:build   # single-file studio into dist-studio/
```

The CLI binary is `dist/bin.js` (not `dist/cli.js` — it moved in the split that
made `cli.ts` testable). CI runs the full check on Node 20 and 22 plus a set of
smoke tests that exercise real example configs end to end.

**Conventions worth keeping.** Comments explain *why*, never restate the code.
Tests are named as claims about behaviour. Findings get measured before they get
asserted — several times this session a test encoded an assumption the engine
was right to contradict, and the measurement settled it.

**The worked example** is `examples/sardegna.config.json` — a real twelve-family
palette anchored to verified Pantones, tuned in the studio and saved back. Its
test asserts against the branding book's own hex values, so if the engine stops
honouring a pinned color it fails against the source document rather than
against itself.
