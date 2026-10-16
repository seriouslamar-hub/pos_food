/**
 * Promotions for the cart preview. submit_order works them out on the
 * server (apply_promotions); this mirrors it so the cashier sees the same
 * totals. The server also enforces usage limits, which the till can't see.
 *
 * Promotions run highest priority first (then oldest). Each takes its
 * amount off what's left on the qualifying lines after staff discounts and
 * earlier promotions. A promotion that doesn't stack is used only alone.
 */
import { allocateDiscount, roundDiv } from "./pricing";

export type PromotionType =
  "percent_off" | "amount_off" | "fixed_price" | "buy_x_get_y";

/** A promotion as the till gets it (get_menu, check_coupon). */
export type MenuPromotion = {
  id: string;
  name: string;
  description: string | null;
  type: PromotionType;
  value: number;
  item_ids: string[];
  category_ids: string[];
  buy_quantity: number | null;
  get_quantity: number | null;
  get_discount_bps: number;
  start_date: string | null;
  end_date: string | null;
  days_of_week: number[];
  start_time: string | null;
  end_time: string | null;
  branch_ids: string[];
  channels: string[];
  order_types: string[];
  min_spend: number;
  priority: number;
  stackable: boolean;
  has_coupon: boolean;
  needs_customer: boolean;
  created_at: string;
};

export type LoyaltySettings = {
  enabled: boolean;
  /** Minor units spent per point earned. */
  earn_per: number;
  /** What a point is worth when spent, in minor units. */
  point_value: number;
};

export type PromoLine = {
  id: string;
  menuItemId: string;
  categoryId: string | null;
  quantity: number;
  /** What's left to pay on the line before tax. */
  left: number;
};

/** The local date, time and ISO weekday (1 = Monday) in a timezone. */
export function localParts(
  at: Date,
  timeZone: string,
): { date: string; time: string; isoDow: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(at);
  } catch {
    return localParts(at, "UTC");
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
    isoDow: days.indexOf(get("weekday")) + 1,
  };
}

/** "12:00" or "12:00:00" → "12:00:00", for comparing times as text. */
function fullTime(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

/** Whether a promotion runs at a branch at a local time. Mirrors public.promotion_runs. */
export function promotionRuns(
  p: MenuPromotion,
  branchId: string,
  local: { date: string; time: string; isoDow: number },
): boolean {
  return (
    (p.start_date === null || p.start_date <= local.date) &&
    (p.end_date === null || p.end_date >= local.date) &&
    (p.days_of_week.length === 0 || p.days_of_week.includes(local.isoDow)) &&
    (p.start_time === null ||
      p.end_time === null ||
      (local.time >= fullTime(p.start_time) &&
        local.time < fullTime(p.end_time))) &&
    (p.branch_ids.length === 0 || p.branch_ids.includes(branchId))
  );
}

/** What a promotion takes off each line. Mirrors public.promotion_line_discounts. */
export function promotionLineDiscounts(
  p: MenuPromotion,
  lines: PromoLine[],
): Map<string, number> {
  const qualifying = lines.filter(
    (l) =>
      l.left > 0 &&
      ((p.item_ids.length === 0 && p.category_ids.length === 0) ||
        p.item_ids.includes(l.menuItemId) ||
        (l.categoryId !== null && p.category_ids.includes(l.categoryId))),
  );
  const out = new Map<string, number>();
  if (qualifying.length === 0) return out;
  const lefts = qualifying.map((l) => l.left);
  const total = lefts.reduce((a, b) => a + b, 0);
  let result: number[];
  if (p.type === "percent_off") {
    result = allocateDiscount(roundDiv(total * p.value, 10000), lefts);
  } else if (p.type === "amount_off") {
    result = allocateDiscount(Math.min(p.value, total), lefts);
  } else if (p.type === "fixed_price") {
    result = qualifying.map((l) => Math.max(0, l.left - p.value * l.quantity));
  } else {
    // Every unit at its share of the line, dearest first; in each full
    // group of X + Y units the last Y (the cheapest) are off.
    result = qualifying.map(() => 0);
    const group = (p.buy_quantity ?? 1) + (p.get_quantity ?? 1);
    const units: { i: number; u: number; price: number }[] = [];
    qualifying.forEach((l, i) => {
      const base = Math.floor(l.left / l.quantity);
      const extra = l.left % l.quantity;
      for (let u = 1; u <= l.quantity; u++)
        units.push({ i, u, price: base + (u <= extra ? 1 : 0) });
    });
    units.sort((a, b) => b.price - a.price || a.i - b.i || a.u - b.u);
    const counted = Math.floor(units.length / group) * group;
    for (let k = 0; k < counted; k++) {
      if (k % group >= (p.buy_quantity ?? 1)) {
        const unit = units[k];
        result[unit.i] += roundDiv(unit.price * p.get_discount_bps, 10000);
      }
    }
  }
  qualifying.forEach((l, i) => {
    const amount = Math.min(result[i], l.left);
    if (amount > 0) out.set(l.id, amount);
  });
  return out;
}

/** Plain text order (as Postgres orders uuids), not the locale's. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type AppliedPromotion = { id: string; name: string; amount: number };

/**
 * The promotions an order gets and what each takes off each line.
 * Mirrors public.apply_promotions (without usage limits).
 */
export function applyPromotions(
  promotions: MenuPromotion[],
  order: {
    branchId: string;
    channel: string;
    orderType: string;
    hasCustomer: boolean;
    local: { date: string; time: string; isoDow: number };
  },
  lines: PromoLine[],
): { applied: AppliedPromotion[]; perLine: Map<string, number> } {
  const candidates = promotions
    .filter(
      (p) =>
        promotionRuns(p, order.branchId, order.local) &&
        (p.channels.length === 0 || p.channels.includes(order.channel)) &&
        (p.order_types.length === 0 || p.order_types.includes(order.orderType)),
    )
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        compareText(a.created_at, b.created_at) ||
        compareText(a.id, b.id),
    );
  const left = new Map(lines.map((l) => [l.id, l.left]));
  const perLine = new Map<string, number>();
  const applied: AppliedPromotion[] = [];
  let exclusiveApplied = false;
  for (const p of candidates) {
    if (applied.length > 0 && exclusiveApplied) break;
    if (applied.length > 0 && !p.stackable) continue;
    if (p.needs_customer && !order.hasCustomer) continue;
    const current = lines.map((l) => ({ ...l, left: left.get(l.id) ?? 0 }));
    const orderLeft = current.reduce((sum, l) => sum + l.left, 0);
    if (orderLeft < p.min_spend) continue;
    const discounts = promotionLineDiscounts(p, current);
    let amount = 0;
    for (const [id, d] of discounts) {
      amount += d;
      left.set(id, (left.get(id) ?? 0) - d);
      perLine.set(id, (perLine.get(id) ?? 0) + d);
    }
    if (amount <= 0) continue;
    applied.push({ id: p.id, name: p.name, amount });
    if (!p.stackable) exclusiveApplied = true;
  }
  return { applied, perLine };
}

/**
 * Points spent as a discount: the amount (never more than what's left) and
 * the points it uses. Mirrors public.apply_loyalty_redemption.
 */
export function loyaltyRedemption(
  points: number,
  pointValue: number,
  left: number,
): { amount: number; points: number } {
  if (points <= 0 || left <= 0) return { amount: 0, points: 0 };
  const amount = Math.min(points * pointValue, left);
  return { amount, points: Math.ceil(amount / pointValue) };
}

/** Points an order earns once paid. Mirrors public.loyalty_earn. */
export function pointsEarned(total: number, earnPer: number): number {
  return earnPer > 0 ? Math.floor(total / earnPer) : 0;
}
