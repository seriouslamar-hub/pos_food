import { describe, expect, it } from "vitest";
import {
  applyPromotions,
  localParts,
  loyaltyRedemption,
  pointsEarned,
  promotionLineDiscounts,
  promotionRuns,
  type MenuPromotion,
} from "./promotions";

// The same cases as supabase/tests/017_promotions.test.sql, so the preview
// and the server agree.

const BRANCH = "b1";
let n = 0;
function promo(p: Partial<MenuPromotion>): MenuPromotion {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `Promo ${n}`,
    description: null,
    type: "percent_off",
    value: 0,
    item_ids: [],
    category_ids: [],
    buy_quantity: null,
    get_quantity: null,
    get_discount_bps: 10000,
    start_date: null,
    end_date: null,
    days_of_week: [],
    start_time: null,
    end_time: null,
    branch_ids: [],
    channels: [],
    order_types: [],
    min_spend: 0,
    priority: 0,
    stackable: false,
    has_coupon: false,
    needs_customer: false,
    created_at: `2026-10-16T09:00:${String(n).padStart(2, "0")}Z`,
    ...p,
  };
}

const local = { date: "2026-10-16", time: "12:30:00", isoDow: 5 };
const order = {
  branchId: BRANCH,
  channel: "counter",
  orderType: "takeaway",
  hasCustomer: false,
  local,
};
const burger = (quantity = 1) => ({
  id: "l1",
  menuItemId: "burger",
  categoryId: "mains",
  quantity,
  left: 2000 * quantity,
});
const fries = (quantity: number) => ({
  id: "l2",
  menuItemId: "fries",
  categoryId: "sides",
  quantity,
  left: 1000 * quantity,
});

describe("applyPromotions", () => {
  const take1 = promo({
    name: "Take 1",
    type: "amount_off",
    value: 100,
    priority: 5,
    stackable: true,
  });
  const take10 = promo({
    name: "Take 10%",
    type: "percent_off",
    value: 1000,
    priority: 4,
    stackable: true,
  });
  const half = promo({
    name: "Half price",
    type: "percent_off",
    value: 5000,
    priority: 10,
    has_coupon: true,
  });

  it("stacks promotions highest priority first, each on what's left", () => {
    const { applied } = applyPromotions([take10, take1], order, [burger()]);
    expect(applied.map((a) => [a.name, a.amount])).toEqual([
      ["Take 1", 100],
      ["Take 10%", 190],
    ]);
  });

  it("uses a promotion that doesn't stack on its own", () => {
    const { applied } = applyPromotions([take1, take10, half], order, [
      burger(),
    ]);
    expect(applied).toEqual([
      { id: half.id, name: "Half price", amount: 1000 },
    ]);
  });

  it("keeps to the order type, channel and branch", () => {
    const delivery = promo({
      type: "amount_off",
      value: 100,
      order_types: ["delivery"],
    });
    const kiosk = promo({
      type: "amount_off",
      value: 100,
      channels: ["kiosk"],
    });
    const elsewhere = promo({
      type: "amount_off",
      value: 100,
      branch_ids: ["b2"],
    });
    expect(
      applyPromotions([delivery, kiosk, elsewhere], order, [burger()]).applied,
    ).toEqual([]);
  });

  it("needs a minimum spend and, for per-customer limits, a customer", () => {
    const big = promo({ type: "amount_off", value: 100, min_spend: 2500 });
    const members = promo({
      type: "amount_off",
      value: 100,
      needs_customer: true,
    });
    expect(applyPromotions([big, members], order, [burger()]).applied).toEqual(
      [],
    );
    expect(
      applyPromotions([members], { ...order, hasCustomer: true }, [burger()])
        .applied,
    ).toHaveLength(1);
  });
});

describe("promotionLineDiscounts", () => {
  it("buy 2 get 1 free: the cheapest of each full group of three", () => {
    const p = promo({
      type: "buy_x_get_y",
      buy_quantity: 2,
      get_quantity: 1,
      category_ids: ["sides"],
    });
    expect(promotionLineDiscounts(p, [fries(3)]).get("l2")).toBe(1000);
    expect(promotionLineDiscounts(p, [fries(5)]).get("l2")).toBe(1000);
    // With a burger in the order, only the fries qualify.
    expect(promotionLineDiscounts(p, [burger(), fries(2)]).size).toBe(0);
  });

  it("buy 1 get 1 half price across lines: the cheaper item is half off", () => {
    const p = promo({
      type: "buy_x_get_y",
      buy_quantity: 1,
      get_quantity: 1,
      get_discount_bps: 5000,
    });
    const out = promotionLineDiscounts(p, [burger(), fries(1)]);
    expect(out.get("l2")).toBe(500);
    expect(out.has("l1")).toBe(false);
  });

  it("a fixed price per item", () => {
    const p = promo({ type: "fixed_price", value: 1500, item_ids: ["burger"] });
    expect(promotionLineDiscounts(p, [burger(2)]).get("l1")).toBe(1000);
    // Never more than the line: an item already cheaper is left alone.
    expect(promotionLineDiscounts(p, [{ ...burger(), left: 1200 }]).size).toBe(
      0,
    );
  });

  it("shares an amount off across lines exactly", () => {
    const p = promo({ type: "amount_off", value: 1000 });
    const out = promotionLineDiscounts(p, [burger(), fries(1)]);
    expect(out.get("l1")! + out.get("l2")!).toBe(1000);
    expect(out.get("l1")).toBe(667);
  });
});

describe("time windows", () => {
  const lunch = promo({ start_time: "12:00:00", end_time: "14:00:00" });

  it("run in the branch's local time", () => {
    // 23:30 UTC on the 15th is 12:30 on the 16th in Auckland.
    const at = new Date("2026-10-15T23:30:00Z");
    const auckland = localParts(at, "Pacific/Auckland");
    expect(auckland).toEqual({
      date: "2026-10-16",
      time: "12:30:00",
      isoDow: 5,
    });
    expect(promotionRuns(lunch, BRANCH, auckland)).toBe(true);
    expect(promotionRuns(lunch, BRANCH, localParts(at, "UTC"))).toBe(false);
    expect(
      promotionRuns(
        lunch,
        BRANCH,
        localParts(new Date("2026-10-16T03:00:00Z"), "Pacific/Auckland"),
      ),
    ).toBe(false);
  });

  it("respect dates and weekdays", () => {
    expect(
      promotionRuns(promo({ end_date: "2026-10-15" }), BRANCH, local),
    ).toBe(false);
    expect(
      promotionRuns(promo({ start_date: "2026-10-16" }), BRANCH, local),
    ).toBe(true);
    expect(promotionRuns(promo({ days_of_week: [6, 7] }), BRANCH, local)).toBe(
      false,
    );
    expect(promotionRuns(promo({ days_of_week: [5] }), BRANCH, local)).toBe(
      true,
    );
  });
});

describe("loyalty", () => {
  it("spends points up to what's left", () => {
    expect(loyaltyRedemption(15, 1, 1000)).toEqual({ amount: 15, points: 15 });
    expect(loyaltyRedemption(500, 10, 1234)).toEqual({
      amount: 1234,
      points: 124,
    });
    expect(loyaltyRedemption(0, 1, 1000)).toEqual({ amount: 0, points: 0 });
  });

  it("earns a point per amount spent, rounded down", () => {
    expect(pointsEarned(2000, 100)).toBe(20);
    expect(pointsEarned(985, 100)).toBe(9);
  });
});
