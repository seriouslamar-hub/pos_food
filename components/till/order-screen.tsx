"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { canSell, indexMenu, type MenuItem } from "@/lib/menu";
import { formatAmount } from "@/lib/money";
import { parseOrderSummary, type OrderSummary } from "@/lib/orders";
import { priceCart } from "@/lib/pricing";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";
import { isSessionEndedError } from "@/lib/till";
import { usePermission, useTillSession } from "@/lib/till-session";
import { useLiveMenu } from "@/lib/use-live-menu";
import { CartPanel } from "./cart-panel";
import { ItemSheet } from "./item-sheet";
import { MenuGrid } from "./menu-grid";

const newId = () => crypto.randomUUID();

/** The till's main screen: menu on the left, the order on the right. */
export function OrderScreen({
  branchId,
  deviceId,
}: {
  branchId: string;
  deviceId: string;
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
  const [placed, setPlaced] = useState<{
    order: OrderSummary;
    previewTotal: number;
  } | null>(null);

  const totals = useMemo(
    () => (menu && index ? priceCart(cart, menu, index) : null),
    [cart, menu, index],
  );

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
    setPlaced(null);
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

  async function charge() {
    if (!menu || !index || !totals) return;
    setBusy(true);
    setError(null);
    const payload = toSubmitPayload(cart, newId, new Date().toISOString());
    const { data, error: rpcError } = await supabase.rpc("submit_order", {
      p_session_id: session.sessionId,
      p_order: payload as unknown as Json,
    });
    setBusy(false);
    if (isSessionEndedError(rpcError)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    if (rpcError) {
      // Validation messages are written for people; anything else is likely the
      // connection. Sending again is safe: the order keeps the same id.
      setError(
        rpcError.code === "22023" || rpcError.code === "42501"
          ? rpcError.message
          : "Couldn't send the order. Check the connection and try again.",
      );
      return;
    }
    const order = parseOrderSummary(data);
    setPlaced({ order, previewTotal: totals.total });
    setCart(emptyCart(newId(), cart.orderType));
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
        <TillTools />
        {placed ? (
          <PlacedNotice
            placed={placed}
            currency={menu.currency_code}
            onDismiss={() => setPlaced(null)}
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
        onCharge={() => void charge()}
      />

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
          setPlaced(null);
        }}
        onDelete={(i) => updateHeld(held.filter((_, j) => j !== i))}
      />
    </div>
  );
}

function PlacedNotice({
  placed,
  currency,
  onDismiss,
}: {
  placed: { order: OrderSummary; previewTotal: number };
  currency: string;
  onDismiss: () => void;
}) {
  const { order, previewTotal } = placed;
  return (
    <Alert aria-live="polite" data-testid="order-placed">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3 text-base">
        <span>
          Order{" "}
          <strong className="text-2xl" data-testid="order-number">
            {order.order_number}
          </strong>{" "}
          sent ·{" "}
          <strong data-testid="order-total">
            {formatAmount(order.total, currency)}
          </strong>
          {order.total !== previewTotal ? (
            <span className="block text-sm" data-testid="total-changed">
              The server worked out a different total (
              {formatAmount(previewTotal, currency)} on the till). The saved
              total is the one to charge.
            </span>
          ) : null}
          <span className="block text-sm text-muted-foreground">
            Taking payment arrives in Phase 6.
          </span>
        </span>
        <Button variant="outline" size="lg" onClick={onDismiss}>
          OK
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Till actions that aren't part of an order yet (no sale needs approval). */
function TillTools() {
  const canNoSale = usePermission("drawer.no_sale");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button
          size="lg"
          variant="outline"
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
