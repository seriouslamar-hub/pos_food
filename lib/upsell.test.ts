import { describe, expect, it } from "vitest";
import { indexMenu, type MenuDoc, type MenuItem } from "./menu";
import { mealOffer, pickupSlots } from "./upsell";

function item(p: Partial<MenuItem> & { id: string }): MenuItem {
  return {
    category_id: "c",
    type: "item",
    name: p.id,
    short_name: p.id,
    description: null,
    image_url: null,
    price: 0,
    base_price: 0,
    tax_category: "standard",
    kds_station_id: null,
    is_available: true,
    modifier_groups: [],
    combo_slots: [],
    ...p,
  };
}

const burger = item({ id: "burger", price: 3000 });
const fries = item({ id: "fries", price: 1000 });
const cola = item({ id: "cola", price: 800 });
const meal = item({
  id: "meal",
  type: "combo",
  price: 4000,
  combo_slots: [
    {
      id: "s1",
      name: "Main",
      required: true,
      options: [{ menu_item_id: "burger", upcharge: 0, is_default: true }],
    },
    {
      id: "s2",
      name: "Side",
      required: true,
      options: [{ menu_item_id: "fries", upcharge: 0, is_default: true }],
    },
    {
      id: "s3",
      name: "Drink",
      required: true,
      options: [{ menu_item_id: "cola", upcharge: 0, is_default: true }],
    },
  ],
});
const menu = {
  branch_id: "b",
  branch_name: "B",
  currency_code: "USD",
  timezone: "UTC",
  generated_at: "",
  categories: [{ id: "c", name: "C", colour: null }],
  items: [burger, fries, cola, meal],
  taxes: [],
  stations: [],
  payment_methods: [],
} satisfies MenuDoc;
const index = indexMenu(menu);

describe("mealOffer", () => {
  it("offers the meal a burger is the main of, for the difference", () => {
    const offer = mealOffer(
      { menuItemId: "burger", modifierIds: [] },
      menu,
      index,
    );
    expect(offer?.combo.id).toBe("meal");
    expect(offer?.extra).toBe(1000);
    expect(offer?.line.combo.map((c) => c.menuItemId)).toEqual([
      "burger",
      "fries",
      "cola",
    ]);
  });

  it("offers nothing for an item that isn't a meal's main", () => {
    expect(
      mealOffer({ menuItemId: "fries", modifierIds: [] }, menu, index),
    ).toBeNull();
  });

  it("offers nothing when the meal can't be sold", () => {
    const soldOut = {
      ...menu,
      items: [burger, { ...fries, is_available: false }, cola, meal],
    };
    expect(
      mealOffer(
        { menuItemId: "burger", modifierIds: [] },
        soldOut,
        indexMenu(soldOut),
      ),
    ).toBeNull();
  });
});

describe("pickupSlots", () => {
  it("starts at the next quarter hour after the kitchen's time", () => {
    const slots = pickupSlots(new Date("2026-10-16T12:03:00Z"), 20, 3);
    expect(slots.map((d) => d.toISOString())).toEqual([
      "2026-10-16T12:30:00.000Z",
      "2026-10-16T12:45:00.000Z",
      "2026-10-16T13:00:00.000Z",
    ]);
  });
});
