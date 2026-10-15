/** A saved order as returned by submit_order / get_order (order_summary). */

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
  components: {
    id: string;
    name: string;
    short_name: string;
    slot: string | null;
    modifiers: { name: string }[];
    kds_station_id: string | null;
  }[];
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
  tax_total: number;
  total: number;
  paid_at: string | null;
  sent_to_kitchen_at: string | null;
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
};

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
    payments: order.payments ?? [],
    amount_paid: order.amount_paid ?? 0,
    change_given: order.change_given ?? 0,
  };
}

/** Paid in full. Pay-later dine-in orders reach the kitchen before this. */
export function isPaid(order: Pick<OrderSummary, "paid_at">): boolean {
  return order.paid_at !== null;
}

export const ORDER_TYPE_LABELS = {
  takeaway: "Takeaway",
  dine_in: "Dine-in",
  delivery: "Delivery",
} as const;
