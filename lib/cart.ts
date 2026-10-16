/**
 * The till's cart: what the cashier has rung up but not yet sent. Pure data
 * and functions; ids are UUIDs made on the device (plan rule 6).
 */
import type { MenuPromotion } from "./promotions";

export type CartComboChoice = {
  slotId: string;
  menuItemId: string;
  modifierIds: string[];
};

/**
 * A discount as the cashier gives it: a percentage in basis points (1000 =
 * 10%) or a fixed amount in minor units, always with a reason.
 */
export type Discount = {
  type: "percent" | "fixed";
  value: number;
  reason: string;
};

/** A price the cashier charges instead of the menu price, for one unit. */
export type PriceChange = { unitPrice: number; reason: string };

export type CartLine = {
  id: string;
  menuItemId: string;
  quantity: number;
  modifierIds: string[];
  combo: CartComboChoice[];
  notes: string;
  discount?: Discount | null;
  price?: PriceChange | null;
};

export type OrderType = "takeaway" | "dine_in" | "delivery";

/** The loyalty customer on an order (from find_customer / save_customer). */
export type CartCustomer = {
  id: string;
  name: string | null;
  phone: string;
  pointsBalance: number;
};

export type Cart = {
  id: string;
  orderType: OrderType;
  customerPhone: string;
  deliveryAddress: string;
  notes: string;
  lines: CartLine[];
  /** A discount on the whole order, shared across the lines. */
  discount?: Discount | null;
  customer?: CartCustomer | null;
  /** A coupon the customer gave, as check_coupon found it. */
  coupon?: { code: string; promotion: MenuPromotion } | null;
  /** Loyalty points to spend on this order. */
  redeemPoints?: number;
};

export const MAX_QUANTITY = 999;

export function emptyCart(id: string, orderType: OrderType = "takeaway"): Cart {
  return {
    id,
    orderType,
    customerPhone: "",
    deliveryAddress: "",
    notes: "",
    lines: [],
  };
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function sameDiscount(
  a: Discount | null | undefined,
  b: Discount | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return a.type === b.type && a.value === b.value && a.reason === b.reason;
}

/**
 * Same item with the same choices, notes, discount and price: such lines
 * are merged.
 */
export function linesMatch(
  a: Omit<CartLine, "id" | "quantity">,
  b: Omit<CartLine, "id" | "quantity">,
): boolean {
  if (a.menuItemId !== b.menuItemId || a.notes.trim() !== b.notes.trim())
    return false;
  if (!sameDiscount(a.discount, b.discount)) return false;
  if (
    (a.price?.unitPrice ?? null) !== (b.price?.unitPrice ?? null) ||
    (a.price?.reason ?? null) !== (b.price?.reason ?? null)
  )
    return false;
  if (
    !sameIds(a.modifierIds, b.modifierIds) ||
    a.combo.length !== b.combo.length
  )
    return false;
  return a.combo.every((choice) =>
    b.combo.some(
      (other) =>
        other.slotId === choice.slotId &&
        other.menuItemId === choice.menuItemId &&
        sameIds(other.modifierIds, choice.modifierIds),
    ),
  );
}

/** Adds a line, or adds its quantity to an identical line already in the cart. */
export function addLine(cart: Cart, line: CartLine): Cart {
  const match = cart.lines.find((existing) => linesMatch(existing, line));
  if (match) {
    return {
      ...cart,
      lines: cart.lines.map((l) =>
        l.id === match.id
          ? {
              ...l,
              quantity: Math.min(MAX_QUANTITY, l.quantity + line.quantity),
            }
          : l,
      ),
    };
  }
  return { ...cart, lines: [...cart.lines, line] };
}

export function replaceLine(cart: Cart, line: CartLine): Cart {
  return {
    ...cart,
    lines: cart.lines.map((l) => (l.id === line.id ? line : l)),
  };
}

export function removeLine(cart: Cart, lineId: string): Cart {
  return { ...cart, lines: cart.lines.filter((l) => l.id !== lineId) };
}

/** +1 / -1 on a line; a line that reaches zero is removed. */
export function changeQuantity(
  cart: Cart,
  lineId: string,
  delta: number,
): Cart {
  return {
    ...cart,
    lines: cart.lines
      .map((l) =>
        l.id === lineId
          ? { ...l, quantity: Math.min(MAX_QUANTITY, l.quantity + delta) }
          : l,
      )
      .filter((l) => l.quantity > 0),
  };
}

type SubmitDiscount = { type: Discount["type"]; value: number; reason: string };

export type SubmitOrderPayload = {
  id: string;
  order_type: OrderType;
  channel: "counter";
  customer_phone: string | null;
  delivery_address: string | null;
  notes: string | null;
  client_created_at: string;
  discount: SubmitDiscount | null;
  /** A manager's approval for discounts above the cashier's limit. */
  discount_override_id: string | null;
  /** A manager's approval for the price changes. */
  price_override_id: string | null;
  customer_id: string | null;
  coupon_code: string | null;
  redeem_points: number;
  lines: {
    id: string;
    menu_item_id: string;
    quantity: number;
    modifier_ids: string[];
    notes: string | null;
    discount: SubmitDiscount | null;
    price: { unit_price: number; reason: string } | null;
    combo: {
      id: string;
      slot_id: string;
      menu_item_id: string;
      modifier_ids: string[];
    }[];
  }[];
};

function submitDiscount(discount: Discount | null | undefined) {
  return discount
    ? {
        type: discount.type,
        value: discount.value,
        reason: discount.reason.trim(),
      }
    : null;
}

/**
 * What the till sends to submit_order. No prices: the server works them out.
 * Combo parts get their own ids here so a resend is identical.
 */
export function toSubmitPayload(
  cart: Cart,
  newId: () => string,
  clientCreatedAt: string,
  approvals: { discountOverrideId?: string; priceOverrideId?: string } = {},
): SubmitOrderPayload {
  const text = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    id: cart.id,
    order_type: cart.orderType,
    channel: "counter",
    customer_phone:
      cart.orderType === "delivery" ? text(cart.customerPhone) : null,
    delivery_address:
      cart.orderType === "delivery" ? text(cart.deliveryAddress) : null,
    notes: text(cart.notes),
    client_created_at: clientCreatedAt,
    discount: submitDiscount(cart.discount),
    discount_override_id: approvals.discountOverrideId ?? null,
    price_override_id: approvals.priceOverrideId ?? null,
    customer_id: cart.customer?.id ?? null,
    coupon_code: cart.coupon?.code ?? null,
    redeem_points: cart.customer ? (cart.redeemPoints ?? 0) : 0,
    lines: cart.lines.map((line) => ({
      id: line.id,
      menu_item_id: line.menuItemId,
      quantity: line.quantity,
      modifier_ids: line.modifierIds,
      notes: text(line.notes),
      discount: submitDiscount(line.discount),
      price: line.price
        ? { unit_price: line.price.unitPrice, reason: line.price.reason.trim() }
        : null,
      combo: line.combo.map((choice) => ({
        id: newId(),
        slot_id: choice.slotId,
        menu_item_id: choice.menuItemId,
        modifier_ids: choice.modifierIds,
      })),
    })),
  };
}

/** Whether the cart has any discount or changed price. */
export function hasAdjustments(cart: Cart): boolean {
  return Boolean(
    cart.discount || cart.lines.some((l) => l.discount || l.price),
  );
}
