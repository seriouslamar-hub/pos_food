"use client";

import { useEffect, useRef, useState } from "react";
import { CustomerMenu } from "@/components/order/customer-menu";
import { PaymentChoice } from "@/components/order/payment-choice";
import { Button } from "@/components/ui/button";
import { emptyCart, type Cart } from "@/lib/cart";
import { parseMenu, type MenuDoc } from "@/lib/menu";
import { formatAmount } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Placed = { id: string; order_number: string; total: number };

/**
 * The self-order kiosk: a welcome screen, the menu with photos, meal
 * offers, and checkout (the customer says how they'll pay at the counter). It
 * starts over after `idleSeconds` without a tap.
 */
export function KioskApp({
  branchId,
  idleSeconds,
}: {
  branchId: string;
  idleSeconds: number;
}) {
  const [supabase] = useState(createClient);
  const [menu, setMenu] = useState<MenuDoc | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [screen, setScreen] = useState<"welcome" | "menu" | "done">("welcome");
  const [cart, setCart] = useState<Cart>(() => emptyCart(crypto.randomUUID()));
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway">(
    "takeaway",
  );
  const [bigText, setBigText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [payBy, setPayBy] = useState<string | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    supabase
      .rpc("get_menu", { p_branch_id: branchId })
      .then(({ data, error: e }) => {
        if (e || !data)
          setMenuError("The menu couldn't load. Ask at the counter.");
        else setMenu(parseMenu(data));
      });
  }, [supabase, branchId]);

  function startOver() {
    setCart(emptyCart(crypto.randomUUID()));
    setPlaced(null);
    setPayBy(null);
    setError(null);
    setBusy(false);
    setScreen("welcome");
  }

  // Start over after a while without a tap (not on the welcome screen).
  useEffect(() => {
    if (screen === "welcome") return;
    const mark = () => {
      lastTap.current = Date.now();
    };
    mark();
    window.addEventListener("pointerdown", mark);
    const timer = window.setInterval(() => {
      if (Date.now() - lastTap.current > idleSeconds * 1000) startOver();
    }, 1000);
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.clearInterval(timer);
    };
  }, [screen, idleSeconds]);

  async function place() {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("submit_kiosk_order", {
      p_order: {
        id: cart.id,
        order_type: orderType,
        payment_preference: payBy,
        lines: cart.lines.map((l) => ({
          id: l.id,
          menu_item_id: l.menuItemId,
          quantity: l.quantity,
          modifier_ids: l.modifierIds,
          notes: l.notes || null,
          combo: l.combo.map((c, i) => ({
            id: `${l.id.slice(0, 24)}${String(i).padStart(12, "0")}`,
            slot_id: c.slotId,
            menu_item_id: c.menuItemId,
            modifier_ids: c.modifierIds,
          })),
        })),
      },
    });
    if (e || !data) {
      setBusy(false);
      setError(e?.message ?? "Something went wrong. Ask at the counter.");
      return;
    }
    const order = data as unknown as Placed;
    setPlaced(order);
    setBusy(false);
    setScreen("done");
  }

  if (menuError) {
    return (
      <main className="flex h-dvh items-center justify-center p-8 text-center text-2xl">
        {menuError}
      </main>
    );
  }

  if (screen === "welcome") {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-10 p-8 text-center">
        <h1 className="text-5xl font-bold">{menu?.branch_name ?? "Welcome"}</h1>
        <p className="text-2xl text-muted-foreground">
          Order here, then pay at the counter by cash, card or mobile money.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row">
          {(["takeaway", "dine_in"] as const).map((type) => (
            <Button
              key={type}
              className="h-24 min-w-64 text-3xl"
              disabled={!menu}
              onClick={() => {
                setOrderType(type);
                setScreen("menu");
              }}
            >
              {type === "takeaway" ? "Take away" : "Eat in"}
            </Button>
          ))}
        </div>
      </main>
    );
  }

  if (screen === "done" && placed) {
    return (
      <main
        className="flex h-dvh flex-col items-center justify-center gap-6 p-8 text-center"
        data-testid="kiosk-done"
      >
        <p className="text-3xl">Your order number</p>
        <p
          className="text-8xl font-bold tabular-nums"
          data-testid="kiosk-order-number"
        >
          {placed.order_number}
        </p>
        <p className="text-3xl">
          Please pay{" "}
          {menu ? formatAmount(placed.total, menu.currency_code) : ""} at the
          counter
          {payBy && menu
            ? ` by ${(menu.payment_methods.find((m) => m.type === payBy)?.name ?? payBy).toLowerCase()}`
            : ""}
          .
        </p>
        {error ? <p className="text-xl text-destructive">{error}</p> : null}
        <Button className="h-20 min-w-64 text-2xl" onClick={startOver}>
          Done
        </Button>
      </main>
    );
  }

  return (
    <main
      className={cn(
        "flex min-h-dvh flex-col gap-4 p-4",
        bigText && "text-xl [&_button]:text-xl",
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <Button variant="outline" className="h-14 text-lg" onClick={startOver}>
          Start over
        </Button>
        <span className="text-lg text-muted-foreground">
          {orderType === "takeaway" ? "Take away" : "Eat in"}
        </span>
        <Button
          variant="outline"
          className="h-14 text-lg"
          aria-pressed={bigText}
          onClick={() => setBigText((b) => !b)}
        >
          {bigText ? "Normal text" : "Larger text"}
        </Button>
      </header>
      {menu ? (
        <CustomerMenu
          menu={menu}
          cart={cart}
          onCart={setCart}
          large
          checkout={(totals) => (
            <div className="flex flex-col gap-3">
              <PaymentChoice
                methods={menu.payment_methods}
                value={payBy}
                onChange={setPayBy}
                large
              />
              {error ? <p className="text-destructive">{error}</p> : null}
              <Button
                className="h-20 text-2xl"
                disabled={
                  busy ||
                  cart.lines.length === 0 ||
                  totals.problems.length > 0 ||
                  !payBy
                }
                onClick={() => void place()}
              >
                {busy
                  ? "Sending…"
                  : payBy
                    ? "Send my order"
                    : "Choose how you'll pay"}
              </Button>
            </div>
          )}
        />
      ) : null}
    </main>
  );
}
