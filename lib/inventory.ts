/**
 * Inventory helpers: units, quantities (up to 3 decimals, e.g. 0.15 kg) and
 * stock levels. Costs are integer minor units per unit (money rules).
 */

export const STOCK_UNITS = ["pc", "g", "kg", "ml", "l", "pack"] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

export const UNIT_LABELS: Record<StockUnit, string> = {
  pc: "pieces",
  g: "grams",
  kg: "kilograms",
  ml: "millilitres",
  l: "litres",
  pack: "packs",
};

export const WASTE_REASONS = [
  "Expired",
  "Dropped",
  "Overcooked",
  "Damaged",
  "Other",
];

/** A typed quantity as a number with at most 3 decimals, or null. */
export function parseQuantity(input: string): number | null {
  const text = input.trim().replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(text)) return null;
  return Number(text);
}

/** 0.15 kg, 12 pc: no trailing zeros. */
export function formatQuantity(
  quantity: number | string,
  unit?: StockUnit,
): string {
  const value = Number(quantity);
  const text = Number.isFinite(value)
    ? value.toFixed(3).replace(/\.?0+$/, "")
    : String(quantity);
  return unit ? `${text} ${unit}` : text;
}

/** Below the reorder level (and the level is set). */
export function isLowStock(
  onHand: number | string,
  reorderLevel: number | string,
): boolean {
  const level = Number(reorderLevel);
  return level > 0 && Number(onHand) < level;
}
