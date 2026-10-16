/** A saved order as returned by submit_order / get_order (order_summary). */
import { formatBps } from "./percent";

export type OrderLineSummary = {
  id: string;
  menu_item_id: string;
  name: string;
  short_name: string;
  quantity: number;
  unit_price: number;
  modifiers: { id: string; name: string; group: string; price_delta: number }[];
  notes: string | null;
  line_subtotal: number;
  line_discount: number;
  line_tax: number;
  line_total: number;
  status: "pending" | "sent" | "ready" | "voided";
  kds_station_id: string | null;
  /** The line's own discount as given (line_discount adds the order share). */
  discount: OrderDiscount | null;
  order_discount_share: number;
  /** What promotions and loyalty points took off the line (in line_discount). */
  promo_discount?: number;
  loyalty_discount?: number;
  /** Set when the cashier changed the price: the menu price it replaced. */
  price_override_from: number | null;
  price_override_reason: string | null;
  voided_at: string | null;
  void_reason: string | null;
  refunded_at: string | null;
  components: {
    id: string;
    name: string;
    short_name: string;
    slot: string | null;
    modifiers: { name: string }[];
    kds_station_id: string | null;
    status: "pending" | "sent" | "ready" | "voided";
  }[];
};

export type OrderDiscount = {
  type: "percent" | "fixed";
  value: number;
  reason: string;
};

export type OrderRefund = {
  id: string;
  amount: number;
  method: "cash" | "card" | "mobile_money" | "other";
  method_name: string;
  reference: string | null;
  reason: string;
  line_ids: string[];
  created_at: string;
  staff_name: string | null;
  approved_by_name: string | null;
};

export type OrderPayment = {
  id: string;
  method: "cash" | "card" | "mobile_money" | "other";
  method_name: string;
  amount: number;
  tendered: number | null;
  change_given: number | null;
  reference: string | null;
  status: "captured" | "refunded";
};

/** Branch details printed on receipts. */
export type ReceiptBranch = {
  name: string;
  address: string | null;
  phone: string | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  logo_url: string | null;
  timezone: string;
  currency_code: string;
};

export type OrderSummary = {
  id: string;
  branch_id: string;
  order_number: string;
  status:
    | "open"
    | "paid"
    | "in_kitchen"
    | "ready"
    | "collected"
    | "voided"
    | "refunded"
    | "partially_refunded";
  order_type: "dine_in" | "takeaway" | "delivery";
  channel: "counter" | "kiosk" | "online" | "drive_thru";
  business_date: string;
  created_at: string;
  customer_phone: string | null;
  delivery_address: string | null;
  notes: string | null;
  subtotal: number;
  discount_total: number;
  /** The order-level discount as given, if any. */
  discount: OrderDiscount | null;
  tax_total: number;
  total: number;
  paid_at: string | null;
  sent_to_kitchen_at: string | null;
  staff_id: string | null;
  staff_name: string | null;
  device_code: string | null;
  branch: ReceiptBranch;
  lines: OrderLineSummary[];
  taxes: {
    name: string;
    rate_bps: number;
    inclusive: boolean;
    amount: number;
  }[];
  payments: OrderPayment[];
  amount_paid: number;
  change_given: number;
  refunds: OrderRefund[];
  refunded_total: number;
  /** Sold in training mode: not a real sale. */
  training?: boolean;
  promotion_total?: number;
  coupon_code?: string | null;
  promotions?: { id: string; name: string; amount: number }[];
  customer?: {
    id: string;
    name: string | null;
    phone: string;
    points_balance: number;
  } | null;
  loyalty?: {
    points_redeemed: number;
    discount: number;
    points_earned: number;
  };
};

/** What staff took off a line itself (not the order discount, promotions or points). */
export function staffLineDiscount(line: OrderLineSummary): number {
  return (
    line.line_discount -
    line.order_discount_share -
    (line.promo_discount ?? 0) -
    (line.loyalty_discount ?? 0)
  );
}

export function parseOrderSummary(json: unknown): OrderSummary {
  const order = json as Partial<OrderSummary> | null;
  if (
    !order?.id ||
    !order.order_number ||
    typeof order.total !== "number" ||
    !Array.isArray(order.lines)
  ) {
    throw new Error("The saved order couldn't be read");
  }
  return {
    ...(order as OrderSummary),
    taxes: order.taxes ?? [],
    discount: order.discount ?? null,
    payments: order.payments ?? [],
    amount_paid: order.amount_paid ?? 0,
    change_given: order.change_given ?? 0,
    refunds: order.refunds ?? [],
    refunded_total: order.refunded_total ?? 0,
    promotions: order.promotions ?? [],
    customer: order.customer ?? null,
  };
}

/** What a discount is, for people: "10%" or "$1.50". */
export function describeDiscount(
  discount: OrderDiscount,
  format: (amount: number) => string,
): string {
  return discount.type === "percent"
    ? formatBps(discount.value)
    : format(discount.value);
}

export const ORDER_STATUS_LABELS: Record<OrderSummary["status"], string> = {
  open: "Not paid",
  paid: "Paid",
  in_kitchen: "In the kitchen",
  ready: "Ready",
  collected: "Collected",
  voided: "Voided",
  refunded: "Refunded",
  partially_refunded: "Partly refunded",
};

/** Paid in full. Pay-later dine-in orders reach the kitchen before this. */
export function isPaid(order: Pick<OrderSummary, "paid_at">): boolean {
  return order.paid_at !== null;
}

export const ORDER_TYPE_LABELS = {
  takeaway: "Takeaway",
  dine_in: "Dine-in",
  delivery: "Delivery",
} as const;
