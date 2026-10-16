/**
 * An order as the till sold it offline, in the same shape the server
 * returns (OrderSummary), so receipts and kitchen tickets print the same
 * way. The server works it out again when the order is sent.
 */
import type { Cart } from "../cart";
import type { MenuDoc, MenuIndex } from "../menu";
import type { OrderSummary, ReceiptBranch } from "../orders";
import type { PendingPayment } from "../payments/tender";
import { unitPrice, type CartTotals } from "../pricing";

export function localOrderSummary({
  cart,
  menu,
  index,
  totals,
  payments,
  orderNumber,
  businessDate,
  staff,
  deviceCode,
  branch,
  now,
}: {
  cart: Cart;
  menu: MenuDoc;
  index: MenuIndex;
  totals: CartTotals;
  payments: PendingPayment[];
  orderNumber: string;
  businessDate: string;
  staff: { id: string; fullName: string };
  deviceCode: string;
  /** Receipt details from the last server receipt, if there was one. */
  branch: ReceiptBranch | null;
  now: string;
}): OrderSummary {
  const groupOf = (modifierId: string) => {
    for (const item of menu.items)
      for (const g of item.modifier_groups)
        if (g.modifiers.some((m) => m.id === modifierId)) return g.name;
    return "";
  };
  const lines = cart.lines.map((line) => {
    const item = index.items.get(line.menuItemId);
    const price = totals.lines.get(line.id);
    return {
      id: line.id,
      menu_item_id: line.menuItemId,
      name: item?.name ?? "Item",
      short_name: item?.short_name ?? item?.name ?? "Item",
      quantity: line.quantity,
      unit_price: price?.unitPrice ?? 0,
      modifiers: line.modifierIds.map((id) => ({
        id,
        name: index.modifiers.get(id)?.name ?? "",
        group: groupOf(id),
        price_delta: index.modifiers.get(id)?.price_delta ?? 0,
      })),
      notes: line.notes.trim() || null,
      line_subtotal: price?.gross ?? 0,
      line_discount: price?.discount ?? 0,
      line_tax: price?.tax ?? 0,
      line_total: price?.total ?? 0,
      status: "sent" as const,
      kds_station_id: item?.kds_station_id ?? null,
      discount: line.discount ?? null,
      order_discount_share: price?.orderDiscountShare ?? 0,
      price_override_from: line.price ? (unitPrice(line, index) ?? 0) : null,
      price_override_reason: line.price?.reason ?? null,
      voided_at: null,
      void_reason: null,
      refunded_at: null,
      components: line.combo.map((choice, i) => {
        const part = index.items.get(choice.menuItemId);
        const slot = item?.combo_slots.find((s) => s.id === choice.slotId);
        return {
          id: `${line.id}-${i}`,
          name: part?.name ?? "",
          short_name: part?.short_name ?? part?.name ?? "",
          slot: slot?.name ?? null,
          modifiers: choice.modifierIds.map((id) => ({
            name: index.modifiers.get(id)?.name ?? "",
          })),
          kds_station_id: part?.kds_station_id ?? null,
          status: "sent" as const,
        };
      }),
    };
  });
  const orderPayments = payments.map((p) => ({
    id: p.id,
    method: p.method.type,
    method_name: p.method.name,
    amount: p.amount,
    tendered: p.tendered,
    change_given: p.tendered === null ? null : p.tendered - p.amount,
    reference: p.reference,
    status: "captured" as const,
  }));
  return {
    id: cart.id,
    branch_id: menu.branch_id,
    order_number: orderNumber,
    status: "paid",
    order_type: cart.orderType,
    channel: "counter",
    business_date: businessDate,
    created_at: now,
    customer_phone: cart.customerPhone.trim() || null,
    delivery_address: cart.deliveryAddress.trim() || null,
    notes: cart.notes.trim() || null,
    subtotal: totals.subtotal,
    discount_total: totals.discountTotal,
    discount: cart.discount ?? null,
    tax_total: totals.taxTotal,
    total: totals.total,
    paid_at: now,
    sent_to_kitchen_at: now,
    staff_id: staff.id,
    staff_name: staff.fullName,
    device_code: deviceCode,
    branch: branch ?? {
      name: menu.branch_name,
      address: null,
      phone: null,
      receipt_header: null,
      receipt_footer: null,
      logo_url: null,
      timezone: menu.timezone,
      currency_code: menu.currency_code,
    },
    lines,
    taxes: totals.taxes.map((t) => ({
      name: t.name,
      rate_bps: t.rateBps,
      inclusive: t.inclusive,
      amount: t.amount,
    })),
    payments: orderPayments,
    amount_paid: orderPayments.reduce((s, p) => s + p.amount, 0),
    change_given: orderPayments.reduce((s, p) => s + (p.change_given ?? 0), 0),
    refunds: [],
    refunded_total: 0,
  };
}
