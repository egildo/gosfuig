/**
 * Properties that must hold across the whole hue circle, not just the handful
 * of hues the unit tests happen to name.
 *
 * These pin the claim made in the `defaultLightness` docstring — that the
 * defaults clear WCAG AA for the darkest steps on the lightest "across hues".
 * Before this file that claim was documentation only.
 */
import { describe, it, expect } from 'vitest';
import { resolveFamily } from '../src/family.js';
import { checkContract, AA } from '../src/validate.js';
import { isInGamut } from '../src/color/oklch.js';

const HUES = Array.from({ length: 72 }, (_, i) => i * 5); // 0..355 at 5°

describe('default families, swept across the hue circle', () => {
  it('satisfy the contract at every hue', () => {
    const failures = HUES.filter((hue) => !checkContract(resolveFamily({ name: 'h', hue })).passes);
    expect(failures).toEqual([]);
  });

  it('keep the worst contract pair comfortably above AA', () => {
    const worst = Math.min(
      ...HUES.map((hue) => checkContract(resolveFamily({ name: 'h', hue })).worst.contrast.wcag),
    );
    expect(worst).toBeGreaterThan(AA);
    // Measured floor is ~4.72 (at the least favourable hue). Pinned at 4.7 so a
    // curve change that quietly eats the margin fails here rather than in a
    // consumer's palette.
    expect(worst).toBeGreaterThanOrEqual(4.7);
  });

  it('are monotone in lightness at every hue', () => {
    const broken = HUES.filter((hue) => !resolveFamily({ name: 'h', hue }).monotone);
    expect(broken).toEqual([]);
  });

  it('emit only displayable colors at every hue', () => {
    for (const hue of HUES) {
      for (const s of resolveFamily({ name: 'h', hue }).swatches) {
        expect(isInGamut(s.oklch), `hue ${hue} step ${s.name}`).toBe(true);
        expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('stay monotone at every supported step count', () => {
    for (const steps of [2, 3, 5, 8, 12, 16, 24]) {
      for (const hue of [0, 75, 150, 200, 260, 320]) {
        const fam = resolveFamily({ name: 'h', hue, steps });
        expect(fam.swatches, `hue ${hue} / ${steps} steps`).toHaveLength(steps);
        expect(fam.monotone, `hue ${hue} / ${steps} steps`).toBe(true);
      }
    }
  });

  it('hold the contract at every hue on the canonical 12-step scale', () => {
    for (const hue of HUES) {
      const r = checkContract(resolveFamily({ name: 'h', hue, steps: 12 }));
      expect(r.passes, `hue ${hue} — worst ${r.worst.contrast.wcag}`).toBe(true);
    }
  });
});

/**
 * CHARACTERIZATION, NOT ENDORSEMENT.
 *
 * The default curves clear the contract on the canonical 12-step scale, and the
 * docstring on `defaultLightness` claims that as the guarantee. It does not
 * survive a change of step count, and this records exactly where it breaks so
 * the failure is visible rather than latent.
 *
 * Cause: `contractRegion` uses K = round(N/3), so the innermost contract pair's
 * normalized gap is (N - 2K + 1)/(N - 1). That oscillates with the rounding and
 * shrinks toward 1/3 as N grows — 0.4545 at N=12, 0.4286 at N=8, 0.391 at N=24.
 * The default lightness ramp clears AA above roughly 0.44 and fails below it,
 * so N=12 passes largely by luck of where the rounding lands.
 *
 * Four of these (8, 11, 14, 15) are reachable from the studio's own 5..16 step
 * slider. When this is fixed — by reshaping the region, or the ramp — this test
 * should fail, and that failure is the fix landing.
 */
describe('known gap: the contract does not survive every step count', () => {
  const failing = (steps: number) =>
    HUES.some((hue) => !checkContract(resolveFamily({ name: 'h', hue, steps })).passes);

  it('holds at these step counts', () => {
    expect([2, 3, 4, 5, 6, 7, 9, 10, 12, 13, 16, 19].filter(failing)).toEqual([]);
  });

  it('fails at these step counts, with default curves, at some hue', () => {
    const counts = Array.from({ length: 23 }, (_, i) => i + 2);
    expect(counts.filter(failing)).toEqual([8, 11, 14, 15, 17, 18, 20, 21, 22, 23, 24]);
  });
});
