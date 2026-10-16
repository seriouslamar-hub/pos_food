"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CartCustomer } from "@/lib/cart";
import { formatInZone } from "@/lib/datetime";
import { formatAmount } from "@/lib/money";
import type { LoyaltySettings, MenuPromotion } from "@/lib/promotions";
import { createClient } from "@/lib/supabase/client";
import { isSessionEndedError, rpcErrorMessage } from "@/lib/till";
import { useTillSession } from "@/lib/till-session";
import { useFieldIds } from "@/lib/use-field-ids";

type CustomerView = {
  id: string;
  name: string | null;
  phone: string;
  points_balance: number;
  recent_orders: {
    id: string;
    order_number: string;
    business_date: string;
    total: number;
    created_at: string;
    branch_name: string;
    items: string;
  }[];
};

function toCartCustomer(c: CustomerView): CartCustomer {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    pointsBalance: c.points_balance,
  };
}

/**
 * Finds a loyalty customer by phone (or adds one, with their consent),
 * shows their points and recent orders, and how many points to spend.
 */
export function CustomerDialog({
  current,
  redeemPoints,
  loyalty,
  currency,
  timezone,
  maxRedeemValue,
  onDone,
  onClose,
}: {
  current: CartCustomer | null;
  redeemPoints: number;
  loyalty: LoyaltySettings | undefined;
  currency: string;
  timezone: string;
  /** What's left to pay, so points never cover more. */
  maxRedeemValue: number;
  onDone: (customer: CartCustomer | null, redeemPoints: number) => void;
  onClose: () => void;
}) {
  const fid = useFieldIds();
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const [phone, setPhone] = useState(current?.phone ?? "");
  const [found, setFound] = useState<CustomerView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [points, setPoints] = useState(
    redeemPoints ? String(redeemPoints) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newId] = useState(() => crypto.randomUUID());
  const money = (n: number) => formatAmount(n, currency);
  const value = loyalty?.point_value ?? 1;
  const usable = found
    ? Math.min(found.points_balance, Math.ceil(maxRedeemValue / value))
    : 0;

  function failed(rpcError: { code?: string; message: string }) {
    if (isSessionEndedError(rpcError)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    setError(rpcErrorMessage(rpcError));
  }

  async function find(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    setNotFound(false);
    setFound(null);
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("find_customer", {
      p_session_id: session.sessionId,
      p_phone: phone,
    });
    setBusy(false);
    if (rpcError) return failed(rpcError);
    if (data) setFound(data as unknown as CustomerView);
    else setNotFound(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!consent)
      return setError("Ask the customer first, and tick that they agree.");
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("save_customer", {
      p_session_id: session.sessionId,
      p_customer: { id: newId, phone, name: name.trim(), consent: true },
    });
    setBusy(false);
    if (rpcError) return failed(rpcError);
    setNotFound(false);
    setFound(data as unknown as CustomerView);
  }

  function use() {
    if (!found) return;
    const wanted = points.trim() === "" ? 0 : Number(points);
    if (!Number.isInteger(wanted) || wanted < 0)
      return setError("Enter whole points, like 50.");
    if (wanted > found.points_balance)
      return setError(
        `${found.name ?? "The customer"} has ${found.points_balance} points.`,
      );
    onDone(toCartCustomer(found), Math.min(wanted, usable));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[94dvh] w-[min(36rem,97vw)] max-w-none flex-col gap-4 overflow-y-auto p-5 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-xl">Loyalty customer</DialogTitle>
          <DialogDescription>
            Find them by phone number to earn or spend points.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={find} className="flex items-end gap-2">
          <label
            htmlFor={fid("phone")}
            className="flex flex-1 flex-col gap-1 text-sm font-medium"
          >
            Phone number
            <Input
              id={fid("phone")}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-12 text-lg"
              autoComplete="off"
            />
          </label>
          <Button type="submit" size="touch" disabled={busy || !phone.trim()}>
            Find
          </Button>
        </form>

        {notFound ? (
          <form
            onSubmit={save}
            className="flex flex-col gap-3 rounded-xl border p-3"
          >
            <p className="font-medium">No customer with that number yet.</p>
            <label
              htmlFor={fid("name")}
              className="flex flex-col gap-1 text-sm font-medium"
            >
              Name (optional)
              <Input
                id={fid("name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-12 text-base"
                autoComplete="off"
              />
            </label>
            <label className="flex min-h-12 items-center gap-3 text-base">
              <Checkbox
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked === true)}
              />
              The customer agrees to us keeping their phone number for rewards
            </label>
            <Button type="submit" size="touch" disabled={busy}>
              Add customer
            </Button>
          </form>
        ) : null}

        {found ? (
          <section
            className="flex flex-col gap-3 rounded-xl border p-3"
            aria-label="Customer"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-lg font-semibold">
                {found.name ?? found.phone}
              </span>
              <span className="tabular-nums" data-testid="customer-points">
                {found.points_balance} points
                {loyalty?.enabled
                  ? ` (${money(found.points_balance * value)})`
                  : ""}
              </span>
            </div>
            {found.recent_orders.length ? (
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {found.recent_orders.map((o) => (
                  <li key={o.id}>
                    {formatInZone(o.created_at, timezone, {
                      dateStyle: "medium",
                    })}{" "}
                    · {o.branch_name} · {money(o.total)} · {o.items}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            )}
            {loyalty?.enabled && found.points_balance > 0 ? (
              <label
                htmlFor={fid("points")}
                className="flex flex-col gap-1 text-sm font-medium"
              >
                Points to spend (up to {usable})
                <div className="flex gap-2">
                  <Input
                    id={fid("points")}
                    inputMode="numeric"
                    value={points}
                    onChange={(e) =>
                      setPoints(e.target.value.replace(/\D/g, ""))
                    }
                    className="h-12 text-lg"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="touch"
                    onClick={() => setPoints(String(usable))}
                  >
                    All
                  </Button>
                </div>
              </label>
            ) : null}
            <Button size="touch" onClick={use}>
              Use this customer
            </Button>
          </section>
        ) : null}

        {error ? (
          <Alert variant="destructive" aria-live="polite">
            <AlertDescription className="text-base">{error}</AlertDescription>
          </Alert>
        ) : null}
        {current ? (
          <Button variant="ghost" size="touch" onClick={() => onDone(null, 0)}>
            Remove {current.name ?? current.phone} from this order
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Checks a coupon code on the server and adds its promotion to the cart. */
export function CouponDialog({
  current,
  onDone,
  onClose,
}: {
  current: string | null;
  onDone: (coupon: { code: string; promotion: MenuPromotion } | null) => void;
  onClose: () => void;
}) {
  const fid = useFieldIds();
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const [code, setCode] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const clean = code.trim().toUpperCase();
    if (!clean) return setError("Enter the coupon code.");
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("check_coupon", {
      p_session_id: session.sessionId,
      p_code: clean,
    });
    setBusy(false);
    if (isSessionEndedError(rpcError)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    if (rpcError) return setError(rpcErrorMessage(rpcError));
    onDone({ code: clean, promotion: data as unknown as MenuPromotion });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="w-[min(28rem,97vw)] max-w-none p-5 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-xl">Coupon</DialogTitle>
          <DialogDescription>
            The order&apos;s items and spend are checked again when you charge.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={check} className="flex flex-col gap-3">
          <label
            htmlFor={fid("code")}
            className="flex flex-col gap-1 text-sm font-medium"
          >
            Code
            <Input
              id={fid("code")}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="h-12 text-lg uppercase"
              autoComplete="off"
              autoCapitalize="characters"
            />
          </label>
          {error ? (
            <Alert variant="destructive" aria-live="polite">
              <AlertDescription className="text-base">{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" size="touch" disabled={busy}>
            {busy ? "Checking…" : "Apply coupon"}
          </Button>
          {current ? (
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={() => onDone(null)}
            >
              Remove coupon {current}
            </Button>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
