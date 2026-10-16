/**
 * The till's own database in the browser (IndexedDB through Dexie), one per
 * device. It keeps the outbox of writes waiting to reach the server, cached
 * data for working offline, and the offline order-number counters.
 */
import Dexie, { type Table } from "dexie";

/** The RPCs a till sends through the outbox. */
export type OutboxKind =
  | "start_offline_session"
  | "record_offline_override"
  | "open_shift"
  | "submit_order"
  | "record_payments"
  | "record_cash_movement";

export type OutboxStatus = "pending" | "failed" | "blocked";

export type OutboxItem = {
  /** Sending order. */
  seq?: number;
  id: string;
  kind: OutboxKind;
  /** The RPC's arguments, exactly as they'll be sent (and re-sent). */
  args: Record<string, unknown>;
  /** For people, e.g. "Order T1-042". */
  label: string;
  /** Who did it: used to send it again if their till session has ended. */
  staffId: string;
  /** Outbox items that must reach the server first. */
  dependsOn: string[];
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
};

export type CacheEntry = { key: string; value: unknown; savedAt: string };
export type Counter = { key: string; value: number };

export class TillDb extends Dexie {
  outbox!: Table<OutboxItem, number>;
  cache!: Table<CacheEntry, string>;
  counters!: Table<Counter, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      outbox: "++seq, &id, status",
      cache: "key",
      counters: "key",
    });
  }
}

const databases = new Map<string, TillDb>();

export function tillDb(deviceId: string): TillDb {
  let db = databases.get(deviceId);
  if (!db) {
    db = new TillDb(`pos-till-${deviceId}`);
    databases.set(deviceId, db);
  }
  return db;
}

export async function readCache<T>(db: TillDb, key: string): Promise<T | null> {
  try {
    return ((await db.cache.get(key))?.value as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function writeCache(
  db: TillDb,
  key: string,
  value: unknown,
): Promise<void> {
  try {
    await db.cache.put({ key, value, savedAt: new Date().toISOString() });
  } catch {
    // Storage blocked or full: offline mode just has older data.
  }
}

/**
 * The next offline order number for this till and business day, e.g.
 * "T1-042". Counted in the browser, so two tills never clash.
 */
export async function nextOfflineNumber(
  db: TillDb,
  deviceCode: string,
  businessDate: string,
): Promise<string> {
  const key = `orders:${businessDate}`;
  const value = await db.transaction("rw", db.counters, async () => {
    const next = ((await db.counters.get(key))?.value ?? 0) + 1;
    await db.counters.put({ key, value: next });
    return next;
  });
  const code =
    deviceCode
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6) || "T";
  return `${code}-${String(value).padStart(3, "0")}`;
}

/** Never count below what the server already has from this till. */
export async function raiseOfflineCounter(
  db: TillDb,
  businessDate: string,
  last: number,
): Promise<void> {
  const key = `orders:${businessDate}`;
  await db.transaction("rw", db.counters, async () => {
    const current = (await db.counters.get(key))?.value ?? 0;
    if (last > current) await db.counters.put({ key, value: last });
  });
}
