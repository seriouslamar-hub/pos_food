"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ManagerOverride } from "@/components/manager-override";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  addLine,
  changeQuantity,
  emptyCart,
  removeLine,
  replaceLine,
  toSubmitPayload,
  type Cart,
  type CartLine,
} from "@/lib/cart";
import { loadHeld, saveHeld, type HeldOrder } from "@/lib/held-orders";
import { loadLastReceipt, saveLastReceipt } from "@/lib/last-receipt";
import { canSell, indexMenu, type MenuItem } from "@/lib/menu";
import { formatAmount } from "@/lib/money";
import { parseOrderSummary, type OrderSummary } from "@/lib/orders";
import {
  amountPaid,
  toRecordPayments,
  type PendingPayment,
} from "@/lib/payments/tender";
import { priceCart } from "@/lib/pricing";
import { getPrinterDriver, type PrintJob } from "@/lib/printing";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";
import { isSessionEndedError, type TillSettings } from "@/lib/till";
import { usePermission, useTillSession } from "@/lib/till-session";
import { useLiveMenu } from "@/lib/use-live-menu";
import { CartPanel } from "./cart-panel";
import { ItemSheet } from "./item-sheet";
import { MenuGrid } from "./menu-grid";
import { PaymentScreen } from "./payment-screen";
import { SaleComplete } from "./sale-complete";
import { UnpaidOrders } from "./unpaid-orders";

const newId = () => crypto.randomUUID();
const printer = getPrinterDriver();

type RpcError = { code?: string; message: string };

/** Errors the database words for people; anything else is likely the connection. */
const READABLE_CODES = new Set(["22023", "42501", "P0002"]);

function rpcMessage(error: RpcError): string {
  return READABLE_CODES.has(error.code ?? "")
    ? error.message
    : "Couldn't reach the server. Check the connection and try again.";
}

/**
 * Taking payment for the cart (saved as an order when the payments are in)
 * or for a saved order that isn't paid yet.
 */
type Checkout = {
  cart: Cart | null;
  order: OrderSummary | null;
  total: number;
  notice: string | null;
  /** The order came from the cart (not from Unpaid orders). */
  fromCart: boolean;
  /** Saving failed in a way that may have gone through anyway. */
  unsure: boolean;
  /** Saving the payments was tried and failed. */
  paymentTried: boolean;
};

type OrderNoticeState = { order: OrderSummary; message: string };

/** The till's main screen: menu on the left, the order on the right. */
export function OrderScreen({
  branchId,
  deviceId,
  settings,
}: {
  branchId: string;
  deviceId: string;
  settings: TillSettings;
}) {
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const { menu, error: menuError } = useLiveMenu(branchId);
  const index = useMemo(() => (menu ? indexMenu(menu) : null), [menu]);

  const [cart, setCart] = useState<Cart>(() => emptyCart(newId()));
  const [editing, setEditing] = useState<{
    item: MenuItem;
    line?: CartLine;
  } | null>(null);
  const [held, setHeld] = useState<HeldOrder[]>(() => loadHeld(deviceId));
  const [holdOpen, setHoldOpen] = useState(false);
  const [recallOpen, setRecallOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<OrderNoticeState | null>(null);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<OrderSummary | null>(null);
  const [lastReceipt, setLastReceipt] = useState<OrderSummary | null>(() =>
    loadLastReceipt(deviceId),
  );

  const totals = useMemo(
    () => (menu && index ? priceCart(cart, menu, index) : null),
    [cart, menu, index],
  );
  // One server action at a time: a second tap can arrive before `busy`
  // disables the buttons.
  const working = useRef(false);

  // If the till locks with an order in progress, keep it as a held order.
  const cartRef = useRef(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);
  useEffect(() => {
    return () => {
      const unfinished = cartRef.current;
      if (unfinished.lines.length) {
        const label = `Unfinished ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        saveHeld(deviceId, [
          ...loadHeld(deviceId),
          { label, heldAt: new Date().toISOString(), cart: unfinished },
        ]);
      }
    };
  }, [deviceId]);

  function updateHeld(next: HeldOrder[]) {
    setHeld(next);
    saveHeld(deviceId, next);
  }

  function select(item: MenuItem) {
    if (!index) return;
    setNotice(null);
    setError(null);
    if (item.type === "combo" || item.modifier_groups.length) {
      setEditing({ item });
    } else {
      setCart((c) =>
        addLine(c, {
          id: newId(),
          menuItemId: item.id,
          quantity: 1,
          modifierIds: [],
          combo: [],
          notes: "",
        }),
      );
    }
  }

  /** Locks the till if the server says the session is over. */
  function sessionEnded(rpcError: RpcError | null): boolean {
    if (!isSessionEndedError(rpcError)) return false;
    lock("Your session ended. Sign in again.");
    return true;
  }

  /** Saves the cart as an order. Safe to repeat: the order keeps the cart's id. */
  async function saveCart(
    c: Cart,
  ): Promise<{ order: OrderSummary } | { error: RpcError }> {
    const { data, error: rpcError } = await supabase.rpc("submit_order", {
      p_session_id: session.sessionId,
      p_order: toSubmitPayload(
        c,
        newId,
        new Date().toISOString(),
      ) as unknown as Json,
    });
    return rpcError ? { error: rpcError } : { order: parseOrderSummary(data) };
  }

  /** A saved order, null if there's no such order, "unknown" if offline. */
  async function lookUpOrder(
    orderId: string,
  ): Promise<OrderSummary | null | "unknown"> {
    const { data, error: rpcError } = await supabase.rpc("get_order", {
      p_order_id: orderId,
    });
    if (rpcError?.code === "P0002") return null;
    if (rpcError) return "unknown";
    return parseOrderSummary(data);
  }

  function print(jobs: PrintJob[]) {
    if (jobs.length) void printer.print(jobs, settings.paperWidth);
  }

  /** The cart became a saved order: start a new one. */
  function clearSavedCart(orderId: string) {
    const freshId = newId();
    setCart((c) => (c.id === orderId ? emptyCart(freshId, c.orderType) : c));
  }

  function finishSale(order: OrderSummary, kitchenTicketPrinted: boolean) {
    setCheckout(null);
    setCheckoutError(null);
    clearSavedCart(order.id);
    setCompleted(order);
    setLastReceipt(order);
    saveLastReceipt(deviceId, order);
    if (order.payments.some((p) => p.method === "cash"))
      void printer.openDrawer();
    const jobs: PrintJob[] = [];
    if (settings.kitchenTickets && !kitchenTicketPrinted)
      jobs.push({ kind: "kitchen", order });
    if (settings.autoPrintReceipt) jobs.push({ kind: "receipt", order });
    print(jobs);
  }

  function charge() {
    if (!totals) return;
    setError(null);
    setNotice(null);
    setCheckoutError(null);
    setCheckout({
      cart,
      order: null,
      total: totals.total,
      notice: null,
      fromCart: true,
      unsure: false,
      paymentTried: false,
    });
  }

  async function completeCheckout(payments: PendingPayment[]) {
    const current = checkout;
    if (!current || working.current) return;
    working.current = true;
    // A pay-later order already had its kitchen ticket.
    const ticketPrinted = current.order?.sent_to_kitchen_at != null;
    setBusy(true);
    setCheckoutError(null);
    try {
      let order = current.order;
      if (!order && current.cart) {
        const saved = await saveCart(current.cart);
        if ("error" in saved) {
          if (sessionEnded(saved.error)) return;
          const unsure = !READABLE_CODES.has(saved.error.code ?? "");
          setCheckout({ ...current, unsure: current.unsure || unsure });
          setCheckoutError(rpcMessage(saved.error));
          return;
        }
        order = saved.order;
        // Paid on an earlier try whose answer got lost.
        if (order.paid_at) return finishSale(order, false);
        if (order.total !== amountPaid(payments)) {
          // The server's prices differ from the till's (a price or tax
          // changed after the items were rung up). Charge the saved total.
          const currency = order.branch.currency_code;
          clearSavedCart(order.id);
          setCheckout({
            ...current,
            cart: null,
            order,
            total: order.total,
            unsure: false,
            notice: `The total is now ${formatAmount(order.total, currency)} (it was ${formatAmount(current.total, currency)}) because a price changed. Take payment for the new total.`,
          });
          return;
        }
      }
      if (!order) return;

      const { data, error: rpcError } = await supabase.rpc("record_payments", {
        p_session_id: session.sessionId,
        p_order_id: order.id,
        p_payments: toRecordPayments(
          payments,
          new Date().toISOString(),
        ) as unknown as Json,
      });
      if (rpcError) {
        if (sessionEnded(rpcError)) return;
        if (rpcError.code === "23505") {
          // Different payments were saved for this order on an earlier try.
          const saved = await lookUpOrder(order.id);
          if (saved && saved !== "unknown" && saved.paid_at)
            return finishSale(saved, ticketPrinted);
        }
        setCheckout({ ...current, order, cart: null, paymentTried: true });
        setCheckoutError(rpcMessage(rpcError));
        return;
      }
      finishSale(parseOrderSummary(data), ticketPrinted);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  /** Back from the payment screen, after finding out what was saved. */
  async function leaveCheckout() {
    const current = checkout;
    if (!current) return;
    setCheckoutError(null);
    const orderId = current.order?.id ?? current.cart?.id;
    if (!orderId || (!current.unsure && !current.paymentTried)) {
      setCheckout(null);
      if (current.order && current.fromCart) {
        setNotice({
          order: current.order,
          message: "is saved but not paid. Take payment from Unpaid orders.",
        });
      }
      return;
    }

    if (working.current) return;
    working.current = true;
    setBusy(true);
    const saved = await lookUpOrder(orderId);
    working.current = false;
    setBusy(false);
    if (saved === "unknown") {
      setCheckout(null);
      // Keep the cart apart from an order that may have been saved.
      const freshId = newId();
      setCart((c) => (c.id === orderId ? { ...c, id: freshId } : c));
      setError(
        "Couldn't check whether the order was saved. Before charging again, check Unpaid orders once the connection is back.",
      );
      return;
    }
    if (saved?.paid_at)
      return finishSale(saved, current.order?.sent_to_kitchen_at != null);
    setCheckout(null);
    if (saved && current.fromCart) {
      clearSavedCart(saved.id);
      setNotice({
        order: saved,
        message: "is saved but not paid. Take payment from Unpaid orders.",
      });
    }
  }

  /** Pay-later dine-in: the kitchen starts now, payment comes later. */
  async function sendToKitchen() {
    const current = cart;
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveCart(current);
      if ("error" in saved) {
        if (sessionEnded(saved.error)) return;
        setError(rpcMessage(saved.error));
        if (!READABLE_CODES.has(saved.error.code ?? "")) {
          // It may have been saved (unsent) anyway; it would show under
          // Unpaid orders. Keep the cart apart from it.
          const freshId = newId();
          setCart((c) => (c.id === current.id ? { ...c, id: freshId } : c));
        }
        return;
      }
      clearSavedCart(current.id);
      const { data, error: rpcError } = await supabase.rpc("send_to_kitchen", {
        p_session_id: session.sessionId,
        p_order_id: saved.order.id,
      });
      if (rpcError) {
        if (sessionEnded(rpcError)) return;
        setNotice({
          order: saved.order,
          message: `is saved but didn't reach the kitchen (${rpcMessage(rpcError)}). Take payment from Unpaid orders to send it.`,
        });
        return;
      }
      const order = parseOrderSummary(data);
      setNotice({
        order,
        message:
          "is with the kitchen. Take payment from Unpaid orders when the customer is ready.",
      });
      if (settings.kitchenTickets) print([{ kind: "kitchen", order }]);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  /** From Unpaid orders: returns a problem to show, or null. */
  async function payUnpaid(orderId: string): Promise<string | null> {
    const { data, error: rpcError } = await supabase.rpc("get_order", {
      p_order_id: orderId,
    });
    if (rpcError) {
      if (sessionEnded(rpcError)) return null;
      return rpcMessage(rpcError);
    }
    const order = parseOrderSummary(data);
    if (order.paid_at) return `Order ${order.order_number} is already paid.`;
    setNotice(null);
    setCheckoutError(null);
    setCheckout({
      cart: null,
      order,
      total: order.total,
      notice: null,
      fromCart: false,
      unsure: false,
      paymentTried: false,
    });
    return null;
  }

  if (menuError && !menu) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>{menuError}</AlertDescription>
        </Alert>
      </main>
    );
  }
  if (!menu || !index || !totals) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-muted-foreground">
        Loading the menu…
      </main>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
        <TillTools>
          <UnpaidOrders
            branchId={branchId}
            currency={menu.currency_code}
            timezone={menu.timezone}
            disabled={busy}
            onPay={payUnpaid}
          />
          <Button
            size="lg"
            variant="outline"
            className="h-12 px-4 text-base"
            disabled={!lastReceipt}
            onClick={() =>
              lastReceipt &&
              print([{ kind: "receipt", order: lastReceipt, copy: true }])
            }
          >
            Reprint last receipt
          </Button>
        </TillTools>
        {notice ? (
          <OrderNotice
            notice={notice}
            currency={menu.currency_code}
            onDismiss={() => setNotice(null)}
          />
        ) : null}
        <MenuGrid menu={menu} onSelect={select} />
      </main>

      <CartPanel
        cart={cart}
        index={index}
        currency={menu.currency_code}
        totals={totals}
        heldCount={held.length}
        busy={busy}
        error={error}
        onOrderType={(orderType) => setCart((c) => ({ ...c, orderType }))}
        onCustomer={(patch) => setCart((c) => ({ ...c, ...patch }))}
        onEdit={(line) => {
          const item = index.items.get(line.menuItemId);
          if (item) setEditing({ item, line });
        }}
        onQuantity={(lineId, delta) =>
          setCart((c) => changeQuantity(c, lineId, delta))
        }
        onHold={() => setHoldOpen(true)}
        onRecall={() => setRecallOpen(true)}
        onClear={() => {
          if (window.confirm("Clear this order?"))
            setCart(emptyCart(newId(), cart.orderType));
        }}
        onCharge={charge}
        onSendToKitchen={
          settings.payLaterDineIn ? () => void sendToKitchen() : undefined
        }
      />

      {checkout ? (
        <PaymentScreen
          key={`${checkout.order?.id ?? checkout.cart?.id}:${checkout.total}`}
          title={
            checkout.order
              ? `Order ${checkout.order.order_number}`
              : "New order"
          }
          total={checkout.total}
          currency={menu.currency_code}
          methods={menu.payment_methods}
          notice={checkout.notice}
          busy={busy}
          error={checkoutError}
          newId={newId}
          onBack={() => void leaveCheckout()}
          onComplete={(payments) => void completeCheckout(payments)}
        />
      ) : null}

      {completed ? (
        <SaleComplete
          order={completed}
          paperWidth={settings.paperWidth}
          onPrint={() => print([{ kind: "receipt", order: completed }])}
          onDone={() => setCompleted(null)}
        />
      ) : null}

      {editing ? (
        <ItemSheet
          item={editing.item}
          index={index}
          currency={menu.currency_code}
          initial={editing.line}
          newId={newId}
          onClose={() => setEditing(null)}
          onRemove={
            editing.line
              ? () => {
                  setCart((c) => removeLine(c, editing.line!.id));
                  setEditing(null);
                }
              : undefined
          }
          onConfirm={(line) => {
            setCart((c) =>
              editing.line ? replaceLine(c, line) : addLine(c, line),
            );
            setEditing(null);
          }}
        />
      ) : null}

      <HoldDialog
        open={holdOpen}
        onClose={() => setHoldOpen(false)}
        onHold={(label) => {
          updateHeld([
            ...held,
            { label, heldAt: new Date().toISOString(), cart },
          ]);
          setCart(emptyCart(newId(), cart.orderType));
          setHoldOpen(false);
        }}
      />
      <RecallDialog
        open={recallOpen}
        held={held}
        currency={menu.currency_code}
        totalOf={(c) => priceCart(c, menu, index).total}
        sellable={(c) =>
          c.lines.every((l) => {
            const item = index.items.get(l.menuItemId);
            return item ? canSell(item, index) : false;
          })
        }
        cartInProgress={cart.lines.length > 0}
        onClose={() => setRecallOpen(false)}
        onRecall={(i) => {
          setCart(held[i].cart);
          updateHeld(held.filter((_, j) => j !== i));
          setRecallOpen(false);
          setNotice(null);
        }}
        onDelete={(i) => updateHeld(held.filter((_, j) => j !== i))}
      />
    </div>
  );
}

function OrderNotice({
  notice,
  currency,
  onDismiss,
}: {
  notice: OrderNoticeState;
  currency: string;
  onDismiss: () => void;
}) {
  const { order, message } = notice;
  return (
    <Alert aria-live="polite" data-testid="order-notice">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3 text-base">
        <span>
          Order{" "}
          <strong className="text-2xl" data-testid="order-number">
            {order.order_number}
          </strong>{" "}
          (
          <strong data-testid="order-total">
            {formatAmount(order.total, currency)}
          </strong>
          ) {message}
        </span>
        <Button variant="outline" size="touch" onClick={onDismiss}>
          OK
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Till actions that aren't part of an order (no sale needs approval). */
function TillTools({ children }: { children?: ReactNode }) {
  const canNoSale = usePermission("drawer.no_sale");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {children}
        <Button
          size="lg"
          variant="outline"
          className="h-12 px-4 text-base"
          onClick={() => {
            setResult(null);
            if (canNoSale)
              setResult(
                "Allowed. The drawer will open here once cash management is built (Phase 7).",
              );
            else setOverrideOpen(true);
          }}
        >
          No sale (open drawer)
        </Button>
      </div>
      {result ? (
        <Alert aria-live="polite">
          <AlertDescription
            className="text-base"
            data-testid="till-action-result"
          >
            {result}
          </AlertDescription>
        </Alert>
      ) : null}
      <ManagerOverride
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        permission="drawer.no_sale"
        actionLabel="Opening the drawer without a sale"
        requireReason
        onApproved={(approval) =>
          setResult(
            `Approved by ${approval.approverName}. The drawer will open here once cash management is built (Phase 7).`,
          )
        }
      />
    </div>
  );
}

function HoldDialog({
  open,
  onClose,
  onHold,
}: {
  open: boolean;
  onClose: () => void;
  onHold: (label: string) => void;
}) {
  const [label, setLabel] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Hold this order</DialogTitle>
          <DialogDescription>
            Give it a label so you can find it again, e.g. the customer&apos;s
            name.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onHold(label.trim() || "Held order");
            setLabel("");
          }}
        >
          <Input
            aria-label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Blue shirt"
            className="h-12 text-base"
            maxLength={40}
            autoFocus
          />
          <Button type="submit" size="touch">
            Hold order
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecallDialog({
  open,
  held,
  currency,
  totalOf,
  sellable,
  cartInProgress,
  onClose,
  onRecall,
  onDelete,
}: {
  open: boolean;
  held: HeldOrder[];
  currency: string;
  totalOf: (cart: Cart) => number;
  sellable: (cart: Cart) => boolean;
  cartInProgress: boolean;
  onClose: () => void;
  onRecall: (index: number) => void;
  onDelete: (index: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Held orders</DialogTitle>
          <DialogDescription>
            {cartInProgress
              ? "Hold or clear the current order before recalling another."
              : "Tap one to carry on with it."}
          </DialogDescription>
        </DialogHeader>
        {held.length === 0 ? (
          <p className="text-muted-foreground">Nothing is on hold.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {held.map((h, i) => (
              <li key={`${h.cart.id}-${i}`} className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="touch"
                  disabled={cartInProgress}
                  className="flex-1 justify-between"
                  onClick={() => onRecall(i)}
                >
                  <span className="truncate">{h.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {h.cart.lines.reduce((n, l) => n + l.quantity, 0)} items ·{" "}
                    {formatAmount(totalOf(h.cart), currency)}
                    {!sellable(h.cart) ? " · something is out of stock" : ""}
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => onDelete(i)}
                  aria-label={`Delete held order ${h.label}`}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
