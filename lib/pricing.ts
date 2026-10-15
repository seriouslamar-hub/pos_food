/**
 * Cart preview maths. The server (submit_order) is the source of truth; this
 * mirrors it exactly so the cashier sees the same totals before sending.
 *
 * Per line: unit = item price + modifier deltas + combo upcharges + part
 * modifier deltas (never below zero); gross = unit × quantity; inclusive
 * taxes are extracted from gross, exclusive taxes are charged on the net.
 * All amounts are integer minor units, rounded half away from zero.
 */
import type { Cart, CartLine } from "./cart";
import { comboProblems, modifierProblems } from "./choices";
import type { MenuDoc, MenuIndex, MenuTax } from "./menu";

/** numerator / denominator rounded half away from zero. Mirrors public.round_div. */
export function roundDiv(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new RangeError("denominator must be positive");
  if (numerator >= 0)
    return Math.floor((2 * numerator + denominator) / (2 * denominator));
  return -Math.floor((2 * -numerator + denominator) / (2 * denominator));
}

export type TaxLine = {
  taxId: string;
  name: string;
  rateBps: number;
  inclusive: boolean;
  amount: number;
};

/** Taxes on one line's gross amount. Mirrors public.line_taxes. */
export function lineTaxes(
  gross: number,
  taxCategory: string,
  taxes: MenuTax[],
): { taxes: TaxLine[]; tax: number; total: number } {
  const applicable = taxes.filter((t) => t.tax_category === taxCategory);
  const inclusive = applicable.filter((t) => t.is_inclusive);
  const exclusive = applicable.filter((t) => !t.is_inclusive);
  const inclusiveRate = inclusive.reduce((sum, t) => sum + t.rate_bps, 0);

  const lines: TaxLine[] = [];
  let inclusiveTotal = 0;
  for (const t of inclusive) {
    const amount = roundDiv(gross * t.rate_bps, 10000 + inclusiveRate);
    inclusiveTotal += amount;
    lines.push({
      taxId: t.id,
      name: t.name,
      rateBps: t.rate_bps,
      inclusive: true,
      amount,
    });
  }
  const net = gross - inclusiveTotal;
  let exclusiveTotal = 0;
  for (const t of exclusive) {
    const amount = roundDiv(net * t.rate_bps, 10000);
    exclusiveTotal += amount;
    lines.push({
      taxId: t.id,
      name: t.name,
      rateBps: t.rate_bps,
      inclusive: false,
      amount,
    });
  }
  return {
    taxes: lines,
    tax: inclusiveTotal + exclusiveTotal,
    total: gross + exclusiveTotal,
  };
}

function modifierDelta(ids: string[], index: MenuIndex): number {
  return ids.reduce(
    (sum, id) => sum + (index.modifiers.get(id)?.price_delta ?? 0),
    0,
  );
}

/** Price of one unit of a cart line, or null if the item is gone from the menu. */
export function unitPrice(
  line: Pick<CartLine, "menuItemId" | "modifierIds" | "combo">,
  index: MenuIndex,
): number | null {
  const item = index.items.get(line.menuItemId);
  if (!item) return null;
  let unit = item.price + modifierDelta(line.modifierIds, index);
  if (item.type === "combo") {
    for (const choice of line.combo) {
      const slot = item.combo_slots.find((s) => s.id === choice.slotId);
      const option = slot?.options.find(
        (o) => o.menu_item_id === choice.menuItemId,
      );
      unit +=
        (option?.upcharge ?? 0) + modifierDelta(choice.modifierIds, index);
    }
  }
  return Math.max(unit, 0);
}

export type LinePrice = {
  unitPrice: number;
  gross: number;
  tax: number;
  total: number;
  taxes: TaxLine[];
  problems: string[];
};

export function priceLine(
  line: CartLine,
  menu: MenuDoc,
  index: MenuIndex,
): LinePrice {
  const item = index.items.get(line.menuItemId);
  if (!item) {
    return {
      unitPrice: 0,
      gross: 0,
      tax: 0,
      total: 0,
      taxes: [],
      problems: ["This item is no longer on the menu"],
    };
  }
  const unit = unitPrice(line, index) ?? 0;
  const gross = unit * line.quantity;
  const taxes = lineTaxes(gross, item.tax_category, menu.taxes);
  const problems = [
    ...(item.is_available ? [] : [`${item.name} is out of stock`]),
    ...modifierProblems(item, line.modifierIds),
    ...(item.type === "combo" ? comboProblems(item, line.combo, index) : []),
  ];
  return {
    unitPrice: unit,
    gross,
    tax: taxes.tax,
    total: taxes.total,
    taxes: taxes.taxes,
    problems,
  };
}

export type CartTotals = {
  lines: Map<string, LinePrice>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  /** Tax breakdown for the receipt, by tax name. */
  taxes: {
    name: string;
    rateBps: number;
    inclusive: boolean;
    amount: number;
  }[];
  problems: string[];
};

export function priceCart(
  cart: Cart,
  menu: MenuDoc,
  index: MenuIndex,
): CartTotals {
  const lines = new Map<string, LinePrice>();
  const byTax = new Map<
    string,
    { name: string; rateBps: number; inclusive: boolean; amount: number }
  >();
  let subtotal = 0;
  let taxTotal = 0;
  let total = 0;
  const problems: string[] = [];
  for (const line of cart.lines) {
    const price = priceLine(line, menu, index);
    lines.set(line.id, price);
    subtotal += price.gross;
    taxTotal += price.tax;
    total += price.total;
    problems.push(...price.problems);
    for (const t of price.taxes) {
      const key = `${t.name}|${t.rateBps}|${t.inclusive}`;
      const entry = byTax.get(key) ?? {
        name: t.name,
        rateBps: t.rateBps,
        inclusive: t.inclusive,
        amount: 0,
      };
      entry.amount += t.amount;
      byTax.set(key, entry);
    }
  }
  return {
    lines,
    subtotal,
    discountTotal: 0,
    taxTotal,
    total,
    taxes: [...byTax.values()],
    problems,
  };
}
