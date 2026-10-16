"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KITCHEN_ORDER_COLUMNS, type KitchenOrder } from "@/lib/kitchen";
import { createClient } from "@/lib/supabase/client";

const TWELVE_HOURS = 12 * 3600_000;

/**
 * The branch's orders in the kitchen (sent in the last 12 hours and not
 * collected), kept live: any change to an order or its items reloads them
 * a moment later, and every 30 seconds catches anything missed.
 */
export function useKitchenOrders(branchId: string) {
  const [supabase] = useState(createClient);
  const [orders, setOrders] = useState<KitchenOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("orders")
      .select(KITCHEN_ORDER_COLUMNS)
      .eq("branch_id", branchId)
      .not("sent_to_kitchen_at", "is", null)
      .is("collected_at", null)
      .gte(
        "sent_to_kitchen_at",
        new Date(Date.now() - TWELVE_HOURS).toISOString(),
      )
      .order("sent_to_kitchen_at")
      .limit(200);
    if (loadError) {
      setError("Can't reach the server. Showing the last orders seen.");
      return;
    }
    setOrders(data as unknown as KitchenOrder[]);
    setError(null);
  }, [supabase, branchId]);

  useEffect(() => {
    const schedule = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => void load(), 250);
    };
    const channel = supabase
      .channel(`kitchen-${branchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `branch_id=eq.${branchId}`,
        },
        schedule,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_items",
          filter: `branch_id=eq.${branchId}`,
        },
        schedule,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void load();
      });
    const poll = setInterval(() => void load(), 30_000);
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [supabase, branchId, load]);

  /** Shows a change straight away, before the server confirms it. */
  const apply = useCallback(
    (change: (orders: KitchenOrder[]) => KitchenOrder[]) =>
      setOrders((current) => (current ? change(current) : current)),
    [],
  );

  return { orders, error, reload: load, apply };
}
