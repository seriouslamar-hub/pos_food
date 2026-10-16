"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatInZone } from "@/lib/datetime";
import { formatAmount } from "@/lib/money";
import { ORDER_TYPE_LABELS, type OrderSummary } from "@/lib/orders";
import { createClient } from "@/lib/supabase/client";

type UnpaidOrder = Pick<
  OrderSummary,
  | "id"
  | "order_number"
  | "order_type"
  | "channel"
  | "total"
  | "created_at"
  | "sent_to_kitchen_at"
>;

/**
 * Orders saved but not paid yet: pay-later dine-in orders, and orders whose
 * payment didn't finish. Taking payment for one opens the payment screen.
 */
export function UnpaidOrders({
  branchId,
  currency,
  timezone,
  disabled,
  onPay,
}: {
  branchId: string;
  currency: string;
  timezone: string;
  disabled?: boolean;
  onPay: (orderId: string) => Promise<string | null>;
}) {
  const [supabase] = useState(createClient);
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<UnpaidOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    setOrders(null);
    setError(null);
    const { data, error: loadError } = await supabase
      .from("orders")
      .select(
        "id, order_number, order_type, channel, total, created_at, sent_to_kitchen_at",
      )
      .eq("branch_id", branchId)
      .is("paid_at", null)
      .neq("status", "voided")
      .order("created_at", { ascending: false })
      .limit(50);
    if (loadError) {
      setError("Couldn't load unpaid orders. Check the connection.");
      return;
    }
    setOrders(data);
  }

  async function pay(orderId: string) {
    setOpening(orderId);
    setError(null);
    const problem = await onPay(orderId);
    setOpening(null);
    if (problem) setError(problem);
    else setOpen(false);
  }

  return (
    <>
      <Button
        size="lg"
        variant="outline"
        className="h-12 px-4 text-base"
        disabled={disabled}
        onClick={() => void show()}
      >
        Unpaid orders
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Unpaid orders</DialogTitle>
            <DialogDescription>
              Orders saved at this branch that haven&apos;t been paid.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive" aria-live="polite">
              <AlertDescription className="text-base">{error}</AlertDescription>
            </Alert>
          ) : null}
          {orders === null ? (
            error ? null : (
              <p className="text-muted-foreground">Loading…</p>
            )
          ) : orders.length === 0 ? (
            <p className="text-muted-foreground">Every order is paid.</p>
          ) : (
            <ul className="flex max-h-[60dvh] flex-col gap-2 overflow-y-auto">
              {orders.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-3 rounded-xl border p-3"
                  data-testid="unpaid-order"
                >
                  <span>
                    <strong className="text-lg">Order {o.order_number}</strong>
                    <span className="block text-sm text-muted-foreground">
                      {o.channel === "kiosk"
                        ? "Kiosk · "
                        : o.channel === "online"
                          ? "Online · "
                          : ""}
                      {ORDER_TYPE_LABELS[o.order_type]} ·{" "}
                      {o.sent_to_kitchen_at ? "in the kitchen" : "not sent"} ·{" "}
                      {formatInZone(o.created_at, timezone, {
                        timeStyle: "short",
                      })}
                    </span>
                  </span>
                  <Button
                    size="touch"
                    disabled={opening !== null}
                    onClick={() => void pay(o.id)}
                  >
                    {opening === o.id
                      ? "Opening…"
                      : `Take ${formatAmount(o.total, currency)}`}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
