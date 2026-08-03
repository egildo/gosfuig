/**
 * Step naming and scales.
 *
 * The default scale is 12 steps, light -> dark, using the familiar design-system
 * suffix convention extended by one (`25`) at the light end. Families may opt
 * into a different step count (FamilySpec.steps) via a Scale; names for
 * non-default counts are generated on a 50..950 numeric ladder.
 */
export const STEP_NAMES = [
  '25',
  '50',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
  '950',
] as const;

export type StepName = (typeof STEP_NAMES)[number];

export const STEP_COUNT = STEP_NAMES.length; // 12

/** Position of each step on the 0..1 ramp (t=0 lightest, t=1 darkest). */
export const STEP_T = STEP_NAMES.map((_, i) => i / (STEP_COUNT - 1));

/** A resolved step scale: ordered names and their 0..1 ramp positions. */
export interface Scale {
  /** Number of steps. */
  count: number;
  /** Step names, light -> dark. */
  names: string[];
  /** Position of each step on the 0..1 ramp (t=0 lightest, t=1 darkest). */
  t: number[];
  /** Resolve a step name or 0-based index to an index (throws if unknown). */
  indexOf(key: string | number): number;
}

// Non-default counts draw names from this ladder (25 is reserved for the
// canonical 12-step scale's extra light tint).
const NAME_LADDER = [
  50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950,
];

function generateNames(count: number): string[] {
  if (count === STEP_COUNT) return [...STEP_NAMES];
  const names: string[] = [];
  if (count <= NAME_LADDER.length) {
    // Evenly spaced, strictly-increasing picks from the ladder.
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      let idx = Math.round((i * (NAME_LADDER.length - 1)) / (count - 1));
      if (idx < cursor) idx = cursor;
      names.push(String(NAME_LADDER[idx]!));
      cursor = idx + 1;
    }
  } else {
    // Beyond the ladder: evenly spaced multiples of 10 on 50..950.
    for (let i = 0; i < count; i++) {
      names.push(String(50 + Math.round((900 * i) / (count - 1) / 10) * 10));
    }
  }
  return names;
}

/** Build a step scale for `count` steps (default 12 = the canonical named scale). */
export function makeScale(count: number = STEP_COUNT): Scale {
  if (!Number.isInteger(count) || count < 2) {
    throw new Error(`gosfuig: step count must be an integer >= 2 (got ${count})`);
  }
  const names = generateNames(count);
  const t = names.map((_, i) => i / (count - 1));
  const indexOf = (key: string | number): number => {
    if (typeof key === 'number') {
      if (!Number.isInteger(key) || key < 0 || key >= count) {
        throw new Error(`gosfuig: step index ${key} out of range 0..${count - 1}`);
      }
      return key;
    }
    const i = names.indexOf(key);
    if (i < 0) throw new Error(`gosfuig: unknown step name "${key}" for a ${count}-step scale`);
    return i;
  };
  return { count, names, t, indexOf };
}

/** The default 12-step scale. */
export const DEFAULT_SCALE = makeScale(STEP_COUNT);

/** Resolve a lock key (a step name like "500", or a 0..11 index) to an index on the default scale. */
export function stepIndex(key: StepName | number): number {
  return DEFAULT_SCALE.indexOf(key);
}
