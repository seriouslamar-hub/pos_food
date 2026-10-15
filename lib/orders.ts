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
  components: {
    id: string;
    name: string;
    slot: string | null;
    modifiers: { name: string }[];
  }[];
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
  lines: OrderLineSummary[];
  taxes: {
    name: string;
    rate_bps: number;
    inclusive: boolean;
    amount: number;
  }[];
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
  return { ...(order as OrderSummary), taxes: order.taxes ?? [] };
}

export const ORDER_TYPE_LABELS = {
  takeaway: "Takeaway",
  dine_in: "Dine-in",
  delivery: "Delivery",
} as const;
