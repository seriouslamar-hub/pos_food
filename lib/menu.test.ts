import { describe, expect, it } from "vitest";
import {
  applyAvailability,
  availableOptions,
  canSell,
  indexMenu,
  parseMenu,
  type MenuDoc,
  type MenuItem,
} from "./menu";

function item(overrides: Partial<MenuItem> & { id: string }): MenuItem {
  return {
    category_id: "c1",
    type: "item",
    name: overrides.id,
    short_name: overrides.id,
    description: null,
    image_url: null,
    price: 1000,
    base_price: 1000,
    tax_category: "standard",
    kds_station_id: null,
    is_available: true,
    modifier_groups: [],
    combo_slots: [],
    ...overrides,
  };
}

const fries = item({
  id: "fries",
  modifier_groups: [
    {
      id: "size",
      name: "Size",
      min_select: 1,
      max_select: 1,
      modifiers: [
        {
          id: "regular",
          name: "Regular",
          price_delta: 0,
          kds_station_id: null,
          is_available: true,
        },
        {
          id: "large",
          name: "Large",
          price_delta: 500,
          kds_station_id: null,
          is_available: true,
        },
      ],
    },
  ],
});
const coleslaw = item({ id: "coleslaw" });
const coke = item({ id: "coke" });
const meal = item({
  id: "meal",
  type: "combo",
  combo_slots: [
    {
      id: "side",
      name: "Side",
      required: true,
      options: [
        { menu_item_id: "fries", upcharge: 0, is_default: true },
        { menu_item_id: "coleslaw", upcharge: 0, is_default: false },
      ],
    },
    {
      id: "drink",
      name: "Drink",
      required: true,
      options: [{ menu_item_id: "coke", upcharge: 0, is_default: true }],
    },
  ],
});

const menu: MenuDoc = {
  branch_id: "b1",
  branch_name: "Main",
  currency_code: "GHS",
  timezone: "Africa/Accra",
  generated_at: "2026-10-15T00:00:00Z",
  categories: [{ id: "c1", name: "All", colour: null }],
  items: [fries, coleslaw, coke, meal],
  taxes: [],
  stations: [],
  payment_methods: [],
};

describe("menu helpers", () => {
  it("parses a menu document and rejects garbage", () => {
    expect(parseMenu(menu).items).toHaveLength(4);
    expect(() => parseMenu(null)).toThrow();
    expect(() => parseMenu({ items: [] })).toThrow();
  });

  it("can sell available items and combos", () => {
    const index = indexMenu(menu);
    expect(canSell(fries, index)).toBe(true);
    expect(canSell(meal, index)).toBe(true);
  });

  it("can't sell a combo when a required slot has nothing available", () => {
    const noCoke = applyAvailability(menu, {
      kind: "item",
      id: "coke",
      isAvailable: false,
    });
    const index = indexMenu(noCoke);
    expect(canSell(index.items.get("meal")!, index)).toBe(false);
  });

  it("drops unavailable combo options but keeps the combo when another option is left", () => {
    const noFries = applyAvailability(menu, {
      kind: "item",
      id: "fries",
      isAvailable: false,
    });
    const index = indexMenu(noFries);
    const meal2 = index.items.get("meal")!;
    expect(
      availableOptions(meal2.combo_slots[0], index).map((o) => o.menu_item_id),
    ).toEqual(["coleslaw"]);
    expect(canSell(meal2, index)).toBe(true);
  });

  it("can't sell an item whose required modifier group has nothing available", () => {
    let next = applyAvailability(menu, {
      kind: "modifier",
      id: "regular",
      isAvailable: false,
    });
    expect(canSell(indexMenu(next).items.get("fries")!, indexMenu(next))).toBe(
      true,
    );
    next = applyAvailability(next, {
      kind: "modifier",
      id: "large",
      isAvailable: false,
    });
    expect(canSell(indexMenu(next).items.get("fries")!, indexMenu(next))).toBe(
      false,
    );
  });

  it("applies availability changes without mutating the original", () => {
    const next = applyAvailability(menu, {
      kind: "item",
      id: "coke",
      isAvailable: false,
    });
    expect(menu.items.find((i) => i.id === "coke")!.is_available).toBe(true);
    expect(next.items.find((i) => i.id === "coke")!.is_available).toBe(false);
  });
});
