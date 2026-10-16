"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { beep, unlockSound } from "@/lib/beep";
import { pickupBoard } from "@/lib/kitchen";
import { useKitchenOrders } from "@/lib/use-kitchen-orders";

/** The board customers watch: orders being made, and ready to collect. */
export function PickupBoard({
  branchId,
  branchName,
  readyMinutes,
  chime,
}: {
  branchId: string;
  branchName: string;
  readyMinutes: number;
  chime: boolean;
}) {
  const { orders, error } = useKitchenOrders(branchId);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    const unlock = () => unlockSound();
    window.addEventListener("pointerdown", unlock);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", unlock);
    };
  }, []);

  const board = useMemo(
    () => pickupBoard(orders ?? [], now, readyMinutes),
    [orders, now, readyMinutes],
  );

  // Chime when a number turns ready (not for the ones there on load).
  const seenReady = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!orders) return;
    const ready = new Set(board.ready.map((o) => o.id));
    if (
      seenReady.current &&
      chime &&
      [...ready].some((id) => !seenReady.current!.has(id))
    )
      beep("ready");
    seenReady.current = ready;
  }, [orders, board.ready, chime]);

  return (
    <div className="flex h-dvh flex-col text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between px-8">
        <h1 className="text-3xl font-bold">{branchName}</h1>
        {error ? (
          <span className="text-lg text-muted-foreground">Reconnecting…</span>
        ) : null}
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-2 gap-6 p-6">
        <section
          className="flex flex-col rounded-3xl border bg-card p-6 backdrop-blur-xl"
          aria-label="Preparing"
        >
          <h2 className="mb-6 text-4xl font-bold text-muted-foreground">
            Preparing
          </h2>
          <ul
            className="grid auto-rows-max grid-cols-3 gap-4"
            data-testid="pickup-preparing"
          >
            {board.preparing.map((o) => (
              <li
                key={o.id}
                className="text-center text-6xl font-bold text-foreground/80 tabular-nums"
              >
                {o.order_number}
              </li>
            ))}
          </ul>
        </section>
        <section
          className="flex flex-col rounded-3xl border bg-card p-6 backdrop-blur-xl"
          aria-label="Ready"
        >
          <h2 className="mb-6 text-4xl font-bold text-foreground">Ready</h2>
          <ul
            className="grid auto-rows-max grid-cols-2 gap-6"
            data-testid="pickup-ready"
          >
            {board.ready.map((o) => (
              <li
                key={o.id}
                className="rounded-2xl bg-black py-4 text-center text-7xl font-black text-white tabular-nums shadow-lg"
              >
                {o.order_number}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
