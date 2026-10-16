"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { beep, unlockSound } from "@/lib/beep";
import {
  formatElapsed,
  ticketAge,
  ticketsFor,
  type KitchenOrder,
  type Ticket,
} from "@/lib/kitchen";
import { ORDER_TYPE_LABELS } from "@/lib/orders";
import { createClient } from "@/lib/supabase/client";
import { useKitchenOrders } from "@/lib/use-kitchen-orders";
import { cn } from "@/lib/utils";

const CHANNEL_LABELS: Record<KitchenOrder["channel"], string> = {
  counter: "Counter",
  kiosk: "Kiosk",
  online: "Online",
  drive_thru: "Drive-thru",
};

/**
 * The kitchen display: live tickets for one station (or every station).
 * Tap an item or a ticket's Done to bump it; keys 1–9 bump tickets in order
 * (a bump bar), 0 recalls the last one.
 */
export function KdsApp({
  branchId,
  deviceName,
  station,
  warnMinutes,
  lateMinutes,
  sound,
}: {
  branchId: string;
  deviceName: string;
  station: { id: string; name: string } | null;
  warnMinutes: number;
  lateMinutes: number;
  sound: boolean;
}) {
  const [supabase] = useState(createClient);
  const { orders, error, reload, apply } = useKitchenOrders(branchId);
  const [now, setNow] = useState(() => Date.now());
  const [recallOpen, setRecallOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const unlock = () => unlockSound();
    window.addEventListener("pointerdown", unlock);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", unlock);
    };
  }, []);

  const { active, done } = useMemo(
    () => ticketsFor(orders ?? [], station?.id ?? null),
    [orders, station],
  );

  // Beep for new tickets and newly voided items (not on the first load).
  const seen = useRef<{ tickets: Set<string>; voids: Set<string> } | null>(
    null,
  );
  useEffect(() => {
    if (!orders) return;
    const tickets = new Set(active.map((t) => t.order.id));
    const voids = new Set(
      active.flatMap((t) =>
        t.lines
          .flatMap((l) => [l.item, ...l.parts])
          .filter((i) => i.status === "voided")
          .map((i) => i.id),
      ),
    );
    const before = seen.current;
    if (before && sound) {
      if ([...voids].some((id) => !before.voids.has(id))) beep("void");
      else if ([...tickets].some((id) => !before.tickets.has(id))) beep("new");
    }
    seen.current = { tickets, voids };
  }, [orders, active, sound]);

  async function bump(ids: string[]) {
    if (!ids.length) return;
    setProblem(null);
    const at = new Date().toISOString();
    apply((list) =>
      list.map((o) => ({
        ...o,
        order_items: o.order_items.map((i) =>
          ids.includes(i.id)
            ? {
                ...i,
                bumped_at: i.bumped_at ?? at,
                status:
                  i.status === "sent" || i.status === "pending"
                    ? "ready"
                    : i.status,
              }
            : i,
        ),
      })),
    );
    const { error: rpcError } = await supabase.rpc("bump_items", {
      p_item_ids: ids,
    });
    if (rpcError) {
      setProblem("Couldn't bump that. Check the connection.");
      void reload();
    }
  }

  async function recall(ticket: Ticket) {
    const ids = ticket.lines.flatMap((l) => [
      l.item.id,
      ...l.parts.map((p) => p.id),
    ]);
    setProblem(null);
    const { error: rpcError } = await supabase.rpc("recall_items", {
      p_item_ids: ids,
    });
    if (rpcError) setProblem(rpcError.message);
    setRecallOpen(false);
    void reload();
  }

  // Bump bar: 1–9 bump tickets in order; 0 recalls the last bumped one.
  const activeRef = useRef(active);
  const doneRef = useRef(done);
  useEffect(() => {
    activeRef.current = active;
    doneRef.current = done;
  }, [active, done]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!/^[0-9]$/.test(event.key)) return;
      if (event.key === "0") {
        const last = doneRef.current[0];
        if (last) void recall(last);
        return;
      }
      const ticket = activeRef.current[Number(event.key) - 1];
      if (ticket) void bump(ticket.itemIds);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // bump and recall only use stable values and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-50">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-zinc-800 px-5">
        <h1 className="text-2xl font-bold" data-testid="kds-title">
          {station ? station.name : "All stations"}
          <span className="ml-3 text-base font-normal text-zinc-400">
            {deviceName}
          </span>
        </h1>
        <div className="flex items-center gap-3">
          <span
            className="text-lg text-zinc-300 tabular-nums"
            data-testid="kds-count"
          >
            {active.length} {active.length === 1 ? "ticket" : "tickets"}
          </span>
          <Button
            size="touch"
            variant="secondary"
            onClick={() => setRecallOpen(true)}
            disabled={done.length === 0}
          >
            Recall
          </Button>
        </div>
      </header>
      {error || problem ? (
        <Alert variant="destructive" className="m-3 w-auto">
          <AlertDescription className="text-base">
            {problem ?? error}
          </AlertDescription>
        </Alert>
      ) : null}
      <main className="grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3 overflow-y-auto p-3">
        {orders === null ? (
          <p className="col-span-full p-6 text-xl text-zinc-400">
            Loading orders…
          </p>
        ) : active.length === 0 ? (
          <p
            className="col-span-full p-6 text-2xl text-zinc-400"
            data-testid="kds-empty"
          >
            Nothing to make.
          </p>
        ) : (
          active.map((ticket, i) => (
            <TicketCard
              key={ticket.order.id}
              ticket={ticket}
              position={i + 1}
              age={ticketAge(
                ticket.order.sent_to_kitchen_at,
                now,
                warnMinutes,
                lateMinutes,
              )}
              onBumpItem={(ids) => void bump(ids)}
              onBumpTicket={() => void bump(ticket.itemIds)}
            />
          ))
        )}
      </main>

      <Dialog open={recallOpen} onOpenChange={setRecallOpen}>
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">Recall a ticket</DialogTitle>
            <DialogDescription>
              The last tickets cleared from this screen.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2">
            {done.map((t) => (
              <li key={t.order.id}>
                <Button
                  variant="outline"
                  size="touch"
                  className="w-full justify-between"
                  onClick={() => void recall(t)}
                >
                  <span>#{t.order.order_number}</span>
                  <span className="text-sm text-muted-foreground">
                    {t.lines.length} {t.lines.length === 1 ? "item" : "items"}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TicketCard({
  ticket,
  position,
  age,
  onBumpItem,
  onBumpTicket,
}: {
  ticket: Ticket;
  position: number;
  age: { seconds: number; level: "fresh" | "warn" | "late" };
  onBumpItem: (ids: string[]) => void;
  onBumpTicket: () => void;
}) {
  const { order } = ticket;
  return (
    <article
      className="flex flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900"
      data-testid="kds-ticket"
      data-level={age.level}
      aria-label={`Order ${order.order_number}`}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-4 py-2",
          age.level === "late"
            ? "bg-red-600 text-white"
            : age.level === "warn"
              ? "bg-amber-400 text-zinc-950"
              : "bg-zinc-800",
        )}
      >
        <span className="text-3xl font-black">#{order.order_number}</span>
        <span className="text-right text-sm leading-tight">
          {ORDER_TYPE_LABELS[order.order_type]}
          {order.channel !== "counter"
            ? ` · ${CHANNEL_LABELS[order.channel]}`
            : ""}
          {order.pickup_at
            ? ` · pickup ${new Date(order.pickup_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
            : ""}
          <span className="block text-xl font-bold tabular-nums">
            {formatElapsed(age.seconds)}
          </span>
        </span>
        {position <= 9 ? (
          <span className="flex size-8 items-center justify-center rounded-full bg-black/30 text-lg font-bold">
            {position}
          </span>
        ) : null}
      </div>
      <ul className="flex flex-1 flex-col">
        {ticket.lines.map(({ item, meal, parts }) => {
          const ids = [item.id, ...parts.map((p) => p.id)].filter((id) =>
            ticket.itemIds.includes(id),
          );
          const voided = item.status === "voided";
          const made = !voided && item.bumped_at !== null;
          return (
            <li key={item.id} className="border-t border-zinc-800">
              <button
                type="button"
                disabled={ids.length === 0}
                onClick={() => onBumpItem(ids)}
                className={cn(
                  "flex min-h-14 w-full flex-col items-start px-4 py-2 text-left",
                  voided && "bg-red-950/60",
                  made && "opacity-40",
                )}
                data-testid="kds-line"
                data-status={voided ? "voided" : made ? "done" : "todo"}
              >
                <span
                  className={cn(
                    "text-xl font-semibold",
                    (voided || made) && "line-through",
                  )}
                >
                  {item.quantity} × {item.short_name_snapshot}
                  {voided ? (
                    <span className="ml-2 text-base font-bold text-red-400 no-underline">
                      VOID
                    </span>
                  ) : null}
                </span>
                {meal ? (
                  <span className="text-sm text-zinc-400">{meal}</span>
                ) : null}
                {item.modifiers.length ? (
                  <span className="text-base text-amber-300">
                    {item.modifiers.map((m) => m.name).join(", ")}
                  </span>
                ) : null}
                {parts.map((p) => (
                  <span
                    key={p.id}
                    className={cn(
                      "text-base",
                      p.status === "voided" || p.bumped_at
                        ? "text-zinc-500 line-through"
                        : "",
                    )}
                  >
                    • {p.short_name_snapshot}
                    {p.modifiers.length
                      ? ` (${p.modifiers.map((m) => m.name).join(", ")})`
                      : ""}
                  </span>
                ))}
                {item.notes ? (
                  <span className="text-base font-semibold text-sky-300">
                    “{item.notes}”
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {order.notes ? (
        <p className="border-t border-zinc-800 px-4 py-2 text-sky-300">
          {order.notes}
        </p>
      ) : null}
      <Button
        size="touch"
        className="m-3 h-14 bg-emerald-600 text-xl text-white hover:bg-emerald-500"
        onClick={onBumpTicket}
        aria-label={`Done with order ${order.order_number}`}
      >
        Done
      </Button>
    </article>
  );
}
