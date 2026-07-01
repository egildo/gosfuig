/** Minimal ambient types for apca-w3 (the package ships no declarations). */
declare module 'apca-w3' {
  /** sRGB byte triple [0..255] -> screen luminance Y. */
  export function sRGBtoY(rgb: [number, number, number]): number;
  /**
   * APCA contrast. Given text and background luminance (from sRGBtoY),
   * returns the signed Lc value (number), or a string in alternate call forms.
   */
  export function APCAcontrast(textY: number, bgY: number): number | string;
}
