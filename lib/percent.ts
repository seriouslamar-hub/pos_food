import { MoneyParseError, parseMoney } from "./money";

/**
 * Percentages are stored as integer basis points (1000 = 10%). Typed input is
 * parsed with the same decimal-string logic as money, so "12.5" becomes 1250
 * exactly, with no floating-point rounding.
 */
export function parsePercentToBps(input: string): number {
  // Two decimals of a percent are exactly basis points.
  return parseMoney(input.replace(/%\s*$/, ""));
}

/** "12.5%" style text for basis points. */
export function formatBps(bps: number): string {
  if (!Number.isSafeInteger(bps))
    throw new TypeError(`Expected integer basis points, got ${bps}`);
  const sign = bps < 0 ? "-" : "";
  const abs = Math.abs(bps);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}%`;
}

/** Basis points as an editable percent string without the % sign. */
export function bpsToPercentInput(bps: number): string {
  return formatBps(bps).slice(0, -1);
}

export { MoneyParseError as PercentParseError };
