/**
 * Cart preview maths. The server (submit_order) is the source of truth; this
 * mirrors it exactly so the cashier sees the same totals before sending.
 *
 * Per line: unit = item price + modifier deltas + combo upcharges + part
 * modifier deltas (never below zero), or the price the cashier typed;
 * gross = unit × quantity. Then the line's own discount, then its share of
 * the order discount (shared by what's left on each line). Inclusive taxes
 * are extracted from what's left, exclusive taxes are charged on the net.
 * Promotions and loyalty points come off after staff discounts and before
 * tax (lib/promotions.ts). All amounts are integer minor units, rounded
 * half away from zero.
 */
import type { Cart, CartLine, Discount } from "./cart";
import { comboProblems, modifierProblems } from "./choices";
import type { MenuDoc, MenuIndex, MenuTax } from "./menu";
import {
  applyPromotions,
  localParts,
  loyaltyRedemption,
  pointsEarned,
  type AppliedPromotion,
} from "./promotions";

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

/**
 * What a discount takes off an amount. Mirrors public.discount_amount. A
 * fixed discount is capped at the amount here; the server refuses one that
 * is more, and the preview flags it as a problem.
 */
export function discountAmount(
  discount: Discount | null | undefined,
  amount: number,
): number {
  if (!discount) return 0;
  if (discount.type === "percent")
    return roundDiv(amount * discount.value, 10000);
  return Math.min(discount.value, amount);
}

/**
 * Shares a discount across amounts so the shares add up exactly: each gets
 * the whole part of its share, and what's left goes one unit at a time to
 * the largest remainders, earlier first on ties. Mirrors
 * public.allocate_discount (in BigInt, so large amounts stay exact).
 */
export function allocateDiscount(
  discount: number,
  amounts: number[],
): number[] {
  const sum = amounts.reduce((total, a) => total + a, 0);
  if (amounts.length === 0) return [];
  if (sum <= 0 || discount <= 0) return amounts.map(() => 0);
  const d = BigInt(discount);
  const total = BigInt(sum);
  const shares = amounts.map((a) => (d * BigInt(a)) / total);
  const remainders = amounts.map((a) => (d * BigInt(a)) % total);
  let left = d - shares.reduce((acc, x) => acc + x, 0n);
  const order = amounts
    .map((_, i) => i)
    .sort((i, j) =>
      remainders[j] > remainders[i]
        ? 1
        : remainders[j] < remainders[i]
          ? -1
          : i - j,
    );
  for (const i of order) {
    if (left <= 0n) break;
    shares[i] += 1n;
    left -= 1n;
  }
  return shares.map(Number);
}

export type LinePrice = {
  unitPrice: number;
  gross: number;
  /** Everything off the line: its own discount, its share of the order
   * discount, promotions and points. */
  discount: number;
  promoDiscount: number;
  loyaltyDiscount: number;
  orderDiscountShare: number;
  tax: number;
  total: number;
  taxes: TaxLine[];
  problems: string[];
};

type LineBase = {
  line: CartLine;
  taxCategory: string | null;
  categoryId: string | null;
  unitPrice: number;
  gross: number;
  ownDiscount: number;
  problems: string[];
};

function baseLine(line: CartLine, index: MenuIndex): LineBase {
  const item = index.items.get(line.menuItemId);
  if (!item) {
    return {
      line,
      taxCategory: null,
      categoryId: null,
      unitPrice: 0,
      gross: 0,
      ownDiscount: 0,
      problems: ["This item is no longer on the menu"],
    };
  }
  const unit = line.price
    ? line.price.unitPrice
    : (unitPrice(line, index) ?? 0);
  const gross = unit * line.quantity;
  const problems = [
    ...(item.is_available ? [] : [`${item.name} is out of stock`]),
    ...modifierProblems(item, line.modifierIds),
    ...(item.type === "combo" ? comboProblems(item, line.combo, index) : []),
    ...(line.discount?.type === "fixed" && line.discount.value > gross
      ? [`The discount on ${item.name} is more than its price`]
      : []),
  ];
  return {
    line,
    taxCategory: item.tax_category,
    categoryId: item.category_id,
    unitPrice: unit,
    gross,
    ownDiscount: discountAmount(line.discount, gross),
    problems,
  };
}

export type CartTotals = {
  lines: Map<string, LinePrice>;
  subtotal: number;
  /** Every discount: staff discounts, promotions and points. */
  discountTotal: number;
  /** Discounts staff gave (compared with their discount limit). */
  staffDiscountTotal: number;
  /** The order discount (already included in discountTotal). */
  orderDiscount: number;
  promotionTotal: number;
  promotions: AppliedPromotion[];
  /** Points spent and what they took off. */
  loyaltyPoints: number;
  loyaltyDiscount: number;
  /** Points the order will earn once paid (with a customer). */
  pointsToEarn: number;
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
  at: Date = new Date(),
): CartTotals {
  const bases = cart.lines.map((line) => baseLine(line, index));
  const left = bases.map((b) => b.gross - b.ownDiscount);
  const leftTotal = left.reduce((sum, amount) => sum + amount, 0);
  const orderDiscount = discountAmount(cart.discount, leftTotal);
  const shares = allocateDiscount(orderDiscount, left);

  // Promotions, then points, on what's left after staff discounts.
  const promoLines = bases.map((b, i) => ({
    id: b.line.id,
    menuItemId: b.line.menuItemId,
    categoryId: b.categoryId,
    quantity: b.line.quantity,
    left: Math.max(0, left[i] - shares[i]),
  }));
  const promos = applyPromotions(
    [
      ...(menu.promotions ?? []),
      ...(cart.coupon ? [cart.coupon.promotion] : []),
    ],
    {
      branchId: menu.branch_id,
      channel: "counter",
      orderType: cart.orderType,
      hasCustomer: Boolean(cart.customer),
      local: localParts(at, menu.timezone),
    },
    promoLines,
  );
  const afterPromo = promoLines.map(
    (l) => l.left - (promos.perLine.get(l.id) ?? 0),
  );
  const loyalty = menu.loyalty;
  const redemption =
    cart.customer && loyalty?.enabled
      ? loyaltyRedemption(
          Math.min(cart.redeemPoints ?? 0, cart.customer.pointsBalance),
          loyalty.point_value,
          afterPromo.reduce((sum, a) => sum + a, 0),
        )
      : { amount: 0, points: 0 };
  const loyaltyShares = allocateDiscount(redemption.amount, afterPromo);

  const lines = new Map<string, LinePrice>();
  const byTax = new Map<
    string,
    { name: string; rateBps: number; inclusive: boolean; amount: number }
  >();
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  let total = 0;
  const problems: string[] = [];
  if (cart.discount?.type === "fixed" && cart.discount.value > leftTotal) {
    problems.push("The order discount is more than the order");
  }
  let staffDiscountTotal = 0;
  bases.forEach((base, i) => {
    const promoDiscount = promos.perLine.get(base.line.id) ?? 0;
    const discount =
      base.ownDiscount + shares[i] + promoDiscount + loyaltyShares[i];
    staffDiscountTotal += base.ownDiscount + shares[i];
    const taxes =
      base.taxCategory === null
        ? { taxes: [], tax: 0, total: 0 }
        : lineTaxes(base.gross - discount, base.taxCategory, menu.taxes);
    const price: LinePrice = {
      unitPrice: base.unitPrice,
      gross: base.gross,
      discount,
      promoDiscount,
      loyaltyDiscount: loyaltyShares[i],
      orderDiscountShare: shares[i],
      tax: taxes.tax,
      total: taxes.total,
      taxes: taxes.taxes,
      problems: base.problems,
    };
    lines.set(base.line.id, price);
    subtotal += price.gross;
    discountTotal += discount;
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
  });
  return {
    lines,
    subtotal,
    discountTotal,
    staffDiscountTotal,
    orderDiscount,
    promotionTotal: promos.applied.reduce((sum, p) => sum + p.amount, 0),
    promotions: promos.applied,
    loyaltyPoints: redemption.points,
    loyaltyDiscount: redemption.amount,
    pointsToEarn:
      cart.customer && loyalty?.enabled
        ? pointsEarned(total, loyalty.earn_per)
        : 0,
    taxTotal,
    total,
    taxes: [...byTax.values()],
    problems,
  };
}

/**
 * Staff discounts as a share of the subtotal, in basis points: what's
 * compared with the cashier's discount limit (all staff discounts
 * together; promotions and points don't count).
 */
export function overDiscountLimit(
  totals: Pick<CartTotals, "staffDiscountTotal" | "subtotal">,
  limitBps: number,
): boolean {
  return totals.staffDiscountTotal * 10000 > limitBps * totals.subtotal;
}
