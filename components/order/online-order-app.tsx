"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CustomerMenu } from "@/components/order/customer-menu";
import { PaymentChoice } from "@/components/order/payment-choice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emptyCart, type Cart } from "@/lib/cart";
import { formatInZone } from "@/lib/datetime";
import type { MenuDoc } from "@/lib/menu";
import { createClient } from "@/lib/supabase/client";
import { pickupSlots } from "@/lib/upsell";
import { useFieldIds } from "@/lib/use-field-ids";

type Online = {
  paused: boolean;
  day_open: boolean;
  prep_minutes: number;
  pay_at_counter: boolean;
};

/** "0244 123 456" or "+233 24 412 3456" → E.164 (Ghana numbers by default). */
export function toE164(input: string, defaultCountry = "233"): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `+${defaultCountry}${digits.slice(1)}`;
  if (/^\d{10,15}$/.test(digits)) return `+${digits}`;
  return null;
}

/**
 * Online ordering for one branch: menu and order, a pickup time, phone
 * verification (a text message code), then pay online or at the counter.
 */
export function OnlineOrderApp({
  menu,
  online,
  payOnline,
}: {
  menu: MenuDoc;
  online: Online;
  payOnline: boolean;
}) {
  const fid = useFieldIds();
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [cart, setCart] = useState<Cart>(() => emptyCart(crypto.randomUUID()));
  const [slots, setSlots] = useState<Date[]>([]);
  const [pickup, setPickup] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const [payBy, setPayBy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accepting = online.day_open && !online.paused;

  useEffect(() => {
    const update = () => {
      const next = pickupSlots(new Date(), online.prep_minutes);
      setSlots(next);
      setPickup((p) =>
        next.some((s) => s.toISOString() === p) ? p : next[0].toISOString(),
      );
    };
    update();
    const timer = window.setInterval(update, 60_000);
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.phone)
        setVerifiedPhone(`+${data.user.phone.replace(/^\+/, "")}`);
    });
    return () => window.clearInterval(timer);
  }, [online.prep_minutes, supabase]);

  async function sendCode() {
    setError(null);
    const e164 = toE164(phone);
    if (!e164) return setError("Enter your mobile number, like 024 412 3456.");
    setBusy(true);
    const prepared = await fetch("/api/online/phone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: e164 }),
    });
    if (!prepared.ok) {
      setBusy(false);
      const body = (await prepared.json().catch(() => ({}))) as {
        error?: string;
      };
      return setError(body.error ?? "We couldn't send a code. Try again.");
    }
    const { error: e } = await supabase.auth.signInWithOtp({
      phone: e164,
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (e) return setError(e.message);
    setCodeSent(true);
  }

  async function verify() {
    setError(null);
    const e164 = toE164(phone);
    if (!e164) return;
    setBusy(true);
    const { error: e } = await supabase.auth.verifyOtp({
      phone: e164,
      token: code.trim(),
      type: "sms",
    });
    setBusy(false);
    if (e)
      return setError("That code didn't work. Check it, or send a new one.");
    setVerifiedPhone(e164);
  }

  async function place(payAtCounter: boolean) {
    setError(null);
    setBusy(true);
    const { data, error: e } = await supabase.rpc("place_online_order", {
      p_branch_id: menu.branch_id,
      p_order: {
        id: cart.id,
        pickup_at: pickup,
        pay_at_counter: payAtCounter,
        payment_preference: payAtCounter ? payBy : null,
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
      return setError(e?.message ?? "Your order didn't go through. Try again.");
    }
    const orderId = (data as unknown as { id: string }).id;
    if (!payAtCounter) {
      const res = await fetch("/api/payments/online/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (res.ok && body.url) {
        window.location.assign(body.url);
        return;
      }
      setBusy(false);
      return setError(body.error ?? "Payment couldn't start. Try again.");
    }
    router.push(`/order/track/${orderId}`);
  }

  return (
    <main className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-3xl font-bold">{menu.branch_name}</h1>
        <Link href="/order" className="text-sm underline">
          Another branch
        </Link>
      </header>
      {!accepting ? (
        <Alert>
          <AlertDescription>
            {online.paused
              ? "We've paused online orders for a moment. Please try again soon."
              : "We're not taking orders right now."}
          </AlertDescription>
        </Alert>
      ) : null}
      <CustomerMenu
        menu={menu}
        cart={cart}
        onCart={setCart}
        checkout={(totals) => (
          <div
            className="flex flex-col gap-3 border-t pt-3"
            aria-label="Checkout"
          >
            <label
              htmlFor={fid("pickup")}
              className="flex flex-col gap-1 text-sm font-medium"
            >
              Pickup time
              <select
                id={fid("pickup")}
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
                className="h-12 rounded-lg border bg-background px-3 text-base"
              >
                {slots.map((s) => (
                  <option key={s.toISOString()} value={s.toISOString()}>
                    {formatInZone(s.toISOString(), menu.timezone, {
                      timeStyle: "short",
                    })}
                  </option>
                ))}
              </select>
            </label>
            {verifiedPhone ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="verified-phone"
              >
                Ordering as {verifiedPhone}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor={fid("phone")}
                  className="flex flex-col gap-1 text-sm font-medium"
                >
                  Your mobile number (we&apos;ll text you a code)
                  <Input
                    id={fid("phone")}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-12 text-base"
                  />
                </label>
                {codeSent ? (
                  <div className="flex gap-2">
                    <Input
                      aria-label="Code from the text message"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="h-12 text-base"
                    />
                    <Button
                      size="lg"
                      className="h-12"
                      disabled={busy || code.trim().length < 4}
                      onClick={() => void verify()}
                    >
                      Verify
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="lg"
                    variant="outline"
                    disabled={busy || !phone.trim()}
                    onClick={() => void sendCode()}
                  >
                    Send me a code
                  </Button>
                )}
              </div>
            )}
            {error ? (
              <Alert variant="destructive" aria-live="polite">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {payOnline ? (
              <Button
                size="lg"
                className="h-14 text-lg"
                disabled={
                  busy ||
                  !accepting ||
                  !verifiedPhone ||
                  cart.lines.length === 0 ||
                  totals.problems.length > 0
                }
                onClick={() => void place(false)}
              >
                {busy ? "Please wait…" : "Pay now"}
              </Button>
            ) : null}
            {online.pay_at_counter ? (
              <PaymentChoice
                methods={menu.payment_methods}
                value={payBy}
                onChange={setPayBy}
              />
            ) : null}
            {online.pay_at_counter ? (
              <Button
                size="lg"
                variant={payOnline ? "outline" : "default"}
                className="h-14 text-lg"
                disabled={
                  busy ||
                  !accepting ||
                  !verifiedPhone ||
                  cart.lines.length === 0 ||
                  totals.problems.length > 0 ||
                  !payBy
                }
                onClick={() => void place(true)}
              >
                Place order, pay when I collect
              </Button>
            ) : null}
            {!payOnline && !online.pay_at_counter ? (
              <p className="text-sm text-muted-foreground">
                This branch isn&apos;t taking online orders paid at the counter.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Your order goes to the kitchen once it&apos;s paid. We use your
              number only for this order.
            </p>
          </div>
        )}
      />
    </main>
  );
}
