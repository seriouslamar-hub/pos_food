/**
 * Kitchen tickets and the pickup board, worked out from the branch's
 * orders (as the kitchen screen reads them). Pure functions.
 */

export type KitchenItem = {
  id: string;
  parent_item_id: string | null;
  name_snapshot: string;
  short_name_snapshot: string;
  combo_slot_name: string | null;
  quantity: number;
  modifiers: { name: string }[];
  notes: string | null;
  status: "pending" | "sent" | "ready" | "voided";
  kds_station_id: string | null;
  sort_order: number;
  bumped_at: string | null;
};

export type KitchenOrder = {
  id: string;
  order_number: string;
  order_type: "dine_in" | "takeaway" | "delivery";
  channel: "counter" | "kiosk" | "online" | "drive_thru";
  status: string;
  sent_to_kitchen_at: string;
  ready_at: string | null;
  collected_at: string | null;
  paid_at: string | null;
  /** Online orders: when the customer will collect. */
  pickup_at?: string | null;
  notes: string | null;
  order_items: KitchenItem[];
};

/** What the kitchen screen query selects. */
export const KITCHEN_ORDER_COLUMNS =
  "id, order_number, order_type, channel, status, sent_to_kitchen_at, ready_at, collected_at, paid_at, pickup_at, notes, " +
  "order_items(id, parent_item_id, name_snapshot, short_name_snapshot, combo_slot_name, quantity, modifiers, notes, status, kds_station_id, sort_order, bumped_at)";

export type TicketLine = {
  item: KitchenItem;
  /** The meal a part belongs to (station screens), e.g. "2-piece meal". */
  meal: string | null;
  /** A meal's parts (all-stations screen). */
  parts: KitchenItem[];
};

export type Ticket = {
  order: KitchenOrder;
  lines: TicketLine[];
  /** What bumping the whole ticket clears on this screen. */
  itemIds: string[];
  /** When this screen last bumped something on it (done tickets). */
  bumpedAt: string | null;
};

function isLeaf(item: KitchenItem, items: KitchenItem[]) {
  return !items.some((i) => i.parent_item_id === item.id);
}

/**
 * The tickets for a screen: one station (its items, plus any item with no
 * station), or every station (`null`) with whole lines. Active tickets
 * have something not yet bumped, oldest first; done ones are the last ten
 * cleared, newest first, for recall. Voided lines show until acknowledged.
 */
export function ticketsFor(
  orders: KitchenOrder[],
  stationId: string | null,
): { active: Ticket[]; done: Ticket[] } {
  const active: Ticket[] = [];
  const done: Ticket[] = [];
  for (const order of orders) {
    if (order.collected_at) continue;
    const items = [...order.order_items].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    const byId = new Map(items.map((i) => [i.id, i]));
    let lines: TicketLine[];
    if (stationId === null) {
      lines = items
        .filter((i) => i.parent_item_id === null)
        .map((item) => ({
          item,
          meal: null,
          parts: items.filter((p) => p.parent_item_id === item.id),
        }));
    } else {
      lines = items
        .filter(
          (i) =>
            isLeaf(i, items) &&
            (i.kds_station_id === stationId || i.kds_station_id === null),
        )
        .map((item) => ({
          item,
          meal: item.parent_item_id
            ? (byId.get(item.parent_item_id)?.name_snapshot ?? null)
            : null,
          parts: [],
        }));
    }
    // Voided before the kitchen saw it: nothing to show.
    lines = lines.filter(
      (l) => !(l.item.status === "voided" && l.item.bumped_at !== null),
    );
    if (lines.length === 0) continue;
    const all = lines.flatMap((l) => [l.item, ...l.parts]);
    const waiting = all.filter((i) => i.bumped_at === null);
    const ticket: Ticket = {
      order,
      lines,
      itemIds: waiting.map((i) => i.id),
      bumpedAt: waiting.length
        ? null
        : all.reduce<string | null>(
            (latest, i) =>
              latest && latest > i.bumped_at! ? latest : i.bumped_at,
            null,
          ),
    };
    if (waiting.length) active.push(ticket);
    else done.push(ticket);
  }
  active.sort((a, b) =>
    a.order.sent_to_kitchen_at.localeCompare(b.order.sent_to_kitchen_at),
  );
  done.sort((a, b) => (b.bumpedAt ?? "").localeCompare(a.bumpedAt ?? ""));
  return { active, done: done.slice(0, 10) };
}

/** Ticket colour by how long the kitchen has had it. */
export function ticketAge(
  sentAt: string,
  now: number,
  warnMinutes: number,
  lateMinutes: number,
): { seconds: number; level: "fresh" | "warn" | "late" } {
  const seconds = Math.max(0, Math.floor((now - Date.parse(sentAt)) / 1000));
  const level =
    seconds >= lateMinutes * 60
      ? "late"
      : seconds >= warnMinutes * 60
        ? "warn"
        : "fresh";
  return { seconds, level };
}

/** 3:07, or 1:02:05 past an hour. */
export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The pickup board: being made, and ready (for `readyMinutes`). */
export function pickupBoard(
  orders: KitchenOrder[],
  now: number,
  readyMinutes: number,
): { preparing: KitchenOrder[]; ready: KitchenOrder[] } {
  const live = orders.filter(
    (o) => !o.collected_at && o.status !== "voided" && o.status !== "refunded",
  );
  return {
    preparing: live
      .filter((o) => !o.ready_at)
      .sort((a, b) => a.sent_to_kitchen_at.localeCompare(b.sent_to_kitchen_at)),
    ready: live
      .filter(
        (o) =>
          o.ready_at && now - Date.parse(o.ready_at) < readyMinutes * 60_000,
      )
      .sort((a, b) => (b.ready_at ?? "").localeCompare(a.ready_at ?? "")),
  };
}

/** The kitchen station a screen shows, from its device setting or ?station=. */
export function resolveStation(
  stations: { id: string; name: string }[],
  wanted: string | null | undefined,
): { id: string; name: string } | null {
  const text = wanted?.trim().toLowerCase();
  if (!text || text === "all" || text === "expo") return null;
  return (
    stations.find(
      (s) => s.id === wanted || s.name.trim().toLowerCase() === text,
    ) ?? null
  );
}
