import type { CartLine } from "./cart";
import { defaultComboChoices } from "./choices";
import type { MenuDoc, MenuIndex, MenuItem } from "./menu";
import { canSell } from "./menu";
import { unitPrice } from "./pricing";

export type MealOffer = {
  combo: MenuItem;
  /** The meal line to put in the cart instead (the item in its slot). */
  line: Omit<CartLine, "id" | "quantity" | "notes">;
  /** What the meal costs on top of the item (per unit). */
  extra: number;
};

/**
 * "Make it a meal?": a meal whose first slot offers this item, with the
 * meal's usual choices otherwise. The cheapest such meal, if it costs more
 * than the item alone and can be sold now. Null when there's none.
 */
export function mealOffer(
  line: Pick<CartLine, "menuItemId" | "modifierIds">,
  menu: MenuDoc,
  index: MenuIndex,
): MealOffer | null {
  const item = index.items.get(line.menuItemId);
  if (!item || item.type !== "item") return null;
  const alone = unitPrice({ ...line, combo: [] }, index) ?? 0;
  let best: MealOffer | null = null;
  for (const combo of menu.items) {
    if (combo.type !== "combo" || !canSell(combo, index)) continue;
    const slot = combo.combo_slots[0];
    if (!slot?.options.some((o) => o.menu_item_id === item.id)) continue;
    const choices = defaultComboChoices(combo, index).map((c) =>
      c.slotId === slot.id
        ? {
            slotId: slot.id,
            menuItemId: item.id,
            modifierIds: line.modifierIds,
          }
        : c,
    );
    if (!choices.some((c) => c.slotId === slot.id))
      choices.unshift({
        slotId: slot.id,
        menuItemId: item.id,
        modifierIds: line.modifierIds,
      });
    const meal = { menuItemId: combo.id, modifierIds: [], combo: choices };
    const extra = (unitPrice(meal, index) ?? 0) - alone;
    if (extra <= 0) continue;
    if (!best || extra < best.extra) best = { combo, line: meal, extra };
  }
  return best;
}

/** Pickup times to offer: every 15 minutes from when the kitchen can be ready. */
export function pickupSlots(
  now: Date,
  prepMinutes: number,
  count = 12,
): Date[] {
  const earliest = now.getTime() + prepMinutes * 60_000;
  const step = 15 * 60_000;
  const first = Math.ceil(earliest / step) * step;
  return Array.from({ length: count }, (_, i) => new Date(first + i * step));
}
