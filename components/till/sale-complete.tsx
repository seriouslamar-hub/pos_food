"use client";

import { Receipt } from "@/components/receipt";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAmount } from "@/lib/money";
import type { OrderSummary } from "@/lib/orders";
import type { PaperWidth } from "@/lib/printing";

/** After payment: the order number, the change to hand back, the receipt. */
export function SaleComplete({
  order,
  paperWidth,
  onPrint,
  onDone,
}: {
  order: OrderSummary;
  paperWidth: PaperWidth;
  onPrint: () => void;
  onDone: () => void;
}) {
  const money = (amount: number) =>
    formatAmount(amount, order.branch.currency_code);
  const methods = [...new Set(order.payments.map((p) => p.method_name))];

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[94dvh] w-[min(52rem,97vw)] max-w-none flex-col gap-4 overflow-y-auto p-5 sm:max-w-none"
        data-testid="sale-complete"
      >
        <div className="grid gap-5 md:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle className="text-2xl">Sale complete</DialogTitle>
              <DialogDescription className="text-base">
                {order.total
                  ? `Paid ${money(order.total)} by ${methods.join(" and ")}.`
                  : "Nothing to pay."}
              </DialogDescription>
            </DialogHeader>
            <p className="text-lg">
              Order{" "}
              <strong className="text-5xl" data-testid="order-number">
                {order.order_number}
              </strong>
            </p>
            {order.change_given ? (
              <p className="rounded-xl bg-muted p-4 text-center">
                <span className="block text-lg">Change to give</span>
                <strong
                  className="text-5xl tabular-nums"
                  data-testid="change-due"
                >
                  {money(order.change_given)}
                </strong>
              </p>
            ) : null}
            <div className="mt-auto grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="touch"
                className="h-16"
                onClick={onPrint}
              >
                Print receipt
              </Button>
              <Button
                size="touch"
                className="h-16 text-xl"
                onClick={onDone}
                autoFocus
              >
                New order
              </Button>
            </div>
          </div>
          <div className="max-h-[70dvh] overflow-y-auto rounded-lg border bg-white p-3 shadow-sm">
            <Receipt order={order} paperWidth={paperWidth} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
