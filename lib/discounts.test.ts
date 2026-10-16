import { describe, expect, it } from "vitest";
import {
  emptyCart,
  hasAdjustments,
  linesMatch,
  toSubmitPayload,
  type Cart,
  type CartLine,
} from "./cart";
import { indexMenu, type MenuDoc, type MenuItem } from "./menu";
import {
  allocateDiscount,
  discountAmount,
  overDiscountLimit,
  priceCart,
} from "./pricing";

function item(id: string, name: string, price: number): MenuItem {
  return {
    id,
    category_id: "c",
    type: "item",
    name,
    short_name: name,
    description: null,
    image_url: null,
    price,
    base_price: price,
    tax_category: "exctest",
    kds_station_id: null,
    is_available: true,
    modifier_groups: [],
    combo_slots: [],
  };
}

// The items and the 10% tax of supabase/tests/012_exceptions.test.sql, so
// these totals are checked against submit_order there.
const menu: MenuDoc = {
  branch_id: "b",
  branch_name: "B",
  currency_code: "USD",
  timezone: "UTC",
  generated_at: "",
  categories: [{ id: "c", name: "C", colour: null }],
  items: [item("b", "Exc burger", 1000), item("d", "Exc drink", 500)],
  taxes: [
    {
      id: "t",
      name: "Exc tax",
      rate_bps: 1000,
      is_inclusive: false,
      tax_category: "exctest",
    },
  ],
  stations: [],
  payment_methods: [],
};
const index = indexMenu(menu);

function line(
  id: string,
  menuItemId: string,
  o: Partial<CartLine> = {},
): CartLine {
  return {
    id,
    menuItemId,
    quantity: 1,
    modifierIds: [],
    combo: [],
    notes: "",
    ...o,
  };
}

function cart(lines: CartLine[], o: Partial<Cart> = {}): Cart {
  return { ...emptyCart("o"), lines, ...o };
}

describe("discount maths (shared with the database tests)", () => {
  it("shares an order discount exactly", () => {
    expect(allocateDiscount(100, [500, 500, 500])).toEqual([34, 33, 33]);
    expect(allocateDiscount(10, [1, 2, 3])).toEqual([2, 3, 5]);
    expect(allocateDiscount(0, [5, 5])).toEqual([0, 0]);
    expect(allocateDiscount(5, [])).toEqual([]);
  });

  it("keeps large amounts exact", () => {
    const shares = allocateDiscount(999_999_999, [1_999_999_999, 3, 1]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(999_999_999);
  });

  it("rounds percentages half away from zero", () => {
    expect(
      discountAmount({ type: "percent", value: 1250, reason: "x" }, 999),
    ).toBe(125);
    expect(
      discountAmount({ type: "fixed", value: 300, reason: "x" }, 999),
    ).toBe(300);
    expect(discountAmount(null, 999)).toBe(0);
  });
});

describe("cart totals with discounts", () => {
  it("takes a line discount off before tax (order A)", () => {
    const totals = priceCart(
      cart([
        line("a", "b", {
          quantity: 2,
          discount: { type: "percent", value: 1000, reason: "Staff meal" },
        }),
      ]),
      menu,
      index,
    );
    expect(totals).toMatchObject({
      subtotal: 2000,
      discountTotal: 200,
      taxTotal: 180,
      total: 1980,
    });
  });

  it("shares an order discount across the lines (order B)", () => {
    const totals = priceCart(
      cart([line("1", "b"), line("2", "d")], {
        discount: { type: "fixed", value: 150, reason: "Loyalty" },
      }),
      menu,
      index,
    );
    expect(totals.lines.get("1")?.orderDiscountShare).toBe(100);
    expect(totals.lines.get("2")?.orderDiscountShare).toBe(50);
    expect(totals).toMatchObject({ orderDiscount: 150, total: 1485 });
    expect(overDiscountLimit(totals, 1000)).toBe(false);
  });

  it("knows when discounts go over the cashier's limit (order C)", () => {
    const totals = priceCart(
      cart([
        line("1", "b", {
          discount: { type: "percent", value: 2000, reason: "Complaint" },
        }),
        line("2", "d"),
      ]),
      menu,
      index,
    );
    expect(totals.total).toBe(1430);
    expect(overDiscountLimit(totals, 1000)).toBe(true);
    expect(overDiscountLimit(totals, 1500)).toBe(false);
  });

  it("charges a changed price (order E)", () => {
    const totals = priceCart(
      cart([
        line("1", "b", { price: { unitPrice: 700, reason: "Damaged box" } }),
      ]),
      menu,
      index,
    );
    expect(totals.lines.get("1")?.unitPrice).toBe(700);
    expect(totals.total).toBe(770);
  });

  it("flags discounts bigger than what they come off", () => {
    expect(
      priceCart(
        cart([
          line("1", "d", {
            discount: { type: "fixed", value: 600, reason: "x" },
          }),
        ]),
        menu,
        index,
      ).problems,
    ).toEqual(["The discount on Exc drink is more than its price"]);
    expect(
      priceCart(
        cart([line("1", "d")], {
          discount: { type: "fixed", value: 501, reason: "x" },
        }),
        menu,
        index,
      ).problems,
    ).toEqual(["The order discount is more than the order"]);
  });
});

describe("discounts in the cart", () => {
  const discount = { type: "percent" as const, value: 1000, reason: "Staff" };

  it("doesn't merge lines with different discounts or prices", () => {
    const plain = line("1", "b");
    expect(linesMatch(plain, line("2", "b"))).toBe(true);
    expect(linesMatch(plain, line("2", "b", { discount }))).toBe(false);
    expect(
      linesMatch(
        plain,
        line("2", "b", { price: { unitPrice: 1, reason: "x" } }),
      ),
    ).toBe(false);
    expect(
      linesMatch(line("1", "b", { discount }), line("2", "b", { discount })),
    ).toBe(true);
  });

  it("sends discounts, prices and approvals with the order", () => {
    const withAll = cart(
      [
        line("1", "b", {
          discount: { ...discount, reason: " Staff " },
          price: { unitPrice: 900, reason: "Promo" },
        }),
      ],
      { discount: { type: "fixed", value: 50, reason: "Loyalty" } },
    );
    expect(hasAdjustments(withAll)).toBe(true);
    expect(hasAdjustments(cart([line("1", "b")]))).toBe(false);
    const payload = toSubmitPayload(withAll, () => "x", "t", {
      discountOverrideId: "ov-d",
      priceOverrideId: "ov-p",
    });
    expect(payload).toMatchObject({
      discount: { type: "fixed", value: 50, reason: "Loyalty" },
      discount_override_id: "ov-d",
      price_override_id: "ov-p",
      lines: [
        {
          discount: { type: "percent", value: 1000, reason: "Staff" },
          price: { unit_price: 900, reason: "Promo" },
        },
      ],
    });
    expect(
      toSubmitPayload(cart([line("1", "b")]), () => "x", "t"),
    ).toMatchObject({
      discount: null,
      discount_override_id: null,
      lines: [{ discount: null, price: null }],
    });
  });
});
