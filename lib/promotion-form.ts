import { MoneyParseError, parseMoney, toMoneyInput } from "./money";
import { bpsToPercentInput, parsePercentToBps } from "./percent";
import type { PromotionType } from "./promotions";

/** The promotion form as typed (all text), shared by the page and the action. */
export type PromotionFormValues = {
  name: string;
  description: string;
  type: PromotionType;
  /** percent_off; for buy_x_get_y the discount on the free items (100 = free). */
  percent: string;
  /** amount_off: off the order; fixed_price: each item's price. */
  amount: string;
  buyQuantity: string;
  getQuantity: string;
  itemIds: string[];
  categoryIds: string[];
  startDate: string;
  endDate: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  branchIds: string[];
  channels: string[];
  orderTypes: string[];
  minSpend: string;
  couponCode: string;
  maxUses: string;
  maxUsesPerCustomer: string;
  priority: string;
  stackable: boolean;
  isActive: boolean;
};

export type PromotionRow = {
  name: string;
  description: string | null;
  type: PromotionType;
  value: number;
  buy_quantity: number | null;
  get_quantity: number | null;
  get_discount_bps: number;
  item_ids: string[];
  category_ids: string[];
  start_date: string | null;
  end_date: string | null;
  days_of_week: number[];
  start_time: string | null;
  end_time: string | null;
  branch_ids: string[];
  channels: string[];
  order_types: string[];
  min_spend: number;
  coupon_code: string | null;
  max_uses: number | null;
  max_uses_per_customer: number | null;
  priority: number;
  stackable: boolean;
  is_active: boolean;
};

export const PROMOTION_TYPES: {
  value: PromotionType;
  label: string;
  help: string;
}[] = [
  {
    value: "percent_off",
    label: "Percent off",
    help: "e.g. 10% off the qualifying items",
  },
  {
    value: "amount_off",
    label: "Amount off",
    help: "e.g. 5.00 off, shared across the qualifying items",
  },
  {
    value: "fixed_price",
    label: "Fixed price",
    help: "each qualifying item for a set price, e.g. burgers 15.00",
  },
  {
    value: "buy_x_get_y",
    label: "Buy X get Y",
    help: "e.g. buy 2 get 1 free; the cheapest go free",
  },
];

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const CHANNELS = [
  { value: "counter", label: "Counter" },
  { value: "kiosk", label: "Kiosk" },
  { value: "online", label: "Online" },
  { value: "drive_thru", label: "Drive-thru" },
];
export const ORDER_TYPES = [
  { value: "dine_in", label: "Dine in" },
  { value: "takeaway", label: "Takeaway" },
  { value: "delivery", label: "Delivery" },
];

export function emptyPromotion(): PromotionFormValues {
  return {
    name: "",
    description: "",
    type: "percent_off",
    percent: "",
    amount: "",
    buyQuantity: "2",
    getQuantity: "1",
    itemIds: [],
    categoryIds: [],
    startDate: "",
    endDate: "",
    daysOfWeek: [],
    startTime: "",
    endTime: "",
    branchIds: [],
    channels: [],
    orderTypes: [],
    minSpend: "",
    couponCode: "",
    maxUses: "",
    maxUsesPerCustomer: "",
    priority: "0",
    stackable: false,
    isActive: true,
  };
}

export function promotionToForm(
  p: PromotionRow,
  currency: string,
): PromotionFormValues {
  return {
    name: p.name,
    description: p.description ?? "",
    type: p.type,
    percent:
      p.type === "percent_off"
        ? bpsToPercentInput(p.value)
        : p.type === "buy_x_get_y"
          ? bpsToPercentInput(p.get_discount_bps)
          : "",
    amount:
      p.type === "amount_off" || p.type === "fixed_price"
        ? toMoneyInput(p.value, currency)
        : "",
    buyQuantity: p.buy_quantity ? String(p.buy_quantity) : "2",
    getQuantity: p.get_quantity ? String(p.get_quantity) : "1",
    itemIds: p.item_ids,
    categoryIds: p.category_ids,
    startDate: p.start_date ?? "",
    endDate: p.end_date ?? "",
    daysOfWeek: p.days_of_week,
    startTime: p.start_time?.slice(0, 5) ?? "",
    endTime: p.end_time?.slice(0, 5) ?? "",
    branchIds: p.branch_ids,
    channels: p.channels,
    orderTypes: p.order_types,
    minSpend: p.min_spend ? toMoneyInput(p.min_spend, currency) : "",
    couponCode: p.coupon_code ?? "",
    maxUses: p.max_uses ? String(p.max_uses) : "",
    maxUsesPerCustomer: p.max_uses_per_customer
      ? String(p.max_uses_per_customer)
      : "",
    priority: String(p.priority),
    stackable: p.stackable,
    isActive: p.is_active,
  };
}

function wholeNumber(
  text: string,
  min: number,
  max: number,
): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= min && n <= max ? n : undefined;
}

/** A typed percentage as basis points, or null if it isn't one. */
function percentBps(text: string): number | null {
  try {
    return parsePercentToBps(text.trim());
  } catch (e) {
    if (e instanceof MoneyParseError) return null;
    throw e;
  }
}

function money(text: string, currency: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  try {
    const n = parseMoney(t, currency);
    return n >= 0 ? n : undefined;
  } catch (e) {
    if (e instanceof MoneyParseError) return undefined;
    throw e;
  }
}

/** Checks the form and builds the database row, or field errors. */
export function parsePromotion(
  v: PromotionFormValues,
  currency: string,
):
  | { ok: true; row: PromotionRow }
  | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = v.name.trim();
  if (!name) errors.name = "Enter a name.";
  else if (name.length > 80) errors.name = "Keep the name under 80 characters.";
  if (!PROMOTION_TYPES.some((t) => t.value === v.type))
    errors.type = "Choose a type.";

  let value = 0;
  let getDiscountBps = 10000;
  let buy: number | null = null;
  let get: number | null = null;
  if (v.type === "percent_off") {
    const bps = percentBps(v.percent);
    if (bps === null || bps < 1 || bps > 10000)
      errors.percent = "Enter a percentage from 0.01 to 100.";
    else value = bps;
  } else if (v.type === "amount_off" || v.type === "fixed_price") {
    const amount = money(v.amount, currency);
    if (
      amount === undefined ||
      amount === null ||
      (v.type === "amount_off" && amount < 1)
    )
      errors.amount = "Enter an amount, like 5 or 2.50.";
    else value = amount;
  } else if (v.type === "buy_x_get_y") {
    const b = wholeNumber(v.buyQuantity, 1, 99);
    const g = wholeNumber(v.getQuantity, 1, 99);
    if (!b) errors.buyQuantity = "Enter how many to buy, 1 to 99.";
    else buy = b;
    if (!g) errors.getQuantity = "Enter how many come off, 1 to 99.";
    else get = g;
    const bps = v.percent.trim() === "" ? 10000 : percentBps(v.percent);
    if (bps === null || bps < 1 || bps > 10000)
      errors.percent = "Enter 100 for free, or a percentage off.";
    else getDiscountBps = bps;
  }

  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (v.startDate && !date.test(v.startDate))
    errors.startDate = "Enter a date.";
  if (v.endDate && !date.test(v.endDate)) errors.endDate = "Enter a date.";
  if (v.startDate && v.endDate && v.endDate < v.startDate)
    errors.endDate = "The end can't be before the start.";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if ((v.startTime === "") !== (v.endTime === ""))
    errors.endTime = "Give both a start and an end time, or neither.";
  else if (v.startTime && (!time.test(v.startTime) || !time.test(v.endTime)))
    errors.endTime = "Enter times like 12:00.";
  else if (v.startTime && v.endTime <= v.startTime)
    errors.endTime = "The end time must be after the start (same day).";

  const minSpend = money(v.minSpend, currency);
  if (minSpend === undefined) errors.minSpend = "Enter an amount, like 50.";
  const code = v.couponCode.trim().toUpperCase();
  if (code && !/^[A-Z0-9-]{3,24}$/.test(code))
    errors.couponCode = "3 to 24 letters, numbers or dashes.";
  const maxUses = wholeNumber(v.maxUses, 1, 1000000);
  if (maxUses === undefined)
    errors.maxUses = "Enter a whole number, or leave it empty.";
  const perCustomer = wholeNumber(v.maxUsesPerCustomer, 1, 1000);
  if (perCustomer === undefined)
    errors.maxUsesPerCustomer = "Enter a whole number, or leave it empty.";
  const priority = v.priority.trim() === "" ? 0 : Number(v.priority);
  if (!Number.isInteger(priority) || priority < -1000 || priority > 1000)
    errors.priority = "Enter a whole number from -1000 to 1000.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    row: {
      name,
      description: v.description.trim() || null,
      type: v.type,
      value,
      buy_quantity: buy,
      get_quantity: get,
      get_discount_bps: getDiscountBps,
      item_ids: [...new Set(v.itemIds)],
      category_ids: [...new Set(v.categoryIds)],
      start_date: v.startDate || null,
      end_date: v.endDate || null,
      days_of_week: [...new Set(v.daysOfWeek)]
        .filter((d) => d >= 1 && d <= 7)
        .sort(),
      start_time: v.startTime || null,
      end_time: v.endTime || null,
      branch_ids: [...new Set(v.branchIds)],
      channels: v.channels.filter((c) => CHANNELS.some((x) => x.value === c)),
      order_types: v.orderTypes.filter((c) =>
        ORDER_TYPES.some((x) => x.value === c),
      ),
      min_spend: minSpend ?? 0,
      coupon_code: code || null,
      max_uses: maxUses ?? null,
      max_uses_per_customer: perCustomer ?? null,
      priority,
      stackable: v.stackable,
      is_active: v.isActive,
    },
  };
}

/** "Mon–Fri 12:00–14:00 · counter · from 16 Oct" for the list. */
export function describeWhen(
  p: Pick<
    PromotionRow,
    "days_of_week" | "start_time" | "end_time" | "start_date" | "end_date"
  >,
): string {
  const parts: string[] = [];
  if (p.days_of_week.length && p.days_of_week.length < 7)
    parts.push(p.days_of_week.map((d) => WEEKDAYS[d - 1]).join(", "));
  if (p.start_time && p.end_time)
    parts.push(`${p.start_time.slice(0, 5)}–${p.end_time.slice(0, 5)}`);
  if (p.start_date && p.end_date)
    parts.push(`${p.start_date} to ${p.end_date}`);
  else if (p.start_date) parts.push(`from ${p.start_date}`);
  else if (p.end_date) parts.push(`until ${p.end_date}`);
  return parts.join(" · ") || "Always";
}
