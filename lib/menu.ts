/**
 * The menu document returned by get_menu(), and helpers to read it. Pure;
 * used by the till, the admin preview and (later) offline caching.
 */

export type MenuModifier = {
  id: string;
  name: string;
  price_delta: number;
  kds_station_id: string | null;
  is_available: boolean;
};

export type MenuModifierGroup = {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  modifiers: MenuModifier[];
};

export type MenuComboOption = {
  menu_item_id: string;
  upcharge: number;
  is_default: boolean;
};

export type MenuComboSlot = {
  id: string;
  name: string;
  required: boolean;
  options: MenuComboOption[];
};

export type MenuItem = {
  id: string;
  category_id: string;
  type: "item" | "combo";
  name: string;
  short_name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  base_price: number;
  tax_category: string;
  kds_station_id: string | null;
  is_available: boolean;
  modifier_groups: MenuModifierGroup[];
  combo_slots: MenuComboSlot[];
};

export type MenuCategory = { id: string; name: string; colour: string | null };
export type MenuTax = {
  id: string;
  name: string;
  rate_bps: number;
  is_inclusive: boolean;
  tax_category: string;
};

export type MenuDoc = {
  branch_id: string;
  branch_name: string;
  currency_code: string;
  timezone: string;
  generated_at: string;
  categories: MenuCategory[];
  items: MenuItem[];
  taxes: MenuTax[];
  stations: { id: string; name: string }[];
};

/** Light structural check of what get_menu returned. */
export function parseMenu(json: unknown): MenuDoc {
  const doc = json as Partial<MenuDoc> | null;
  if (
    !doc ||
    !Array.isArray(doc.items) ||
    !Array.isArray(doc.categories) ||
    !doc.currency_code
  ) {
    throw new Error("The menu couldn't be read");
  }
  return {
    ...(doc as MenuDoc),
    taxes: doc.taxes ?? [],
    stations: doc.stations ?? [],
  };
}

export type MenuIndex = {
  items: Map<string, MenuItem>;
  modifiers: Map<string, MenuModifier>;
};

export function indexMenu(menu: MenuDoc): MenuIndex {
  const items = new Map(menu.items.map((i) => [i.id, i]));
  const modifiers = new Map<string, MenuModifier>();
  for (const item of menu.items) {
    for (const group of item.modifier_groups) {
      for (const modifier of group.modifiers)
        modifiers.set(modifier.id, modifier);
    }
  }
  return { items, modifiers };
}

/** Options of a combo slot that can be chosen right now. */
export function availableOptions(
  slot: MenuComboSlot,
  index: MenuIndex,
): MenuComboOption[] {
  return slot.options.filter(
    (o) => index.items.get(o.menu_item_id)?.is_available,
  );
}

/**
 * Whether an item can be sold now. A combo also needs an available choice in
 * every required slot, and every item needs enough available modifiers to
 * meet each group's minimum.
 */
export function canSell(item: MenuItem, index: MenuIndex): boolean {
  if (!item.is_available) return false;
  for (const group of item.modifier_groups) {
    if (group.modifiers.filter((m) => m.is_available).length < group.min_select)
      return false;
  }
  if (item.type === "combo") {
    for (const slot of item.combo_slots) {
      if (slot.required && availableOptions(slot, index).length === 0)
        return false;
    }
  }
  return true;
}

/** Items to show for a category, in menu order. */
export function itemsInCategory(menu: MenuDoc, categoryId: string): MenuItem[] {
  return menu.items.filter((i) => i.category_id === categoryId);
}

export type AvailabilityChange =
  | { kind: "item"; id: string; isAvailable: boolean }
  | { kind: "modifier"; id: string; isAvailable: boolean };

/** Applies a live availability change to a menu (returns a new document). */
export function applyAvailability(
  menu: MenuDoc,
  change: AvailabilityChange,
): MenuDoc {
  if (change.kind === "item") {
    return {
      ...menu,
      items: menu.items.map((i) =>
        i.id === change.id ? { ...i, is_available: change.isAvailable } : i,
      ),
    };
  }
  return {
    ...menu,
    items: menu.items.map((i) => ({
      ...i,
      modifier_groups: i.modifier_groups.map((g) => ({
        ...g,
        modifiers: g.modifiers.map((m) =>
          m.id === change.id ? { ...m, is_available: change.isAvailable } : m,
        ),
      })),
    })),
  };
}
