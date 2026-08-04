/**
 * Fidelity reporting: the engine says what it could not deliver.
 *
 * The measured fact behind all of this — sRGB holds C 0.309 at magenta but only
 * C 0.150 at cyan — means a requested chroma is often unreachable. Before this,
 * the request was discarded and the reduced value returned as if it were what
 * you asked for.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFamily, chromaLoss } from '../src/family.js';
import { resolvePalette } from '../src/palette.js';
import { isInGamut } from '../src/color/oklch.js';
import { familyNotes, summarizeNotes, MINOR_CHROMA_LOSS } from '../src/validate.js';
import { renderDashboard } from '../src/dashboard/render.js';
import { stringifyConfig } from '../src/config.js';
import { runCli, type CliIO } from '../src/cli.js';

const captureIO = (): CliIO & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (m) => out.push(m), error: (m) => err.push(m) };
};

describe('every swatch records what was asked for', () => {
  it('keeps the request alongside the result', () => {
    const fam = resolveFamily({ name: 'cyan', hue: 200, chroma: 0.16 });
    for (const s of fam.swatches) {
      expect(s.requested).toBeDefined();
      expect(s.oklch.c).toBeLessThanOrEqual(s.requested.c + 1e-9);
      // Gamut mapping only moves chroma; L and H survive untouched.
      expect(s.oklch.l).toBeCloseTo(s.requested.l, 10);
      expect(s.oklch.h).toBeCloseTo(s.requested.h, 10);
    }
  });

  it('flags cyan, where the requested chroma is unreachable', () => {
    // Measured cusp at hue 200 is C 0.150; the bump asks for 0.16 at its peak.
    const fam = resolveFamily({ name: 'cyan', hue: 200, chroma: 0.16 });
    const clamped = fam.swatches.filter((s) => s.clamped);
    expect(clamped.length).toBeGreaterThan(0);
    expect(fam.clampedSteps).toEqual(clamped.map((s) => s.name));

    const worst = clamped.reduce((a, b) => (chromaLoss(b) > chromaLoss(a) ? b : a));
    expect(worst.requested.c).toBeGreaterThan(0.15);
    expect(worst.oklch.c).toBeLessThan(0.12);
    expect(chromaLoss(worst)).toBeGreaterThan(0.03);
  });

  it('does not flag a family whose ramp fits in the gamut', () => {
    // A flat, very low chroma curve stays inside the gamut everywhere — note
    // that a *number* would go through the default bump, whose light floor of
    // 0.025 is itself unreachable at L 0.98 for most hues.
    const fam = resolveFamily({
      name: 'gray',
      hue: 260,
      chroma: { kind: 'constant', value: 0.005 },
    });
    expect(fam.clampedSteps).toEqual([]);
    for (const s of fam.swatches) {
      expect(s.clamped).toBe(false);
      expect(chromaLoss(s)).toBe(0);
    }
  });

  /**
   * CHARACTERIZATION, NOT ENDORSEMENT.
   *
   * The defaults ask for a chroma the gamut cannot give at the lightest step.
   * `defaultChroma`'s floor is C 0.025; `defaultLightness`'s `max` is L 0.98,
   * where sRGB allows only C 0.0093–0.0705 depending on hue. Measured: 49 of 72
   * hues clamp, worst loss 0.0157 at hue 270.
   *
   * (49, not 50: one hue's overshoot was under half a byte and so never left
   * the gamut at all — it was a false positive from a strict boundary test.)
   *
   * Fixing it means changing the defaults — lowering the floor to ~0.009, or
   * lowering `lightMax` to ~0.95 where 0.0236 is reachable — which moves the
   * lightest step of every existing palette. That is a math change, and Phase 4
   * deliberately changed no math. This records the defect so it is visible
   * rather than latent; when it is fixed, this test should fail.
   */
  it('the defaults request an unreachable chroma at the lightest step', () => {
    const clampedHues: number[] = [];
    for (let hue = 0; hue < 360; hue += 5) {
      if (resolveFamily({ name: 'h', hue }).swatches[0]!.clamped) clampedHues.push(hue);
    }
    expect(clampedHues.length).toBe(49);

    const worst = Math.max(
      ...clampedHues.map((hue) => chromaLoss(resolveFamily({ name: 'h', hue }).swatches[0]!)),
    );
    expect(worst).toBeCloseTo(0.0157, 3);
    // Big enough to be reported as real, not filtered away as float noise.
    expect(worst).toBeGreaterThan(MINOR_CHROMA_LOSS);
  });

  it('never reports a clamp for a swatch that was already displayable', () => {
    for (const hue of [0, 60, 120, 180, 240, 300]) {
      for (const s of resolveFamily({ name: 'h', hue, chroma: 0.16 }).swatches) {
        if (isInGamut(s.requested)) expect(s.clamped).toBe(false);
      }
    }
  });

  it('reports no loss for a lock, which is a real color by definition', () => {
    const fam = resolveFamily({ name: 'b', hue: 259, locks: { '700': '#1d4ed8' } });
    const locked = fam.swatches.find((s) => s.name === '700')!;
    expect(locked.clamped).toBe(false);
    expect(locked.hex).toBe('#1d4ed8');
  });

  it('the demo palette clamps somewhere — this was invisible before', () => {
    const p = resolvePalette({
      families: [
        { name: 'blue', hue: 259 },
        { name: 'cyan', hue: 200, chroma: 0.16 },
      ],
    });
    expect(p.families.flatMap((f) => f.clampedSteps).length).toBeGreaterThan(0);
  });
});

describe('familyNotes', () => {
  it('collects clamped steps with their requested and realized chroma', () => {
    const n = familyNotes(resolveFamily({ name: 'cyan', hue: 200, chroma: 0.16 }));
    expect(n.clamped.length).toBeGreaterThan(0);
    expect(n.worstLoss).toBeGreaterThan(0);
    for (const c of n.clamped) expect(c.requested).toBeGreaterThan(c.realized);
  });

  it('carries the monotonicity breaks the engine already computed', () => {
    const fam = resolveFamily({ name: 'x', hue: 200, locks: { '100': '#000000' } });
    expect(familyNotes(fam).monotoneBreaks).toEqual(fam.monotoneBreaks);
    expect(familyNotes(fam).monotoneBreaks.length).toBeGreaterThan(0);
  });
});

describe('summarizeNotes', () => {
  it('is null when there is nothing to report', () => {
    expect(
      summarizeNotes(
        resolveFamily({ name: 'gray', hue: 260, chroma: { kind: 'constant', value: 0.005 } }),
      ),
    ).toBeNull();
  });

  it('demotes a loss below the threshold instead of shouting about it', () => {
    const s = summarizeNotes(resolveFamily({ name: 'blue', hue: 259 }), { minLoss: 0.02 })!;
    expect(s).toContain('clamped slightly');
    expect(s).not.toContain('chroma clamped at');
  });

  it('names the clamped steps and the worst loss', () => {
    const s = summarizeNotes(resolveFamily({ name: 'cyan', hue: 200, chroma: 0.16 }))!;
    expect(s).toContain('chroma clamped');
    expect(s).toMatch(/worst \S+: 0\.\d+ → 0\.\d+/);
    expect(s).toContain('sRGB cannot hold this chroma at this hue');
  });

  it('reports a broken lightness ordering', () => {
    const s = summarizeNotes(resolveFamily({ name: 'x', hue: 200, locks: { '100': '#000000' } }))!;
    expect(s).toContain('lightness not monotone');
  });
});

describe('the three front-ends surface it', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gosfuig-fid-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('the CLI prints a note under the family it belongs to', async () => {
    const cfg = join(dir, 'p.json');
    writeFileSync(
      cfg,
      stringifyConfig({
        families: [
          { name: 'cyan', hue: 200, chroma: 0.16 },
          { name: 'gray', hue: 260, chroma: { kind: 'constant', value: 0.005 } },
        ],
      }),
    );
    const io = captureIO();
    expect(await runCli([cfg, '-o', join(dir, 'out'), '--no-dashboard'], io)).toBe(0);

    const lines = io.out.join('\n').split('\n');
    const cyanAt = lines.findIndex((l) => l.includes('cyan:'));
    expect(lines[cyanAt + 1]).toContain('chroma clamped');
    // The unclamped family gets no note at all.
    const grayAt = lines.findIndex((l) => l.includes('gray:'));
    expect(lines[grayAt + 1] ?? '').not.toContain('chroma clamped');
  });

  it('the dashboard marks clamped swatches and explains the marks', () => {
    const html = renderDashboard(
      resolvePalette({ families: [{ name: 'cyan', hue: 200, chroma: 0.16 }] }),
    );
    expect(html).toContain('class="clamp"');
    expect(html).toContain('reachable in sRGB at hue');
    expect(html).toContain('chroma clamped by the sRGB gamut');
    expect(html).toContain('class="notes"');
  });

  it('the dashboard outlines a step where lightness stops decreasing', () => {
    const html = renderDashboard(
      resolvePalette({ families: [{ name: 'x', hue: 200, locks: { '100': '#000000' } }] }),
    );
    expect(html).toContain('sw nonmono');
    expect(html).toContain('lightness not monotone');
  });

  it('the dashboard says nothing when there is nothing to say', () => {
    const html = renderDashboard(
      resolvePalette({
        families: [{ name: 'gray', hue: 260, chroma: { kind: 'constant', value: 0.005 } }],
      }),
    );
    expect(html).not.toContain('class="notes"');
    expect(html).not.toContain('class="clamp"');
    expect(html).not.toContain('sw nonmono');
  });

  it('tokens.json is unaffected — reporting changes nothing that is emitted', async () => {
    const cfg = join(dir, 'p.json');
    writeFileSync(cfg, stringifyConfig({ families: [{ name: 'cyan', hue: 200, chroma: 0.16 }] }));
    const out = join(dir, 'out');
    await runCli([cfg, '-o', out, '--no-dashboard', '--srgb'], captureIO());
    const tokens = JSON.parse(readFileSync(join(out, 'tokens.json'), 'utf8'));
    // The realized (displayable) color is what ships, exactly as before.
    const fam = resolveFamily({ name: 'cyan', hue: 200, chroma: 0.16 });
    expect(tokens.cyan['500'].$value).toBe(fam.swatches.find((s) => s.name === '500')!.hex);
    expect(JSON.stringify(tokens)).not.toContain('requested');
  });
});
