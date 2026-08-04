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
  normalize,
  isInGamut,
  isStrictlyInGamut,
  gamutClamp,
  toHex,
  toRgb255,
  toCss,
  type Oklch,
} from './color/oklch.js';

// Contrast (WCAG 2.1 + APCA)
export { wcag, apca, evaluate, type ColorIn, type ContrastVerdict } from './color/contrast.js';

// Curves — declarative (CurveSpec, what a config stores) and compiled (Curve,
// what the engine evaluates). `compile` is the bridge between them.
export {
  type Curve,
  type CurveSpec,
  type CurveKind,
  CURVE_KINDS,
  compile,
  isCurveSpec,
  constant,
  linear,
  hueRamp,
  gamma,
  bump,
  bumpPeakFor,
  ramp,
  defaultLightness,
  defaultChroma,
  defaultLightnessSpec,
  defaultChromaSpec,
} from './curves.js';

// Spec validation (untrusted input -> PaletteSpec, or located errors)
export {
  validatePaletteSpec,
  validateFamilySpec,
  parsePaletteSpec,
  formatSpecErrors,
  CONFIG_VERSION,
  type SpecError,
  type SpecResult,
} from './spec.js';

// Templates: the reusable half of a palette, saved under a name
export {
  BUILTIN_TEMPLATES,
  findTemplate,
  templateNames,
  applyTemplate,
  forceTemplate,
  templateFromSpec,
  isTemplate,
  type Template,
} from './template.js';

// The config file format (one reader and one writer, shared by CLI and studio)
export {
  stringifyConfig,
  parseConfig,
  normalizeConfig,
  readExtension,
  withExtension,
} from './config.js';

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
  chromaLoss,
  hueDelta,
  type NamedColor,
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
  familyNotes,
  summarizeNotes,
  hasNotableLoss,
  MINOR_CHROMA_LOSS,
  type FamilyNotes,
  contractRegion,
  LIGHTEST_4,
  DARKEST_4,
  AA,
  type PairContrast,
  type ContractResult,
} from './validate.js';

// Exports
export { toW3CTokens, type W3CExportOptions, type ColorToken } from './export/w3c.js';

// Token shape: naming, grouping and nesting of the emitted tree (reshape only)
export {
  slugify,
  shapeEntries,
  assemble,
  resolveShape,
  SLUG_STYLES,
  type TokenShape,
  type SlugStyle,
} from './export/shape.js';
export { renderDashboard } from './dashboard/render.js';
