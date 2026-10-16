/**
 * Sends the outbox to the server, oldest first. Every write is idempotent
 * on its device id, so sending one again (after a dropped connection, or
 * twice from two tabs) never does it twice.
 *
 * - Can't reach the server: stop, and try again with exponential backoff
 *   (1 s doubling to a minute), or as soon as the browser is back online.
 * - The server refuses an item: mark it failed (with the reason), and block
 *   the items that need it. A manager can try it again or discard it.
 * - The item's till session has ended (PS401): register an offline session
 *   for the same person and send it again under that.
 */
import { isReadableError } from "../till";
import type { OutboxItem, OutboxKind, TillDb } from "./db";

type RpcError = { code?: string; message: string };
export type RpcCall = (
  fn: OutboxKind,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

export type SyncState = {
  /** Whether the server could be reached last time we tried. */
  online: boolean;
  /** Waiting to be sent (including blocked ones). */
  pending: number;
  failed: number;
  syncing: boolean;
};

const SESSION_ENDED = "PS401";
const FIRST_BACKOFF = 1000;
const MAX_BACKOFF = 60_000;
const SEND_TIMEOUT = 15_000;

type SendResult = "ok" | "network" | { failed: string };

export class SyncEngine {
  private state: SyncState = {
    online: true,
    pending: 0,
    failed: 0,
    syncing: false,
  };
  private listeners = new Set<() => void>();
  private running = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private backoff = FIRST_BACKOFF;
  private stopped = false;
  /** Sessions registered to send items whose till session had ended. */
  private replaySessions = new Map<string, string>();

  constructor(
    private db: TillDb,
    private rpc: RpcCall,
    private newId: () => string = () => crypto.randomUUID(),
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  private update(patch: Partial<SyncState>) {
    const next = { ...this.state, ...patch };
    if (
      next.online === this.state.online &&
      next.pending === this.state.pending &&
      next.failed === this.state.failed &&
      next.syncing === this.state.syncing
    )
      return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /** Starts sending, and follows the browser's online and offline events. */
  start() {
    this.stopped = false;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
      if (navigator.onLine === false) this.update({ online: false });
    }
    void this.refreshCounts();
    this.trigger();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
    }
  }

  private onOnline = () => {
    this.backoff = FIRST_BACKOFF;
    this.update({ online: true });
    this.trigger();
  };

  private onOffline = () => this.update({ online: false });

  /** Tells the engine whether a direct request just reached the server. */
  reportReachable(reachable: boolean) {
    this.update({ online: reachable });
    if (reachable) this.trigger();
  }

  /** Whether new writes should go straight to the server (nothing queued). */
  canSendDirectly(): boolean {
    return (
      this.state.online && this.state.pending === 0 && this.state.failed === 0
    );
  }

  async enqueue(
    item: Pick<OutboxItem, "id" | "kind" | "args" | "label" | "staffId"> & {
      dependsOn?: string[];
    },
  ): Promise<OutboxItem> {
    const full: OutboxItem = {
      ...item,
      dependsOn: item.dependsOn ?? [],
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    // Already queued (e.g. a retry after the till reloaded): keep the first.
    if (!(await this.db.outbox.where("id").equals(item.id).first())) {
      await this.db.outbox.add(full);
    }
    await this.refreshCounts();
    // While the server can't be reached, the backoff timer does the trying.
    if (this.state.online) this.trigger();
    return full;
  }

  /** Everything still to send, oldest first. */
  list(): Promise<OutboxItem[]> {
    return this.db.outbox.orderBy("seq").toArray();
  }

  /** Sends a failed item (and what was blocked by it) again. */
  async retry(id: string) {
    const items = await this.list();
    const again = this.withDependents(items, id);
    await this.db.outbox
      .where("id")
      .anyOf([...again])
      .modify({ status: "pending", lastError: null });
    this.backoff = FIRST_BACKOFF;
    await this.refreshCounts();
    this.trigger();
  }

  /** Drops an item and everything that needs it. Returns how many went. */
  async discard(id: string): Promise<number> {
    const items = await this.list();
    const gone = this.withDependents(items, id);
    await this.db.outbox
      .where("id")
      .anyOf([...gone])
      .delete();
    await this.refreshCounts();
    return gone.size;
  }

  private withDependents(items: OutboxItem[], id: string): Set<string> {
    const found = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of items) {
        if (!found.has(item.id) && item.dependsOn.some((d) => found.has(d))) {
          found.add(item.id);
          grew = true;
        }
      }
    }
    return found;
  }

  trigger() {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    clearTimeout(this.timer);
    void this.run();
  }

  /** Resolves when the outbox has been worked through once. */
  async flush() {
    this.trigger();
    while (this.running) await new Promise((r) => setTimeout(r, 20));
  }

  private async refreshCounts() {
    try {
      const items = await this.db.outbox.toArray();
      this.update({
        pending: items.filter((i) => i.status !== "failed").length,
        failed: items.filter((i) => i.status === "failed").length,
      });
    } catch {
      // The database is closed or blocked; counts stay as they were.
    }
  }

  private scheduleRetry() {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(() => this.trigger(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
  }

  private async run() {
    this.running = true;
    this.update({ syncing: true });
    try {
      do {
        this.again = false;
        const outcome = await this.pass();
        if (outcome === "network") {
          this.update({ online: false });
          this.scheduleRetry();
          return;
        }
      } while (this.again && !this.stopped);
      this.backoff = FIRST_BACKOFF;
    } finally {
      this.running = false;
      await this.refreshCounts();
      this.update({ syncing: false });
    }
  }

  /** One pass over the outbox, oldest first. */
  private async pass(): Promise<"done" | "network"> {
    const items = await this.list();
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const item of items) {
      if (this.stopped) return "done";
      if (item.status !== "pending") continue;
      const deps = item.dependsOn
        .map((d) => byId.get(d))
        .filter((d): d is OutboxItem => d !== undefined);
      if (deps.some((d) => d.status !== "pending")) {
        await this.db.outbox.update(item.seq!, {
          status: "blocked",
          lastError: "Waiting for an item that couldn't be sent",
        });
        byId.set(item.id, { ...item, status: "blocked" });
        continue;
      }
      // Dependencies still waiting were sent earlier in this pass unless
      // they failed; anything still here waits for the next pass.
      if (deps.length) continue;

      const result = await this.send(item);
      if (result === "network") return "network";
      this.update({ online: true });
      if (result === "ok") {
        await this.db.outbox.delete(item.seq!);
        byId.delete(item.id);
      } else {
        await this.db.outbox.update(item.seq!, {
          status: "failed",
          lastError: result.failed,
          attempts: item.attempts + 1,
        });
        byId.set(item.id, { ...item, status: "failed" });
      }
      await this.refreshCounts();
    }
    // Items that waited on something sent in this pass go next time.
    if ([...byId.values()].some((i) => i.status === "pending"))
      this.again = true;
    return "done";
  }

  private async call(
    kind: OutboxKind,
    args: Record<string, unknown>,
  ): Promise<{ error: RpcError | null } | "timeout"> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), SEND_TIMEOUT);
    });
    try {
      return await Promise.race([this.rpc(kind, args), timeout]);
    } catch {
      return { error: { message: "Failed to fetch" } };
    } finally {
      clearTimeout(timer);
    }
  }

  private classify(error: RpcError | null): SendResult {
    if (!error) return "ok";
    if (
      isReadableError(error) ||
      error.code === "23505" ||
      error.code?.startsWith("PGRST")
    )
      return { failed: error.message };
    return "network";
  }

  private async send(item: OutboxItem): Promise<SendResult> {
    const sessionId = this.replaySessions.get(item.staffId);
    const args =
      sessionId && "p_session_id" in item.args
        ? { ...item.args, p_session_id: sessionId }
        : item.args;
    const result = await this.call(item.kind, args);
    if (result === "timeout") return "network";
    if (result.error?.code !== SESSION_ENDED || !("p_session_id" in item.args))
      return this.classify(result.error);

    // The session it was made under has ended: send it under an offline
    // session for the same person.
    const replay = this.newId();
    const registered = await this.call("start_offline_session", {
      p_session_id: replay,
      p_staff_id: item.staffId,
      p_started_at: item.createdAt,
    });
    if (registered === "timeout") return "network";
    const outcome = this.classify(registered.error);
    if (outcome !== "ok") return outcome;
    this.replaySessions.set(item.staffId, replay);
    await this.db.outbox.update(item.seq!, {
      args: { ...item.args, p_session_id: replay },
    });
    const retried = await this.call(item.kind, {
      ...item.args,
      p_session_id: replay,
    });
    if (retried === "timeout") return "network";
    return this.classify(retried.error);
  }
}
