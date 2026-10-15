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
