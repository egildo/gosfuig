/**
 * Validation: prove (or disprove) the accessibility contract, and build the
 * full pairwise contrast matrix the dashboard renders.
 *
 * Policy (decided): report only. Locks are sacred — when a pinned color breaks
 * the contract we surface exactly which pairs fail and by how much; we never
 * mutate the palette to "fix" it.
 */
import { evaluate, type ContrastVerdict } from './color/contrast.js';
import type { Family, Swatch } from './family.js';

/** Indices of the 4 lightest (backgrounds) and 4 darkest (foregrounds) steps of the default 12-step scale. */
export const LIGHTEST_4 = [0, 1, 2, 3];
export const DARKEST_4 = [8, 9, 10, 11];

/** WCAG AA threshold for normal text. */
export const AA = 4.5;

/**
 * The contract region for an N-step family: the lightest-K steps (backgrounds)
 * and darkest-K steps (foregrounds), with K = round(N/3). For N=12 this is the
 * familiar lightest-4 / darkest-4; it scales sensibly for other step counts.
 */
export function contractRegion(count: number): { light: number[]; dark: number[] } {
  const k = Math.max(1, Math.min(Math.round(count / 3), Math.floor(count / 2)));
  const light = Array.from({ length: k }, (_, i) => i);
  const dark = Array.from({ length: k }, (_, i) => count - k + i);
  return { light, dark };
}

export interface PairContrast {
  fg: Swatch;
  bg: Swatch;
  contrast: ContrastVerdict;
}

export interface ContractResult {
  family: string;
  /** Every darkest×lightest pair passes WCAG AA. */
  passes: boolean;
  /** The lowest-contrast pair in the contract region. */
  worst: PairContrast;
  /** Pairs that fail AA (empty when passes === true). */
  failures: PairContrast[];
}

/** Check the "4 darkest as fg on 4 lightest as bg, all WCAG AA" contract. */
export function checkContract(
  family: Family,
  opts: { fgIndices?: number[]; bgIndices?: number[]; threshold?: number } = {},
): ContractResult {
  const region = contractRegion(family.swatches.length);
  const fgIdx = opts.fgIndices ?? region.dark;
  const bgIdx = opts.bgIndices ?? region.light;
  const threshold = opts.threshold ?? AA;

  const failures: PairContrast[] = [];
  let worst: PairContrast | null = null;

  for (const f of fgIdx) {
    for (const b of bgIdx) {
      const fg = family.swatches[f]!;
      const bg = family.swatches[b]!;
      const contrast = evaluate(fg.oklch, bg.oklch);
      const pair: PairContrast = { fg, bg, contrast };
      if (!worst || contrast.wcag < worst.contrast.wcag) worst = pair;
      if (contrast.wcag < threshold) failures.push(pair);
    }
  }

  return {
    family: family.name,
    passes: failures.length === 0,
    worst: worst!,
    failures,
  };
}

/** Full N×N contrast matrix for a family (row = foreground, col = background). */
export function contrastMatrix(family: Family): ContrastVerdict[][] {
  return family.swatches.map((fg) => family.swatches.map((bg) => evaluate(fg.oklch, bg.oklch)));
}

/**
 * What the engine had to change, or couldn't guarantee, for this family.
 *
 * Separate from the contract on purpose. The contract is about accessibility —
 * pass or fail against a threshold. These are about fidelity: the ramp you got
 * is not quite the ramp you asked for, and the engine should say so rather than
 * hand you the difference silently.
 */
export interface FamilyNotes {
  /** Steps whose chroma the sRGB gamut reduced, with what was lost. */
  clamped: { step: string; requested: number; realized: number }[];
  /** The largest single chroma reduction across the family (0 when none). */
  worstLoss: number;
  /** Steps where lightness stops strictly decreasing. */
  monotoneBreaks: string[];
}

export function familyNotes(family: Family): FamilyNotes {
  const clamped = family.swatches
    .filter((s) => s.clamped)
    .map((s) => ({ step: s.name, requested: s.requested.c, realized: s.oklch.c }));
  return {
    clamped,
    worstLoss: clamped.reduce((m, c) => Math.max(m, c.requested - c.realized), 0),
    monotoneBreaks: family.monotoneBreaks,
  };
}

/**
 * The line between a chroma loss worth acting on and one that is float-level
 * noise. A loss of 0.01 in OKLCH chroma is roughly where a surface starts to
 * look visibly less colorful, which makes it the honest place to draw it.
 *
 * This is a presentation threshold only. `Swatch.clamped`, `Swatch.requested`
 * and `familyNotes` stay exact whatever it is set to, and the summary still
 * counts what it demotes — nothing is hidden, only ranked.
 *
 * Note what it does NOT paper over: with the shipped defaults the lightest step
 * clamps at 50 of 72 hues by up to 0.0157, which is above this threshold and so
 * is reported as a real loss. That is a defect in the defaults — `defaultChroma`
 * asks for a floor of C 0.025 at `defaultLightness`'s L 0.98, where sRGB allows
 * only 0.0093–0.0705 by hue — and the right fix is to the defaults, not to this
 * number. See the characterization test in test/fidelity.test.ts.
 */
export const MINOR_CHROMA_LOSS = 0.01;

/**
 * One-line note about fidelity, or null when there is nothing to report.
 * Printed under the contract line by the CLI, and in the dashboard and studio.
 */
export function summarizeNotes(family: Family, opts: { minLoss?: number } = {}): string | null {
  const minLoss = opts.minLoss ?? MINOR_CHROMA_LOSS;
  const n = familyNotes(family);
  const parts: string[] = [];

  const loss = (c: FamilyNotes['clamped'][number]) => c.requested - c.realized;
  const notable = n.clamped.filter((c) => loss(c) >= minLoss);
  const minor = n.clamped.length - notable.length;

  if (notable.length > 0) {
    const worst = notable.reduce((a, b) => (loss(b) > loss(a) ? b : a));
    parts.push(
      `chroma clamped at ${notable.length} step(s) [${notable.map((c) => c.step).join(', ')}] — ` +
        `worst ${worst.step}: ${worst.requested.toFixed(3)} → ${worst.realized.toFixed(3)} ` +
        `(sRGB cannot hold this chroma at this hue)` +
        (minor > 0 ? `; ${minor} more clamped slightly` : ''),
    );
  } else if (minor > 0) {
    parts.push(
      `${minor} step(s) clamped slightly [${n.clamped.map((c) => c.step).join(', ')}] — ` +
        `under ${minLoss} chroma, typical at the ends of the ramp`,
    );
  }

  if (n.monotoneBreaks.length > 0) {
    parts.push(`lightness not monotone at ${n.monotoneBreaks.join(', ')}`);
  }

  return parts.length > 0 ? parts.join('; ') : null;
}

/** True when a family has something a designer would want to act on. */
export function hasNotableLoss(family: Family, minLoss = MINOR_CHROMA_LOSS): boolean {
  return (
    !family.monotone ||
    family.swatches.some((s) => s.clamped && s.requested.c - s.oklch.c >= minLoss)
  );
}

/** One-line human-readable contract summary, for CLI/logs. */
export function summarizeContract(r: ContractResult): string {
  const w = r.worst;
  const head = `${r.family}: ${r.passes ? 'PASS' : 'FAIL'} — worst ${w.fg.name} on ${w.bg.name} = ${w.contrast.wcag.toFixed(2)} WCAG (APCA ${w.contrast.apca.toFixed(0)})`;
  if (r.passes) return head;
  return `${head}; ${r.failures.length} pair(s) below AA: ${r.failures.map((p) => `${p.fg.name}/${p.bg.name}=${p.contrast.wcag.toFixed(2)}`).join(', ')}`;
}
