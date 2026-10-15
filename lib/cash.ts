/**
 * Cash maths for the payment screen. Amounts are integer minor units.
 */
import { currencyFractionDigits } from "./money";

/** Round amounts customers commonly hand over, in major units. */
const ROUND_STEPS = [
  1, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000,
  100000,
];

/**
 * Quick-amount buttons for cash: the exact amount, then the next round
 * amounts above it. 69.30 → 69.30, 70, 80, 100.
 */
export function quickCashAmounts(
  due: number,
  currencyCode: string,
  count = 4,
): number[] {
  if (!Number.isSafeInteger(due) || due <= 0 || count < 1) return [];
  const unit = 10 ** currencyFractionDigits(currencyCode);
  const amounts = new Set<number>([due]);
  for (const step of ROUND_STEPS) {
    const size = step * unit;
    const next = Math.ceil(due / size) * size;
    if (next > due && Number.isSafeInteger(next)) amounts.add(next);
  }
  return [...amounts].sort((a, b) => a - b).slice(0, count);
}

/**
 * Cash handed over toward what's due: the part that pays, and the change.
 * Less than what's due pays part of it (a split payment).
 */
export function applyCash(
  due: number,
  tendered: number,
): { amount: number; change: number } {
  const amount = Math.max(Math.min(tendered, due), 0);
  return { amount, change: Math.max(tendered - amount, 0) };
}

/** Notes and coins in common use, largest first, in minor units. */
const DENOMINATIONS: Record<string, number[]> = {
  GHS: [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 1],
  USD: [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1],
  EUR: [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
  GBP: [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
  NGN: [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500],
  KES: [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 100],
  ZAR: [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10],
  XOF: [10000, 5000, 2000, 1000, 500, 250, 200, 100, 50, 25, 10, 5],
};

/** The built-in notes and coins for a currency, largest first. */
export function defaultDenominations(currencyCode: string): number[] {
  const known = DENOMINATIONS[currencyCode.toUpperCase()];
  if (known) return known;
  const digits = currencyFractionDigits(currencyCode);
  const unit = 10 ** digits;
  const notes = [100, 50, 20, 10, 5, 2, 1].map((n) => n * unit);
  const coins =
    digits >= 2 ? [50, 20, 10, 5, 1].map((c) => (c * unit) / 100) : [];
  return [...notes, ...coins];
}

/** How many of each note and coin: {value in minor units: count}. */
export type CashCount = Record<number, number>;

export function countTotal(count: CashCount): number {
  return Object.entries(count).reduce(
    (sum, [value, n]) => sum + Number(value) * n,
    0,
  );
}

/** What open_shift and close_shift expect: only the non-zero counts. */
export function toCountPayload(count: CashCount): Record<string, number> {
  return Object.fromEntries(Object.entries(count).filter(([, n]) => n > 0));
}
