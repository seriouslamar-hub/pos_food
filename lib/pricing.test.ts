import { describe, expect, it } from "vitest";
import {
  addLine,
  changeQuantity,
  emptyCart,
  linesMatch,
  toSubmitPayload,
  type CartLine,
} from "./cart";
import {
  comboProblems,
  defaultComboChoices,
  defaultModifiers,
  modifierProblems,
  toggleModifier,
} from "./choices";
import { indexMenu, type MenuDoc, type MenuItem, type MenuTax } from "./menu";
import { lineTaxes, priceCart, roundDiv, unitPrice } from "./pricing";

function tax(
  id: string,
  rate: number,
  inclusive: boolean,
  category: string,
): MenuTax {
  return {
    id,
    name: id,
    rate_bps: rate,
    is_inclusive: inclusive,
    tax_category: category,
  };
}

describe("roundDiv", () => {
  it("rounds half away from zero", () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(4, 2)).toBe(2);
    expect(roundDiv(7, 3)).toBe(2);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(0, 7)).toBe(0);
  });
});

// The same examples are checked against the database in supabase/tests/009_orders.test.sql.
describe("lineTaxes (shared examples with submit_order)", () => {
  const taxes = [
    tax("Ex 15", 1500, false, "ex"),
    tax("Inc 15", 1500, true, "inc"),
    tax("Inc VAT", 1250, true, "mix"),
    tax("Inc levy", 250, true, "mix"),
    tax("Ex 1", 100, false, "mix"),
  ];

  it("adds an exclusive tax", () => {
    expect(lineTaxes(2400, "ex", taxes)).toMatchObject({
      tax: 360,
      total: 2760,
    });
    expect(lineTaxes(2050, "ex", taxes)).toMatchObject({
      tax: 308,
      total: 2358,
    });
  });

  it("extracts an inclusive tax", () => {
    expect(lineTaxes(2000, "inc", taxes)).toMatchObject({
      tax: 261,
      total: 2000,
    });
  });

  it("handles two inclusive taxes and an exclusive one", () => {
    const result = lineTaxes(4500, "mix", taxes);
    expect(result.taxes.map((t) => [t.name, t.amount])).toEqual([
      ["Inc VAT", 489],
      ["Inc levy", 98],
      ["Ex 1", 39],
    ]);
    expect(result).toMatchObject({ tax: 626, total: 4539 });
  });

  it("charges nothing for a category without taxes", () => {
    expect(lineTaxes(300, "none", taxes)).toEqual({
      taxes: [],
      tax: 0,
      total: 300,
    });
  });
});

// A small menu: chips with a size, a burger with extras, and a meal.
const size = {
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
      price_delta: 250,
      kds_station_id: null,
      is_available: true,
    },
  ],
};
const extras = {
  id: "extras",
  name: "Extras",
  min_select: 0,
  max_select: 2,
  modifiers: [
    {
      id: "cheese",
      name: "Cheese",
      price_delta: 200,
      kds_station_id: null,
      is_available: true,
    },
    {
      id: "bacon",
      name: "Bacon",
      price_delta: 300,
      kds_station_id: null,
      is_available: true,
    },
    {
      id: "egg",
      name: "Egg",
      price_delta: 100,
      kds_station_id: null,
      is_available: false,
    },
  ],
};

function item(o: Partial<MenuItem> & { id: string; price: number }): MenuItem {
  return {
    category_id: "c",
    type: "item",
    name: o.id,
    short_name: o.id,
    description: null,
    image_url: null,
    base_price: o.price,
    tax_category: "ex",
    kds_station_id: null,
    is_available: true,
    modifier_groups: [],
    combo_slots: [],
    ...o,
  };
}

const burger = item({
  id: "burger",
  name: "Burger",
  price: 1000,
  modifier_groups: [extras],
});
const chips = item({
  id: "chips",
  name: "Chips",
  price: 500,
  modifier_groups: [size],
});
const wrap = item({
  id: "wrap",
  name: "Wrap",
  price: 2000,
  tax_category: "inc",
});
const meal = item({
  id: "meal",
  name: "Meal",
  type: "combo",
  price: 1500,
  combo_slots: [
    {
      id: "main",
      name: "Main",
      required: true,
      options: [{ menu_item_id: "burger", upcharge: 0, is_default: true }],
    },
    {
      id: "side",
      name: "Side",
      required: true,
      options: [
        { menu_item_id: "chips", upcharge: 0, is_default: true },
        { menu_item_id: "wrap", upcharge: 100, is_default: false },
      ],
    },
  ],
});
const menu: MenuDoc = {
  branch_id: "b",
  branch_name: "B",
  currency_code: "GHS",
  timezone: "Africa/Accra",
  generated_at: "",
  categories: [{ id: "c", name: "C", colour: null }],
  items: [burger, chips, wrap, meal],
  taxes: [tax("Ex 15", 1500, false, "ex"), tax("Inc 15", 1500, true, "inc")],
  stations: [],
  payment_methods: [],
};
const index = indexMenu(menu);

function line(
  o: Partial<CartLine> & { id: string; menuItemId: string },
): CartLine {
  return { quantity: 1, modifierIds: [], combo: [], notes: "", ...o };
}

describe("modifier choices", () => {
  it("pre-selects the first available option in required groups", () => {
    expect(defaultModifiers([size, extras])).toEqual(["regular"]);
  });

  it("replaces the choice in a pick-one group and keeps it when tapped again", () => {
    expect(toggleModifier(size, ["regular"], "large")).toEqual(["large"]);
    expect(toggleModifier(size, ["large"], "large")).toEqual(["large"]);
  });

  it("toggles up to the maximum in a pick-several group", () => {
    let chosen = toggleModifier(extras, [], "cheese");
    chosen = toggleModifier(extras, chosen, "bacon");
    expect(chosen).toEqual(["cheese", "bacon"]);
    expect(toggleModifier(extras, chosen, "egg")).toEqual(["cheese", "bacon"]);
    expect(toggleModifier(extras, chosen, "cheese")).toEqual(["bacon"]);
  });

  it("reports what the server would reject", () => {
    expect(modifierProblems(chips, [])).toEqual(["Choose size for Chips"]);
    expect(modifierProblems(burger, ["egg"])).toEqual(["Egg is out of stock"]);
    expect(modifierProblems(chips, ["regular"])).toEqual([]);
  });
});

describe("combo choices", () => {
  it("defaults each slot and the parts' required options", () => {
    expect(defaultComboChoices(meal, index)).toEqual([
      { slotId: "main", menuItemId: "burger", modifierIds: [] },
      { slotId: "side", menuItemId: "chips", modifierIds: ["regular"] },
    ]);
  });

  it("flags a missing required slot", () => {
    expect(
      comboProblems(
        meal,
        [{ slotId: "side", menuItemId: "chips", modifierIds: ["regular"] }],
        index,
      ),
    ).toEqual(["Choose the main for Meal"]);
  });
});

describe("prices", () => {
  it("adds modifiers, upcharges and part modifiers like the server", () => {
    expect(
      unitPrice(
        line({ id: "1", menuItemId: "burger", modifierIds: ["cheese"] }),
        index,
      ),
    ).toBe(1200);
    expect(
      unitPrice(
        line({
          id: "2",
          menuItemId: "meal",
          combo: [
            { slotId: "main", menuItemId: "burger", modifierIds: ["bacon"] },
            { slotId: "side", menuItemId: "chips", modifierIds: ["large"] },
          ],
        }),
        index,
      ),
    ).toBe(2050);
    expect(
      unitPrice(
        line({
          id: "3",
          menuItemId: "meal",
          combo: [
            { slotId: "main", menuItemId: "burger", modifierIds: [] },
            { slotId: "side", menuItemId: "wrap", modifierIds: [] },
          ],
        }),
        index,
      ),
    ).toBe(1600);
  });

  it("totals a cart", () => {
    const cart = {
      ...emptyCart("o1"),
      lines: [
        line({
          id: "1",
          menuItemId: "burger",
          quantity: 2,
          modifierIds: ["cheese"],
        }),
        line({ id: "2", menuItemId: "wrap" }),
      ],
    };
    const totals = priceCart(cart, menu, index);
    expect(totals).toMatchObject({
      subtotal: 4400,
      taxTotal: 621,
      total: 4760,
    });
    expect(totals.problems).toEqual([]);
  });
});

describe("cart", () => {
  it("merges identical lines and keeps different ones apart", () => {
    let cart = emptyCart("o1");
    cart = addLine(
      cart,
      line({ id: "a", menuItemId: "chips", modifierIds: ["regular"] }),
    );
    cart = addLine(
      cart,
      line({ id: "b", menuItemId: "chips", modifierIds: ["regular"] }),
    );
    cart = addLine(
      cart,
      line({ id: "c", menuItemId: "chips", modifierIds: ["large"] }),
    );
    expect(cart.lines.map((l) => [l.id, l.quantity])).toEqual([
      ["a", 2],
      ["c", 1],
    ]);
    expect(
      linesMatch(cart.lines[0], { ...cart.lines[0], notes: "no salt" }),
    ).toBe(false);
  });

  it("removes a line when its quantity reaches zero", () => {
    let cart = addLine(emptyCart("o1"), line({ id: "a", menuItemId: "wrap" }));
    cart = changeQuantity(cart, "a", -1);
    expect(cart.lines).toEqual([]);
  });

  it("builds a submit payload without prices", () => {
    let n = 0;
    const cart = addLine(
      emptyCart("o1", "delivery"),
      line({
        id: "a",
        menuItemId: "meal",
        combo: [{ slotId: "main", menuItemId: "burger", modifierIds: [] }],
      }),
    );
    const payload = toSubmitPayload(
      { ...cart, customerPhone: " 0200000000 ", deliveryAddress: "1 Road" },
      () => `id-${++n}`,
      "2026-10-16T09:00:00.000Z",
    );
    expect(payload).toMatchObject({
      id: "o1",
      order_type: "delivery",
      customer_phone: "0200000000",
      lines: [
        {
          id: "a",
          combo: [{ id: "id-1", slot_id: "main", menu_item_id: "burger" }],
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toMatch(/price|total/);
  });
});
