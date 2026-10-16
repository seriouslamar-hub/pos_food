import { describe, expect, it } from "vitest";
import {
  formatElapsed,
  pickupBoard,
  resolveStation,
  ticketAge,
  ticketsFor,
  type KitchenItem,
  type KitchenOrder,
} from "./kitchen";

function item(id: string, o: Partial<KitchenItem> = {}): KitchenItem {
  return {
    id,
    parent_item_id: null,
    name_snapshot: id,
    short_name_snapshot: id,
    combo_slot_name: null,
    quantity: 1,
    modifiers: [],
    notes: null,
    status: "sent",
    kds_station_id: null,
    sort_order: 0,
    bumped_at: null,
    ...o,
  };
}

function order(
  id: string,
  items: KitchenItem[],
  o: Partial<KitchenOrder> = {},
): KitchenOrder {
  return {
    id,
    order_number: id,
    order_type: "takeaway",
    channel: "counter",
    status: "paid",
    sent_to_kitchen_at: "2026-10-16T10:00:00Z",
    ready_at: null,
    collected_at: null,
    paid_at: "2026-10-16T10:00:00Z",
    notes: null,
    order_items: items,
    ...o,
  };
}

// A meal (burger at the grill, drink at drinks), and fries with no station.
const meal = order("001", [
  item("meal", { name_snapshot: "2-piece meal", sort_order: 10 }),
  item("burger", {
    parent_item_id: "meal",
    kds_station_id: "grill",
    sort_order: 11,
  }),
  item("drink", {
    parent_item_id: "meal",
    kds_station_id: "drinks",
    sort_order: 12,
  }),
  item("fries", { sort_order: 20 }),
]);

describe("kitchen tickets", () => {
  it("shows a station its items, and items with no station", () => {
    const { active } = ticketsFor([meal], "grill");
    expect(active).toHaveLength(1);
    expect(active[0].lines.map((l) => [l.item.id, l.meal])).toEqual([
      ["burger", "2-piece meal"],
      ["fries", null],
    ]);
    expect(active[0].itemIds).toEqual(["burger", "fries"]);
  });

  it("shows every station whole lines with their parts", () => {
    const { active } = ticketsFor([meal], null);
    expect(
      active[0].lines.map((l) => [l.item.id, l.parts.map((p) => p.id)]),
    ).toEqual([
      ["meal", ["burger", "drink"]],
      ["fries", []],
    ]);
    expect(active[0].itemIds).toEqual(["meal", "burger", "drink", "fries"]);
  });

  it("moves a ticket to done once this screen has bumped it", () => {
    const bumped = order("001", [
      ...meal.order_items.filter((i) => !["burger", "fries"].includes(i.id)),
      item("burger", {
        parent_item_id: "meal",
        kds_station_id: "grill",
        bumped_at: "2026-10-16T10:03:00Z",
      }),
      item("fries", { bumped_at: "2026-10-16T10:04:00Z", sort_order: 20 }),
    ]);
    expect(ticketsFor([bumped], "grill")).toMatchObject({
      active: [],
      done: [{ bumpedAt: "2026-10-16T10:04:00Z" }],
    });
    // The drinks station still has the drink.
    expect(ticketsFor([bumped], "drinks").active[0].itemIds).toEqual(["drink"]);
  });

  it("keeps voided lines until acknowledged, then drops them", () => {
    const voided = order("002", [item("x", { status: "voided" })]);
    expect(ticketsFor([voided], "grill").active[0].lines[0].item.status).toBe(
      "voided",
    );
    const seen = order("002", [
      item("x", { status: "voided", bumped_at: "2026-10-16T10:05:00Z" }),
    ]);
    expect(ticketsFor([seen], "grill")).toEqual({ active: [], done: [] });
  });

  it("puts the oldest first and keeps the last ten done", () => {
    const orders = Array.from({ length: 12 }, (_, i) =>
      order(String(i), [
        item(`i${i}`, {
          bumped_at: `2026-10-16T10:${String(i).padStart(2, "0")}:00Z`,
        }),
      ]),
    );
    const late = order("late", [item("a")], {
      sent_to_kitchen_at: "2026-10-16T09:00:00Z",
    });
    const early = order("early", [item("b")], {
      sent_to_kitchen_at: "2026-10-16T08:00:00Z",
    });
    const { active, done } = ticketsFor([...orders, late, early], "grill");
    expect(active.map((t) => t.order.id)).toEqual(["early", "late"]);
    expect(done.map((t) => t.order.id)).toEqual([
      "11",
      "10",
      "9",
      "8",
      "7",
      "6",
      "5",
      "4",
      "3",
      "2",
    ]);
  });
});

describe("timers and the pickup board", () => {
  it("turns amber, then red", () => {
    const sent = "2026-10-16T10:00:00Z";
    const at = (s: number) => Date.parse(sent) + s * 1000;
    expect(ticketAge(sent, at(179), 3, 5).level).toBe("fresh");
    expect(ticketAge(sent, at(180), 3, 5).level).toBe("warn");
    expect(ticketAge(sent, at(300), 3, 5)).toEqual({
      seconds: 300,
      level: "late",
    });
    expect(formatElapsed(187)).toBe("3:07");
    expect(formatElapsed(3725)).toBe("1:02:05");
  });

  it("lists orders being made and ready ones for a while", () => {
    const now = Date.parse("2026-10-16T10:20:00Z");
    const board = pickupBoard(
      [
        order("a", []),
        order("b", [], { status: "ready", ready_at: "2026-10-16T10:15:00Z" }),
        order("c", [], { status: "ready", ready_at: "2026-10-16T10:05:00Z" }),
        order("d", [], {
          status: "collected",
          ready_at: "2026-10-16T10:18:00Z",
          collected_at: "2026-10-16T10:19:00Z",
        }),
      ],
      now,
      10,
    );
    expect(board.preparing.map((o) => o.id)).toEqual(["a"]);
    expect(board.ready.map((o) => o.id)).toEqual(["b"]);
  });

  it("finds a screen's station by name or id", () => {
    const stations = [
      { id: "s1", name: "Grill" },
      { id: "s2", name: "Drinks" },
    ];
    expect(resolveStation(stations, " grill ")?.id).toBe("s1");
    expect(resolveStation(stations, "s2")?.name).toBe("Drinks");
    expect(resolveStation(stations, "all")).toBeNull();
    expect(resolveStation(stations, null)).toBeNull();
    expect(resolveStation(stations, "Nope")).toBeNull();
  });
});
