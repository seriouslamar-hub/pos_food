/**
 * One-time device setup codes, e.g. "K7QM2-XH9PD". Ten characters from a
 * 31-letter alphabet without look-alikes (no 0/O, 1/I/L): about 49 bits, so
 * guessing one inside its 24-hour life isn't practical. Only a SHA-256 hash
 * is stored.
 */

export const SETUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const SETUP_CODE_LENGTH = 10;
export const SETUP_CODE_TTL_HOURS = 24;

/** Generates a code using crypto-quality randomness. */
export function generateSetupCode(randomInt: (max: number) => number): string {
  let raw = "";
  for (let i = 0; i < SETUP_CODE_LENGTH; i++) {
    raw += SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)];
  }
  return formatSetupCode(raw);
}

/** "K7QM2XH9PD" → "K7QM2-XH9PD" */
export function formatSetupCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/**
 * Normalises typed input: case, spaces and dashes don't matter. Characters
 * that aren't in the alphabet (such as O, 0, 1, I and L) are rejected rather
 * than guessed. Returns null if the input can't be a valid code.
 */
export function normalizeSetupCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, "");
  if (raw.length !== SETUP_CODE_LENGTH) return null;
  for (const ch of raw) {
    if (!SETUP_CODE_ALPHABET.includes(ch)) return null;
  }
  return raw;
}
