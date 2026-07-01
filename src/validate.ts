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

/** Indices of the 4 lightest (backgrounds) and 4 darkest (foregrounds) steps. */
export const LIGHTEST_4 = [0, 1, 2, 3];
export const DARKEST_4 = [8, 9, 10, 11];

/** WCAG AA threshold for normal text. */
export const AA = 4.5;

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
  const fgIdx = opts.fgIndices ?? DARKEST_4;
  const bgIdx = opts.bgIndices ?? LIGHTEST_4;
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
  return family.swatches.map((fg) =>
    family.swatches.map((bg) => evaluate(fg.oklch, bg.oklch)),
  );
}

/** One-line human-readable contract summary, for CLI/logs. */
export function summarizeContract(r: ContractResult): string {
  const w = r.worst;
  const head = `${r.family}: ${r.passes ? 'PASS' : 'FAIL'} — worst ${w.fg.name} on ${w.bg.name} = ${w.contrast.wcag.toFixed(2)} WCAG (APCA ${w.contrast.apca.toFixed(0)})`;
  if (r.passes) return head;
  return `${head}; ${r.failures.length} pair(s) below AA: ${r.failures.map((p) => `${p.fg.name}/${p.bg.name}=${p.contrast.wcag.toFixed(2)}`).join(', ')}`;
}
