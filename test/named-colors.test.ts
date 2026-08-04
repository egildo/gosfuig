/**
 * Named colours, and the path routed through them.
 *
 * The brand-book case: a company owns a blue, sometimes two, and the design
 * system needs a full ramp that contains them exactly. Before this, a pinned
 * colour was a *spike* — lightness was routed through it but chroma and hue
 * were not, so the step jumped to its own values while its neighbours kept the
 * curve's, visible as a bright step and a hue that snapped away and back.
 */
import { describe, it, expect } from 'vitest';
import { resolveFamily, seedFamily, hueDelta } from '../src/family.js';
import { parse, toHex, gamutClamp, isInGamut } from '../src/color/oklch.js';
import { stringifyConfig, parseConfig } from '../src/config.js';
import { validateFamilySpec } from '../src/spec.js';
import { familyNotes, summarizeNotes } from '../src/validate.js';
import { fromConfig, toSpec } from '../src/studio/model.js';

/** Largest absolute step-to-step jump in one axis, ignoring the pinned steps. */
const maxJump = (values: number[]) =>
  values.slice(1).reduce((m, v, i) => Math.max(m, Math.abs(v - values[i]!)), 0);

describe('hueDelta', () => {
  it('goes the short way around the circle', () => {
    expect(hueDelta(350, 10)).toBe(20);
    expect(hueDelta(10, 350)).toBe(-20);
    expect(hueDelta(259, 264)).toBe(5);
    expect(hueDelta(0, 181)).toBe(-179);
  });

  it('resolves the antipode consistently, since neither way is shorter', () => {
    // Exactly 180° apart is genuinely ambiguous; the tie-break is arbitrary but
    // must be stable, or a family would flip direction on a rounding change.
    expect(hueDelta(0, 180)).toBe(-180);
    expect(hueDelta(180, 0)).toBe(-180);
  });

  it('is zero for the same hue however it is written', () => {
    expect(hueDelta(259, 259)).toBe(0);
    expect(hueDelta(0, 360)).toBe(0);
    expect(hueDelta(-10, 350)).toBe(0);
  });
});

describe('a named colour is hit exactly', () => {
  it('appears verbatim at its step, with its name', () => {
    const fam = resolveFamily({
      name: 'blue',
      hue: 259,
      colors: [{ name: 'Corporate Blue', value: '#1d4ed8', step: '700' }],
    });
    const s = fam.swatches.find((x) => x.name === '700')!;
    expect(s.hex).toBe('#1d4ed8');
    expect(s.locked).toBe(true);
    expect(s.colorName).toBe('Corporate Blue');
    expect(fam.swatches.filter((x) => x.locked)).toHaveLength(1);
  });

  it('holds for several colours in one family — the two-blues case', () => {
    const fam = resolveFamily({
      name: 'blue',
      hue: 259,
      colors: [
        { name: 'Signal Blue', value: '#3b82f6', step: '500' },
        { name: 'Deep Navy', value: '#172554', step: '900' },
      ],
    });
    expect(fam.swatches.find((s) => s.name === '500')!.hex).toBe('#3b82f6');
    expect(fam.swatches.find((s) => s.name === '900')!.hex).toBe('#172554');
    expect(fam.swatches.find((s) => s.name === '500')!.colorName).toBe('Signal Blue');
    expect(fam.swatches.find((s) => s.name === '900')!.colorName).toBe('Deep Navy');
  });

  it('a colour with no step lands where the ramp is already closest in lightness', () => {
    // #3b82f6 is L 0.6231. The unrouted ramp puts 400 at L 0.6205 and 500 at
    // 0.5395, so 400 is the placement that pulls the lightness curve least —
    // pinning it at 500 would drag the whole ramp by 0.084.
    const fam = resolveFamily({ name: 'blue', hue: 259, colors: [{ value: '#3b82f6' }] });
    const pinned = fam.swatches.find((s) => s.locked)!;
    expect(pinned.name).toBe('400');
    expect(pinned.hex).toBe('#3b82f6');

    // And it really is the minimum: no other step's base lightness is closer.
    const plain = resolveFamily({ name: 'blue', hue: 259 });
    const gaps = plain.swatches.map((s) => Math.abs(s.requested.l - 0.6231));
    expect(gaps.indexOf(Math.min(...gaps))).toBe(pinned.index);
  });

  it('places two unstepped colours on different steps', () => {
    const fam = resolveFamily({
      name: 'blue',
      hue: 259,
      colors: [{ value: '#3b82f6' }, { value: '#172554' }],
    });
    const pinned = fam.swatches.filter((s) => s.locked);
    expect(pinned).toHaveLength(2);
    expect(new Set(pinned.map((s) => s.name)).size).toBe(2);
  });

  it('does not let an unstepped colour steal a step another colour claimed', () => {
    const fam = resolveFamily({
      name: 'blue',
      hue: 259,
      // Both are near L 0.62, but 500 is explicitly claimed.
      colors: [{ value: '#3b82f6' }, { value: '#4285f4', step: '500' }],
    });
    expect(fam.swatches.find((s) => s.name === '500')!.hex).toBe('#4285f4');
    expect(fam.swatches.filter((s) => s.locked)).toHaveLength(2);
  });
});

describe('the ramp routes through its colours, in all three axes', () => {
  const spiky = { name: 'blue' as const, hue: 259, locks: { '700': '#1d4ed8' } };

  it('no longer leaves a chroma spike at the pinned step', () => {
    const fam = resolveFamily(spiky);
    const c = fam.swatches.map((s) => s.oklch.c);
    const pinned = fam.swatches.findIndex((s) => s.locked);

    // The pinned chroma is no longer an outlier against its neighbours: it sits
    // between them rather than towering over both.
    const [before, at, after] = [c[pinned - 1]!, c[pinned]!, c[pinned + 1]!];
    expect(at).toBeLessThanOrEqual(Math.max(before, after) + 1e-9);
    expect(at).toBeGreaterThanOrEqual(Math.min(before, after) - 1e-9);
  });

  it('rotates hue smoothly toward a colour of a different hue', () => {
    const fam = resolveFamily({
      name: 'blue',
      hue: 259,
      colors: [
        { value: '#3b82f6', step: '500' },
        { value: '#0d5c63', step: '800' }, // a teal, 55° away
      ],
    });
    const h = fam.swatches.map((s) => s.oklch.h);
    // Every single-step hue change stays modest — no snap away and back.
    expect(maxJump(h)).toBeLessThan(30);
    // And it genuinely reaches the teal.
    expect(fam.swatches.find((s) => s.name === '800')!.oklch.h).toBeCloseTo(204, 0);
  });

  it('takes the short way round when a colour sits across 0°', () => {
    // Base hue 350, pinned colour at hue ~20 — the path must cross 0, not
    // travel backwards through 300, 200, 100.
    const fam = resolveFamily({
      name: 'red',
      hue: 350,
      colors: [{ value: 'oklch(0.55 0.15 20)', step: '700' }],
    });
    const h = fam.swatches.map((s) => s.oklch.h);
    for (let i = 1; i < h.length; i++) {
      expect(Math.abs(hueDelta(h[i - 1]!, h[i]!))).toBeLessThan(20);
    }
  });

  it('returns to the base curve at the ends', () => {
    const fam = resolveFamily(spiky);
    const plain = resolveFamily({ name: 'blue', hue: 259 });
    expect(fam.swatches[0]!.requested.h).toBeCloseTo(plain.swatches[0]!.requested.h, 6);
    expect(fam.swatches.at(-1)!.requested.c).toBeCloseTo(plain.swatches.at(-1)!.requested.c, 6);
  });

  it('leaves an unpinned family completely alone', () => {
    const before = resolveFamily({ name: 'green', hue: 150 });
    expect(before.swatches.map((s) => s.hex)).toEqual(
      resolveFamily({ name: 'green', hue: 150 }).swatches.map((s) => s.hex),
    );
    // Residuals are all zero, so requested == the base curves.
    for (const s of before.swatches) expect(s.requested.h).toBeCloseTo(150, 6);
  });

  it('leaves a seedFamily alone, since its curves already pass through the seed', () => {
    const fam = resolveFamily(seedFamily({ name: 'brand', seed: '#e11d48', step: '500' }));
    const seeded = fam.swatches.find((s) => s.name === '500')!;
    expect(seeded.hex).toBe('#e11d48');
    // Hue is constant because seedFamily derives it from the seed.
    for (const s of fam.swatches) expect(s.requested.h).toBeCloseTo(seeded.requested.h, 6);
  });
});

describe('the terse form still works', () => {
  it('locks and colors describe the same family', () => {
    const viaLocks = resolveFamily({ name: 'b', hue: 259, locks: { '700': '#1d4ed8' } });
    const viaColors = resolveFamily({
      name: 'b',
      hue: 259,
      colors: [{ value: '#1d4ed8', step: '700' }],
    });
    expect(viaColors.swatches.map((s) => s.hex)).toEqual(viaLocks.swatches.map((s) => s.hex));
  });

  it('a lock has no colour name', () => {
    const fam = resolveFamily({ name: 'b', hue: 259, locks: { '700': '#1d4ed8' } });
    expect(fam.swatches.find((s) => s.locked)!.colorName).toBeUndefined();
  });

  it('seedFamily emits a named colour when given one, and a lock otherwise', () => {
    const named = seedFamily({ name: 'brand', seed: '#1d4ed8', colorName: 'Corporate Blue' });
    expect(named.colors?.[0]).toMatchObject({ name: 'Corporate Blue' });
    expect(named.locks).toBeUndefined();

    const plain = seedFamily({ name: 'brand', seed: '#1d4ed8' });
    expect(plain.colors).toBeUndefined();
    expect(plain.locks).toBeDefined();

    // Either way the seed lands in the same place.
    expect(resolveFamily(named).swatches.map((s) => s.hex)).toEqual(
      resolveFamily(plain).swatches.map((s) => s.hex),
    );
    expect(resolveFamily(named).swatches.find((s) => s.locked)!.colorName).toBe('Corporate Blue');
  });
});

describe('named colours in a config', () => {
  it('validate, including a missing value and an unknown field', () => {
    expect(
      validateFamilySpec({
        name: 'b',
        hue: 259,
        colors: [{ name: 'Corporate Blue', value: '#1d4ed8', step: '700' }, { value: '#fff' }],
      }).ok,
    ).toBe(true);

    const r = validateFamilySpec({
      name: 'b',
      hue: 259,
      colors: [{ name: '', step: '999', hue: 3 }, 'nope'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.errors.map((e) => e.path);
      expect(paths).toContain('family.colors[0].name');
      expect(paths).toContain('family.colors[0].value');
      expect(paths).toContain('family.colors[0].step');
      expect(paths).toContain('family.colors[0].hue');
      expect(paths).toContain('family.colors[1]');
    }
  });

  it('rejects an unparseable colour value', () => {
    const r = validateFamilySpec({ name: 'b', hue: 259, colors: [{ value: 'not-a-colour' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.message).toContain('cannot parse');
  });

  it('accepts a colour with no step, since placement is the engine’s job', () => {
    expect(validateFamilySpec({ name: 'b', hue: 259, colors: [{ value: '#1d4ed8' }] }).ok).toBe(
      true,
    );
  });

  it('survives the config round trip and resolves identically', () => {
    const spec = {
      families: [
        {
          name: 'blue',
          hue: 259,
          colors: [
            { name: 'Signal Blue', value: '#3b82f6', step: '500' },
            { name: 'Deep Navy', value: '#172554' },
          ],
        },
      ],
    };
    const back = parseConfig(stringifyConfig(spec));
    expect(back.families[0]!.colors).toEqual(spec.families[0]!.colors);
    expect(resolveFamily(back.families[0]!).swatches.map((s) => s.hex)).toEqual(
      resolveFamily(spec.families[0]!).swatches.map((s) => s.hex),
    );
  });
});

describe('named colours survive the studio', () => {
  it('a single named colour imports as the editable seed and re-exports intact', () => {
    const spec = {
      families: [
        {
          name: 'blue',
          hue: 259,
          colors: [{ name: 'Corporate Blue', value: '#1d4ed8', step: '700' }],
        },
      ],
    };
    const session = fromConfig(parseConfig(stringifyConfig(spec)));
    const state = session.families[0]!;
    expect(state.mode).toBe('seed');
    expect(state.seed).toBe('#1d4ed8');
    expect(state.seedName).toBe('Corporate Blue');
    expect(state.seedStep).toBe(8);

    const back = toSpec(state, session.steps);
    // `seedFamily` parses the seed, so `value` comes back as OKLCH components
    // rather than the original hex — lossless, and pre-existing behaviour.
    expect(back.colors?.[0]!.name).toBe('Corporate Blue');
    const pinned = resolveFamily(back).swatches.find((s) => s.locked)!;
    expect(pinned.hex).toBe('#1d4ed8');
    expect(pinned.colorName).toBe('Corporate Blue');
  });

  it('carries the colours it cannot edit rather than dropping them', () => {
    const spec = {
      families: [
        {
          name: 'blue',
          hue: 259,
          colors: [
            { name: 'Signal Blue', value: '#3b82f6', step: '500' },
            { name: 'Deep Navy', value: '#172554', step: '900' },
          ],
        },
      ],
    };
    const session = fromConfig(parseConfig(stringifyConfig(spec)));
    const state = session.families[0]!;
    expect(state.seed).toBe('#3b82f6');
    expect(state.carriedColors).toHaveLength(1);

    // Both colours are still pinned after a trip through studio state.
    const back = resolveFamily(toSpec(state, session.steps));
    expect(back.swatches.find((s) => s.name === '500')!.hex).toBe('#3b82f6');
    expect(back.swatches.find((s) => s.name === '900')!.hex).toBe('#172554');
    expect(back.swatches.filter((s) => s.locked)).toHaveLength(2);
  });

  it('still reads the terse lock form', () => {
    const spec = { families: [{ name: 'b', hue: 259, locks: { '700': '#1d4ed8' } }] };
    const state = fromConfig(parseConfig(stringifyConfig(spec))).families[0]!;
    expect(state.mode).toBe('seed');
    expect(state.seed).toBe('#1d4ed8');
    expect(state.seedStep).toBe(8);
    expect(state.seedName).toBeUndefined();
  });
});

describe('conflicts between named colours', () => {
  it('records how far each colour pulled the curve', () => {
    const easy = resolveFamily({
      name: 'b',
      hue: 259,
      colors: [{ value: '#3b82f6', step: '400' }],
    });
    const hard = resolveFamily({
      name: 'b',
      hue: 259,
      colors: [{ value: '#3b82f6', step: '800' }],
    });
    // The same colour, placed where it belongs and where it does not.
    expect(Math.abs(easy.swatches.find((s) => s.locked)!.pull!.l)).toBeLessThan(0.01);
    expect(hard.swatches.find((s) => s.locked)!.pull!.l).toBeGreaterThan(0.3);
  });

  it('leaves pull undefined on steps that are not named colours', () => {
    const fam = resolveFamily({ name: 'b', hue: 259, colors: [{ value: '#3b82f6', step: '400' }] });
    for (const s of fam.swatches) {
      if (s.locked) expect(s.pull).toBeDefined();
      else expect(s.pull).toBeUndefined();
    }
  });

  it('says nothing when a colour sits where the ramp was already going', () => {
    const notes = familyNotes(
      resolveFamily({ name: 'b', hue: 259, colors: [{ value: '#3b82f6', step: '400' }] }),
    );
    expect(notes.strained).toEqual([]);
  });

  it('names the colour that is dragging the ramp', () => {
    const fam = resolveFamily({
      name: 'b',
      hue: 259,
      colors: [{ name: 'Signal Blue', value: '#3b82f6', step: '800' }],
    });
    const notes = familyNotes(fam);
    expect(notes.strained).toHaveLength(1);
    expect(notes.strained[0]).toMatchObject({ step: '800', colorName: 'Signal Blue' });

    const line = summarizeNotes(fam)!;
    expect(line).toContain('"Signal Blue" (800) pulls the ramp');
    expect(line).toContain('lightness by +0.3');
    expect(line).toContain('may belong on another step');
  });

  it('reports a hue forced far from the family it sits in', () => {
    const fam = resolveFamily({
      name: 'blue',
      hue: 259,
      colors: [{ name: 'House Teal', value: '#0d5c63', step: '700' }],
    });
    const strain = familyNotes(fam).strained[0]!;
    expect(strain.hue).toBeCloseTo(-55, 0);
    expect(summarizeNotes(fam)!).toContain('hue by -55°');
  });

  it('does not mistake deliberate hue torsion for a conflict', () => {
    // Torsion lives in the hue curve, so the seed sits exactly on it and pulls
    // the hue by nothing at all, however far the ramp rotates.
    const fam = resolveFamily(
      seedFamily({ name: 'brand', seed: '#1d4ed8', step: '700', hueTorsion: 40 }),
    );
    const pinned = fam.swatches.find((s) => s.locked)!;
    expect(pinned.pull!.h).toBe(0);
    expect(pinned.pull!.c).toBeCloseTo(0, 6);
    expect(summarizeNotes(fam)).not.toContain('hue by');
  });

  /**
   * `seedFamily` derives hue and chroma from the seed, but NOT lightness — it
   * places the seed at a step you choose (the middle one by default) whatever
   * that step's natural lightness is. So a seed can drag its own family, and the
   * strain report says so.
   *
   * #1d4ed8 is L 0.49; the default ramp has 600 at L 0.46 and 700 at L 0.38, so
   * pinning it at 700 pulls the curve by ~0.105. Nothing is broken here — it is
   * the report doing its job, and the concrete argument for letting the engine
   * negotiate the step rather than taking it on faith.
   */
  it('reports a seed dragging its own family, since seedFamily ignores lightness', () => {
    const fam = resolveFamily(seedFamily({ name: 'brand', seed: '#1d4ed8', step: '700' }));
    expect(fam.swatches.find((s) => s.locked)!.pull!.l).toBeCloseTo(0.105, 2);
    expect(summarizeNotes(fam)!).toContain('pulls the ramp lightness');

    // Placed where its lightness actually belongs, it pulls almost nothing.
    const easy = resolveFamily({ name: 'brand', hue: 264, colors: [{ value: '#1d4ed8' }] });
    expect(Math.abs(easy.swatches.find((s) => s.locked)!.pull!.l)).toBeLessThan(0.04);
    expect(familyNotes(easy).strained).toEqual([]);
  });

  it('refuses two colours on one step, before the engine sees them', () => {
    const r = validateFamilySpec({
      name: 'b',
      hue: 259,
      colors: [
        { name: 'A', value: '#3b82f6', step: '500' },
        { name: 'B', value: '#172554', step: '500' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]!.path).toBe('family.colors[1].step');
      expect(r.errors[0]!.message).toContain('already claimed');
    }
  });

  it('allows an index and a name that mean the same step to be caught', () => {
    const r = validateFamilySpec({
      name: 'b',
      hue: 259,
      colors: [
        { value: '#3b82f6', step: '700' },
        { value: '#172554', step: 8 },
      ],
    });
    expect(r.ok).toBe(false);
  });
});

/**
 * The promise: a named colour is what you said it was, whatever the curves do.
 *
 * Two distinct things could break it, and only one of them is the curves.
 */
describe('a named colour survives the curves', () => {
  const LIGHTNESS_GRID = [0.9, 0.94, 0.98, 0.995].flatMap((max) =>
    [0.08, 0.18, 0.3].flatMap((min) =>
      [0.6, 1.0, 1.6].flatMap((gamma) =>
        [0, 0.13, 0.5].map((sCurve) => ({ kind: 'ramp' as const, max, min, gamma, sCurve })),
      ),
    ),
  );

  it('is byte-identical across every lightness curve, when it names its step', () => {
    const seen = new Set<string>();
    const steps = new Set<string>();
    for (const lightness of LIGHTNESS_GRID) {
      const fam = resolveFamily({
        name: 'b',
        hue: 259,
        lightness,
        colors: [{ value: '#1d4ed8', step: '700' }],
      });
      const pinned = fam.swatches.find((s) => s.locked)!;
      seen.add(pinned.hex);
      steps.add(pinned.name);
    }
    expect(LIGHTNESS_GRID.length).toBe(108);
    expect([...seen]).toEqual(['#1d4ed8']);
    expect([...steps]).toEqual(['700']);
  });

  it('is byte-identical across chroma and hue curves too', () => {
    const seen = new Set<string>();
    for (const peak of [0.02, 0.08, 0.14, 0.25]) {
      for (const tPeak of [0.2, 0.6, 0.9]) {
        for (const hue of [0, 90, 180, 270]) {
          const fam = resolveFamily({
            name: 'b',
            hue,
            chroma: { kind: 'bump', peak, tPeak },
            colors: [{ value: '#1d4ed8', step: '700' }],
          });
          seen.add(fam.swatches.find((s) => s.locked)!.hex);
        }
      }
    }
    expect([...seen]).toEqual(['#1d4ed8']);
  });

  /**
   * The one thing the curves DO move: an unstepped colour is placed by
   * lightness fit, so reshaping the lightness ramp reshapes what "closest"
   * means. The colour is untouched; where it sits is not.
   */
  it('keeps its value but may change step when it left placement to the engine', () => {
    const seen = new Set<string>();
    const steps = new Set<string>();
    for (const lightness of LIGHTNESS_GRID) {
      const fam = resolveFamily({ name: 'b', hue: 259, lightness, colors: [{ value: '#1d4ed8' }] });
      const pinned = fam.swatches.find((s) => s.locked)!;
      seen.add(pinned.hex);
      steps.add(pinned.name);
    }
    expect([...seen]).toEqual(['#1d4ed8']);
    expect(steps.size).toBeGreaterThan(1);
  });
});

/**
 * REGRESSION. A hex converted to OKLCH and back lands a hair outside sRGB on
 * any channel that sat at 0 or 255 — pure blue's red channel comes back at
 * -1e-17. A strict gamut test called that out-of-gamut and handed it to the
 * chroma clamp, which "fixed" an already-perfect colour by desaturating it:
 * #0000ff resolved as #0031e5, a ΔE of 0.047. 186 of 165,464 sampled colours
 * drifted, every one of them with a 00 or ff channel — precisely where
 * saturated brand colours live.
 */
describe('a named colour on the sRGB boundary is not "corrected"', () => {
  const EDGE = [
    '#0000ff',
    '#0000fc',
    '#0000de',
    '#ff0000',
    '#00ff00',
    '#ffff00',
    '#ff00ff',
    '#00ffff',
    '#000000',
    '#ffffff',
    '#00000d',
  ];

  it('survives the parse → clamp → hex round trip untouched', () => {
    for (const hex of EDGE) expect(toHex(gamutClamp(parse(hex)))).toBe(hex);
  });

  it('resolves verbatim as a named colour, and is not reported as clamped', () => {
    for (const hex of EDGE) {
      const pinned = resolveFamily({
        name: 'x',
        hue: 200,
        colors: [{ value: hex, step: '700' }],
      }).swatches.find((s) => s.locked)!;
      expect(pinned.hex, hex).toBe(hex);
      expect(pinned.clamped, hex).toBe(false);
    }
  });

  it('holds across a broad sweep of the cube', () => {
    const drifted: string[] = [];
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 19) {
          const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
          if (toHex(gamutClamp(parse(hex))) !== hex) drifted.push(hex);
        }
      }
    }
    expect(drifted).toEqual([]);
  });

  it('still gamut-maps a colour that is genuinely outside sRGB', () => {
    // Far beyond any real display: chroma 0.4 at mid lightness.
    const wild = { l: 0.55, c: 0.4, h: 200 };
    expect(isInGamut(wild)).toBe(false);
    expect(gamutClamp(wild).c).toBeLessThan(0.2);
  });
});
