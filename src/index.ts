/**
 * gosfuig — perceptual (OKLCH) design-system palette generator.
 *
 * Public API barrel. Consumers import from here:
 *
 *   import { resolvePalette, seedFamily, toW3CTokens } from 'gosfuig';
 *
 * The library is UI-free; the studio and dashboard are separate front-ends.
 */

// Color engine
export {
  parse,
  isInGamut,
  gamutClamp,
  toHex,
  toRgb255,
  toCss,
  type Oklch,
} from './color/oklch.js';

// Contrast (WCAG 2.1 + APCA)
export {
  wcag,
  apca,
  evaluate,
  type ColorIn,
  type ContrastVerdict,
} from './color/contrast.js';

// Curves
export {
  type Curve,
  constant,
  linear,
  hueRamp,
  gamma,
  bump,
  bumpPeakFor,
  ramp,
  defaultLightness,
  defaultChroma,
} from './curves.js';

// Step scales / naming
export {
  STEP_NAMES,
  STEP_COUNT,
  STEP_T,
  DEFAULT_SCALE,
  makeScale,
  stepIndex,
  type StepName,
  type Scale,
} from './naming.js';

// Families (declarative + seed-driven)
export {
  resolveFamily,
  seedFamily,
  type FamilySpec,
  type SeedSpec,
  type Swatch,
  type Family,
} from './family.js';

// Palettes
export { resolvePalette, type PaletteSpec, type Palette } from './palette.js';

// Validation (contract + contrast matrix)
export {
  checkContract,
  contrastMatrix,
  summarizeContract,
  contractRegion,
  LIGHTEST_4,
  DARKEST_4,
  AA,
  type PairContrast,
  type ContractResult,
} from './validate.js';

// Exports
export { toW3CTokens, type W3CExportOptions } from './export/w3c.js';
export { renderDashboard } from './dashboard/render.js';
