import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { nextOfflineNumber, raiseOfflineCounter, TillDb } from "./db";
import { findStaffByPin, OfflineLockout, type OfflineStaff } from "./pin";
import { SyncEngine, type RpcCall } from "./sync";

let dbCount = 0;
const dbs: TillDb[] = [];
function freshDb() {
  const db = new TillDb(`test-${++dbCount}`);
  dbs.push(db);
  return db;
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete();
});

type Call = { fn: string; args: Record<string, unknown> };

/** A fake server: answers from `respond`, and records every call. */
function fakeServer(
  respond: (
    call: Call,
  ) => { code?: string; message: string } | null | "network",
) {
  const calls: Call[] = [];
  const rpc: RpcCall = async (fn, args) => {
    const call = { fn, args };
    calls.push(call);
    const answer = respond(call);
    if (answer === "network")
      return {
        data: null,
        error: { code: "", message: "TypeError: Failed to fetch" },
      };
    return { data: {}, error: answer };
  };
  return { rpc, calls };
}

function item(id: string, dependsOn: string[] = []) {
  return {
    id,
    kind: "submit_order" as const,
    args: { p_session_id: "s1", p_order: { id } },
    label: `Order ${id}`,
    staffId: "staff-1",
    dependsOn,
  };
}

describe("the outbox", () => {
  it("sends everything in order, once", async () => {
    const db = freshDb();
    const server = fakeServer(() => null);
    const engine = new SyncEngine(db, server.rpc);
    await engine.enqueue(item("a"));
    await engine.enqueue(item("b", ["a"]));
    await engine.flush();
    expect(
      server.calls.map((c) => (c.args.p_order as { id: string }).id),
    ).toEqual(["a", "b"]);
    expect(await engine.list()).toEqual([]);
    expect(engine.getState()).toMatchObject({
      pending: 0,
      failed: 0,
      online: true,
    });
  });

  it("keeps everything when the server can't be reached, and sends it later", async () => {
    const db = freshDb();
    let reachable = false;
    const server = fakeServer(() => (reachable ? null : "network"));
    const engine = new SyncEngine(db, server.rpc);
    await engine.enqueue(item("a"));
    await engine.enqueue(item("b"));
    await engine.enqueue(item("a")); // the same item again, still queued
    await engine.flush();
    expect(engine.getState()).toMatchObject({ online: false, pending: 2 });
    expect(engine.canSendDirectly()).toBe(false);

    reachable = true;
    engine.reportReachable(true);
    await engine.flush();
    expect(engine.getState()).toMatchObject({ online: true, pending: 0 });
    // Tried twice while offline (the first send, then flush), once each after.
    expect(server.calls.length).toBe(4);
    engine.stop();
  });

  it("marks refused items failed and blocks what needs them, until retried", async () => {
    const db = freshDb();
    let refuse = true;
    const server = fakeServer((call) =>
      refuse && (call.args.p_order as { id: string }).id === "a"
        ? { code: "22023", message: "Nope" }
        : null,
    );
    const engine = new SyncEngine(db, server.rpc);
    await engine.enqueue(item("a"));
    await engine.enqueue(item("b", ["a"]));
    await engine.enqueue(item("c"));
    await engine.flush();
    const left = await engine.list();
    expect(left.map((i) => [i.id, i.status, i.lastError])).toEqual([
      ["a", "failed", "Nope"],
      ["b", "blocked", "Waiting for an item that couldn't be sent"],
    ]);
    expect(engine.getState()).toMatchObject({ pending: 1, failed: 1 });

    refuse = false;
    await engine.retry("a");
    await engine.flush();
    expect(await engine.list()).toEqual([]);
  });

  it("discards an item with everything that needs it", async () => {
    const db = freshDb();
    const engine = new SyncEngine(
      db,
      fakeServer(() => ({ code: "22023", message: "x" })).rpc,
    );
    await engine.enqueue(item("a"));
    await engine.enqueue(item("b", ["a"]));
    await engine.enqueue(item("c", ["b"]));
    await engine.enqueue(item("d"));
    await engine.flush();
    expect(await engine.discard("a")).toBe(3);
    expect((await engine.list()).map((i) => i.id)).toEqual(["d"]);
  });

  it("sends under an offline session when the till session has ended", async () => {
    const db = freshDb();
    const server = fakeServer((call) =>
      call.fn === "submit_order" && call.args.p_session_id === "s1"
        ? { code: "PS401", message: "Session ended" }
        : null,
    );
    const engine = new SyncEngine(db, server.rpc, () => "replay-1");
    await engine.enqueue(item("a"));
    await engine.enqueue(item("b"));
    await engine.flush();
    expect(server.calls.map((c) => [c.fn, c.args.p_session_id])).toEqual([
      ["submit_order", "s1"],
      ["start_offline_session", "replay-1"],
      ["submit_order", "replay-1"],
      // The next item goes straight under the replacement session.
      ["submit_order", "replay-1"],
    ]);
    expect(server.calls[1].args.p_staff_id).toBe("staff-1");
    expect(await engine.list()).toEqual([]);
  });
});

describe("offline order numbers", () => {
  it("counts per till and business day", async () => {
    const db = freshDb();
    expect(await nextOfflineNumber(db, "T1", "2026-10-16")).toBe("T1-001");
    expect(await nextOfflineNumber(db, "T1", "2026-10-16")).toBe("T1-002");
    expect(await nextOfflineNumber(db, "t-2", "2026-10-17")).toBe("T2-001");
  });

  it("never counts below what the server already has", async () => {
    const db = freshDb();
    await raiseOfflineCounter(db, "2026-10-16", 41);
    expect(await nextOfflineNumber(db, "T1", "2026-10-16")).toBe("T1-042");
    await raiseOfflineCounter(db, "2026-10-16", 5);
    expect(await nextOfflineNumber(db, "T1", "2026-10-16")).toBe("T1-043");
  });
});

describe("offline PINs", () => {
  // Made by pgcrypto: crypt('4321', gen_salt('bf', 4)).
  const staff: OfflineStaff[] = [
    {
      id: "s1",
      full_name: "Ama",
      role: "cashier",
      pin_hash: "$2a$04$VF3q7SQ7FNXU47m0Zi8gtO4xHSfQjtdfgkLi4TV7t6lbWGi15207y",
      discount_limit_bps: 0,
      permissions: ["order.create"],
    },
  ];

  it("checks a PIN against the database's bcrypt hashes", async () => {
    expect((await findStaffByPin(staff, "4321"))?.id).toBe("s1");
    expect(await findStaffByPin(staff, "1234")).toBeNull();
    expect(await findStaffByPin(staff, "12")).toBeNull();
    expect(
      await findStaffByPin(staff, "4321", (s) =>
        s.permissions.includes("order.refund"),
      ),
    ).toBeNull();
  });

  it("locks after five wrong PINs within five minutes, for a minute", () => {
    const lockout = new OfflineLockout();
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) lockout.fail(t + i);
    expect(lockout.lockedFor(t + 10)).toBe(0);
    lockout.fail(t + 10);
    expect(lockout.lockedFor(t + 10)).toBe(60);
    expect(lockout.lockedFor(t + 70_010)).toBe(0);
    lockout.succeed();
    expect(lockout.lockedFor(t + 20)).toBe(0);
  });
});
