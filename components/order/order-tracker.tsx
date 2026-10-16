"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatInZone } from "@/lib/datetime";
import { formatAmount } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";

type OnlineOrder = {
  id: string;
  order_number: string;
  branch_name: string;
  currency_code: string;
  timezone: string;
  total: number;
  paid: boolean;
  pay_at_counter: boolean;
  pickup_at: string | null;
  ready: boolean;
  collected: boolean;
  status: string;
  lines: { name: string; quantity: number; total: number }[];
};

/** A customer's online order, refreshed every 10 seconds until collected. */
export function OrderTracker({ orderId }: { orderId: string }) {
  const [supabase] = useState(createClient);
  const [order, setOrder] = useState<OnlineOrder | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = () =>
      supabase
        .rpc("get_online_order", { p_order_id: orderId })
        .then(({ data, error }) => {
          if (stop) return;
          if (error || !data) setMissing(true);
          else setOrder(data as unknown as OnlineOrder);
        });
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [supabase, orderId]);

  if (missing)
    return (
      <main className="flex flex-col gap-3">
        <p>We couldn&apos;t find that order on this phone.</p>
        <Link href="/order" className="underline">
          Order again
        </Link>
      </main>
    );
  if (!order) return <p>Loading your order…</p>;
  const money = (n: number) => formatAmount(n, order.currency_code);
  const state = order.collected
    ? "Collected. Enjoy!"
    : order.ready
      ? "Ready! Come to the counter."
      : order.paid
        ? "Paid. The kitchen is making it."
        : order.pay_at_counter
          ? "Waiting for you: pay when you collect, then we'll make it."
          : "Waiting for your payment.";
  return (
    <main
      className="mx-auto flex w-full max-w-lg flex-col gap-4"
      data-testid="order-tracker"
    >
      <p className="text-muted-foreground">{order.branch_name}</p>
      <h1 className="text-4xl font-bold">
        Order <span data-testid="tracked-number">{order.order_number}</span>
      </h1>
      <p className="text-xl font-medium" data-testid="tracked-state">
        {state}
      </p>
      {order.pickup_at ? (
        <p>
          Pickup at{" "}
          {formatInZone(order.pickup_at, order.timezone, {
            timeStyle: "short",
          })}
        </p>
      ) : null}
      <ul className="divide-y rounded-xl border">
        {order.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-2 p-3">
            <span>
              {l.quantity} × {l.name}
            </span>
            <span className="tabular-nums">{money(l.total)}</span>
          </li>
        ))}
        <li className="flex justify-between gap-2 p-3 font-bold">
          <span>Total</span>
          <span className="tabular-nums">{money(order.total)}</span>
        </li>
      </ul>
    </main>
  );
}
