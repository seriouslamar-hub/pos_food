/**
 * The till's cart: what the cashier has rung up but not yet sent. Pure data
 * and functions; ids are UUIDs made on the device (plan rule 6).
 */

export type CartComboChoice = {
  slotId: string;
  menuItemId: string;
  modifierIds: string[];
};

export type CartLine = {
  id: string;
  menuItemId: string;
  quantity: number;
  modifierIds: string[];
  combo: CartComboChoice[];
  notes: string;
};

export type OrderType = "takeaway" | "dine_in" | "delivery";

export type Cart = {
  id: string;
  orderType: OrderType;
  customerPhone: string;
  deliveryAddress: string;
  notes: string;
  lines: CartLine[];
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

/** Same item with the same choices and notes: such lines are merged. */
export function linesMatch(
  a: Omit<CartLine, "id" | "quantity">,
  b: Omit<CartLine, "id" | "quantity">,
): boolean {
  if (a.menuItemId !== b.menuItemId || a.notes.trim() !== b.notes.trim())
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

export type SubmitOrderPayload = {
  id: string;
  order_type: OrderType;
  channel: "counter";
  customer_phone: string | null;
  delivery_address: string | null;
  notes: string | null;
  client_created_at: string;
  lines: {
    id: string;
    menu_item_id: string;
    quantity: number;
    modifier_ids: string[];
    notes: string | null;
    combo: {
      id: string;
      slot_id: string;
      menu_item_id: string;
      modifier_ids: string[];
    }[];
  }[];
};

/**
 * What the till sends to submit_order. No prices: the server works them out.
 * Combo parts get their own ids here so a resend is identical.
 */
export function toSubmitPayload(
  cart: Cart,
  newId: () => string,
  clientCreatedAt: string,
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
    lines: cart.lines.map((line) => ({
      id: line.id,
      menu_item_id: line.menuItemId,
      quantity: line.quantity,
      modifier_ids: line.modifierIds,
      notes: text(line.notes),
      combo: line.combo.map((choice) => ({
        id: newId(),
        slot_id: choice.slotId,
        menu_item_id: choice.menuItemId,
        modifier_ids: choice.modifierIds,
      })),
    })),
  };
}
