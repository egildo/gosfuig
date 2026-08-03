/**
 * Contrast: both models, side by side.
 *
 *  - WCAG 2.1  — the official ratio (1..21). Thresholds: 3 (AA large / UI),
 *    4.5 (AA text), 7 (AAA text). Familiar, audit-friendly, token-tooling-safe.
 *  - APCA      — WCAG 3 draft, perceptual. Returns a signed Lc value (~ -108..106);
 *    sign encodes polarity (positive = dark text on light bg). Magnitude matters:
 *    ~60 ≈ body text, ~45 ≈ large text, ~30 ≈ UI/disabled-ish.
 *
 * Foreground = text/ink, background = surface.
 */
import { wcagContrast } from 'culori';
import { APCAcontrast, sRGBtoY } from 'apca-w3';
import { toHex, toRgb255, parse, type Oklch } from './oklch.js';

export type ColorIn = string | Oklch;

const hexOf = (c: ColorIn): string => (typeof c === 'string' ? c : toHex(c));
const bytesOf = (c: ColorIn): [number, number, number] =>
  toRgb255(typeof c === 'string' ? parse(c) : c);

/** WCAG 2.1 contrast ratio, 1..21. */
export function wcag(fg: ColorIn, bg: ColorIn): number {
  return wcagContrast(hexOf(fg), hexOf(bg));
}

/** APCA Lc, signed (~ -108..106). Use Math.abs for a polarity-agnostic magnitude. */
export function apca(fg: ColorIn, bg: ColorIn): number {
  const lc = APCAcontrast(sRGBtoY(bytesOf(fg)), sRGBtoY(bytesOf(bg)));
  return typeof lc === 'number' ? lc : Number(lc);
}

export interface ContrastVerdict {
  wcag: number;
  /** Signed APCA Lc. */
  apca: number;
  /** WCAG >= 3 (AA large text / UI components). */
  passesAALarge: boolean;
  /** WCAG >= 4.5 (AA body text). */
  passesAA: boolean;
  /** WCAG >= 7 (AAA body text). */
  passesAAA: boolean;
}

export function evaluate(fg: ColorIn, bg: ColorIn): ContrastVerdict {
  const w = wcag(fg, bg);
  return {
    wcag: w,
    apca: apca(fg, bg),
    passesAALarge: w >= 3,
    passesAA: w >= 4.5,
    passesAAA: w >= 7,
  };
}
