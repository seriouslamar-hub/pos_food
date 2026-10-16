"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatElapsed, type KitchenOrder } from "@/lib/kitchen";
import { ORDER_TYPE_LABELS } from "@/lib/orders";
import { createClient } from "@/lib/supabase/client";
import { isSessionEndedError, rpcErrorMessage } from "@/lib/till";
import { useTillSession } from "@/lib/till-session";
import { useKitchenOrders } from "@/lib/use-kitchen-orders";

/**
 * The till's view of the kitchen: orders ready to hand over (and those
 * still being made), each with Collected.
 */
export function KitchenOrders({
  branchId,
  disabled,
}: {
  branchId: string;
  disabled?: boolean;
}) {
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const { orders, reload, apply } = useKitchenOrders(branchId);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  const live = (orders ?? []).filter(
    (o) => !o.collected_at && o.status !== "voided",
  );
  const ready = live.filter((o) => o.ready_at);
  const preparing = live.filter((o) => !o.ready_at);

  async function collected(order: KitchenOrder) {
    setError(null);
    apply((list) =>
      list.map((o) =>
        o.id === order.id
          ? { ...o, collected_at: new Date().toISOString() }
          : o,
      ),
    );
    const { error: rpcError } = await supabase.rpc("mark_order_collected", {
      p_session_id: session.sessionId,
      p_order_id: order.id,
    });
    if (isSessionEndedError(rpcError)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    if (rpcError) {
      setError(rpcErrorMessage(rpcError));
      void reload();
    }
  }

  function row(order: KitchenOrder, since: string) {
    return (
      <li
        key={order.id}
        className="flex items-center justify-between gap-3 rounded-xl border p-3"
        data-testid="kitchen-order"
      >
        <span>
          <strong className="text-2xl">#{order.order_number}</strong>
          <span className="ml-3 text-muted-foreground">
            {ORDER_TYPE_LABELS[order.order_type]} ·{" "}
            {formatElapsed(
              Math.max(0, Math.floor((now - Date.parse(since)) / 1000)),
            )}
            {order.paid_at ? "" : " · not paid"}
          </span>
        </span>
        <Button
          size="touch"
          variant={order.ready_at ? "default" : "outline"}
          disabled={!order.paid_at}
          onClick={() => void collected(order)}
        >
          Collected
        </Button>
      </li>
    );
  }

  return (
    <>
      <Button
        size="lg"
        variant={ready.length ? "default" : "outline"}
        className="h-12 px-4 text-base"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid="ready-button"
      >
        Ready ({ready.length})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[94dvh] w-[min(44rem,97vw)] max-w-none flex-col gap-4 overflow-y-auto p-5 sm:max-w-none">
          <DialogHeader>
            <DialogTitle className="text-2xl">Kitchen orders</DialogTitle>
            <DialogDescription>
              Tap Collected when the customer has their order.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription className="text-base">{error}</AlertDescription>
            </Alert>
          ) : null}
          <section className="flex flex-col gap-2" aria-label="Ready">
            <h3 className="text-lg font-semibold">Ready</h3>
            {ready.length ? (
              <ul className="flex flex-col gap-2">
                {ready.map((o) => row(o, o.ready_at!))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                Nothing waiting at the counter.
              </p>
            )}
          </section>
          <section className="flex flex-col gap-2" aria-label="Being made">
            <h3 className="text-lg font-semibold">Being made</h3>
            {preparing.length ? (
              <ul className="flex flex-col gap-2">
                {preparing.map((o) => row(o, o.sent_to_kitchen_at))}
              </ul>
            ) : (
              <p className="text-muted-foreground">The kitchen is clear.</p>
            )}
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
