/** The PIN lengths offered when choosing one; the API accepts 4 to 8 digits. */
export const PIN_LENGTHS = [4, 6] as const;
export type PinLength = (typeof PIN_LENGTHS)[number];

export const DEFAULT_PIN_LENGTH: PinLength = 4;

export function isPin(value: string, length: number): boolean {
  return value.length === length && /^[0-9]+$/.test(value);
}

/** The digit a key press stands for, from the number row or the numeric keypad. */
export function digitFromKey(key: string): string | null {
  return /^[0-9]$/.test(key) ? key : null;
}
