/**
 * Step naming. 12 steps, light -> dark, using the familiar design-system
 * suffix convention extended by one (`25`) at the light end.
 */
export const STEP_NAMES = [
  '25', '50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950',
] as const;

export type StepName = (typeof STEP_NAMES)[number];

export const STEP_COUNT = STEP_NAMES.length; // 12

/** Position of each step on the 0..1 ramp (t=0 lightest, t=1 darkest). */
export const STEP_T = STEP_NAMES.map((_, i) => i / (STEP_COUNT - 1));

/** Resolve a lock key (a step name like "500", or a 0..11 index) to an index. */
export function stepIndex(key: StepName | number): number {
  if (typeof key === 'number') {
    if (key < 0 || key >= STEP_COUNT || !Number.isInteger(key)) {
      throw new Error(`gosfuig: step index ${key} out of range 0..${STEP_COUNT - 1}`);
    }
    return key;
  }
  const i = STEP_NAMES.indexOf(key);
  if (i < 0) throw new Error(`gosfuig: unknown step name "${key}"`);
  return i;
}
