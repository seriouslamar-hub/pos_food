"use client";

import { DeleteIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { quickCashAmounts } from "@/lib/cash";
import type { MenuPaymentMethod } from "@/lib/menu";
import { formatAmount } from "@/lib/money";
import { providerFor } from "@/lib/payments/provider";
import {
  amountDue,
  amountPaid,
  changeDue,
  tender,
  type PendingPayment,
} from "@/lib/payments/tender";
import { cn } from "@/lib/utils";

const MAX_DIGITS = 9;

/**
 * Taking payment for one order: cash with quick amounts and change, card
 * and mobile money with a reference, or a mix (split) until nothing is left
 * to pay. The sale completes on its own once the payments cover the total.
 */
export function PaymentScreen({
  title,
  total,
  currency,
  methods,
  notice,
  busy,
  error,
  newId,
  onBack,
  onComplete,
}: {
  title: string;
  total: number;
  currency: string;
  methods: MenuPaymentMethod[];
  notice?: string | null;
  busy: boolean;
  error: string | null;
  newId: () => string;
  onBack: () => void;
  onComplete: (payments: PendingPayment[]) => void;
}) {
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [methodId, setMethodId] = useState(
    () => (methods.find((m) => m.type === "cash") ?? methods[0])?.id ?? "",
  );
  const [digits, setDigits] = useState("");
  const [reference, setReference] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // Blocks a second tap while a payment is being added, and after the one
  // that completes the sale until the result is back (busy goes false only
  // if completing failed).
  const taking = useRef(false);
  useEffect(() => {
    if (!busy) taking.current = false;
  }, [busy]);

  const method = methods.find((m) => m.id === methodId) ?? null;
  const due = amountDue(total, payments);
  const change = changeDue(payments);
  const entered = Number(digits || "0");
  const money = (amount: number) => formatAmount(amount, currency);
  const locked = busy || due <= 0;

  const press = useCallback(
    (key: string) =>
      setDigits((d) => (d + key).replace(/^0+/, "").slice(0, MAX_DIGITS)),
    [],
  );
  const backspace = useCallback(() => setDigits((d) => d.slice(0, -1)), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]"))
        return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        backspace();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, backspace]);

  async function take(chosen: MenuPaymentMethod, amount: number) {
    if (taking.current) return;
    taking.current = true;
    setProblem(null);
    const result = tender({
      id: newId(),
      method: chosen,
      due,
      entered: amount,
      reference,
      currency,
    });
    if (!result.ok) {
      setProblem(result.error);
      taking.current = false;
      return;
    }
    const captured = await providerFor(chosen).capture({
      method: chosen,
      amount: result.payment.amount,
      currency,
      reference: result.payment.reference,
    });
    if (!captured.ok) {
      setProblem(captured.error);
      taking.current = false;
      return;
    }
    const next = [
      ...payments,
      { ...result.payment, reference: captured.reference },
    ];
    setPayments(next);
    setDigits("");
    setReference("");
    if (amountDue(total, next) <= 0) onComplete(next);
    else taking.current = false;
  }

  const nonCashAmount = digits ? entered : due;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onBack()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[94dvh] w-[min(64rem,97vw)] max-w-none flex-col gap-4 overflow-y-auto p-5 sm:max-w-none"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3">
          <div>
            <DialogTitle className="text-2xl">Take payment</DialogTitle>
            <DialogDescription className="text-base">
              {title} · Total{" "}
              <strong data-testid="payment-total">{money(total)}</strong>
            </DialogDescription>
          </div>
          <Button
            variant="outline"
            size="touch"
            disabled={busy}
            onClick={onBack}
          >
            Back
          </Button>
        </DialogHeader>

        {notice ? (
          <Alert aria-live="polite">
            <AlertDescription
              className="text-base"
              data-testid="payment-notice"
            >
              {notice}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid min-h-0 gap-5 md:grid-cols-[1fr_20rem]">
          <section aria-label="Payment" className="flex flex-col gap-3">
            <div
              role="radiogroup"
              aria-label="Payment method"
              className="grid auto-cols-fr grid-flow-col gap-2"
            >
              {methods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={m.id === methodId}
                  disabled={locked}
                  onClick={() => {
                    setMethodId(m.id);
                    setProblem(null);
                  }}
                  className={cn(
                    "min-h-14 rounded-xl px-3 text-lg font-medium disabled:opacity-50",
                    m.id === methodId
                      ? "bg-foreground text-background"
                      : "bg-muted",
                  )}
                >
                  {m.name}
                </button>
              ))}
            </div>

            {method ? (
              <>
                <div className="flex items-center justify-between rounded-xl border px-4 py-2">
                  <span className="text-muted-foreground">
                    {method.type === "cash"
                      ? "Cash received"
                      : `Amount (blank = ${money(Math.max(due, 0))})`}
                  </span>
                  <output
                    aria-label="Amount entered"
                    data-testid="payment-entered"
                    className="text-3xl font-semibold tabular-nums"
                  >
                    {money(
                      digits
                        ? entered
                        : method.type === "cash"
                          ? 0
                          : Math.max(due, 0),
                    )}
                  </output>
                </div>

                {method.type === "cash" ? (
                  <div className="grid grid-cols-4 gap-2">
                    {quickCashAmounts(due, currency).map((amount, i) => (
                      <Button
                        key={amount}
                        size="touch"
                        variant="secondary"
                        disabled={locked}
                        className="h-16 flex-col gap-0 px-2 text-lg"
                        aria-label={
                          i === 0 ? `Exact ${money(amount)}` : money(amount)
                        }
                        onClick={() => void take(method, amount)}
                      >
                        {i === 0 ? (
                          <span className="text-xs font-normal">Exact</span>
                        ) : null}
                        {money(amount)}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Input
                    aria-label="Reference"
                    placeholder={
                      method.requires_reference
                        ? "Reference from the terminal or phone (required)"
                        : "Reference (optional)"
                    }
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="h-14 text-lg"
                    maxLength={80}
                    disabled={locked}
                  />
                )}

                <div className="grid grid-cols-3 gap-2">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map(
                    (key) => (
                      <Button
                        key={key}
                        variant="outline"
                        size="touch"
                        className="h-14 text-2xl"
                        disabled={locked}
                        onClick={() => press(key)}
                      >
                        {key}
                      </Button>
                    ),
                  )}
                  <Button
                    variant="outline"
                    size="touch"
                    className="h-14"
                    aria-label="Delete last digit"
                    disabled={locked}
                    onClick={backspace}
                  >
                    <DeleteIcon className="size-7" />
                  </Button>
                </div>

                {method.type === "cash" ? (
                  <Button
                    size="touch"
                    className="h-16 text-xl"
                    disabled={locked || !digits}
                    onClick={() => void take(method, entered)}
                  >
                    {digits
                      ? `Take ${money(entered)} cash`
                      : "Type the cash received"}
                  </Button>
                ) : (
                  <Button
                    size="touch"
                    className="h-16 text-xl"
                    disabled={locked || nonCashAmount <= 0}
                    onClick={() => void take(method, nonCashAmount)}
                  >
                    Pay {money(Math.max(nonCashAmount, 0))} by {method.name}
                  </Button>
                )}
              </>
            ) : (
              <Alert variant="destructive">
                <AlertDescription className="text-base">
                  No payment methods are switched on. Ask an admin to turn one
                  on under Payment methods.
                </AlertDescription>
              </Alert>
            )}
          </section>

          <section
            aria-label="Payments so far"
            className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4"
          >
            <ul className="flex flex-col gap-2">
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2"
                  data-testid="payment-line"
                >
                  <span className="min-w-0">
                    <span className="block text-base font-medium">
                      {p.method.name} {money(p.amount)}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {p.tendered !== null && p.tendered !== p.amount
                        ? `${money(p.tendered)} handed over`
                        : p.reference
                          ? `Ref ${p.reference}`
                          : ""}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="size-12"
                    aria-label={`Remove ${p.method.name} payment of ${money(p.amount)}`}
                    disabled={busy}
                    onClick={() =>
                      setPayments((list) => list.filter((x) => x.id !== p.id))
                    }
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
            <dl className="mt-auto flex flex-col gap-1 text-base">
              <div className="flex justify-between">
                <dt>Paid</dt>
                <dd className="tabular-nums">{money(amountPaid(payments))}</dd>
              </div>
              <div className="flex justify-between text-2xl font-bold">
                <dt>Left to pay</dt>
                <dd className="tabular-nums" data-testid="payment-due">
                  {money(Math.max(due, 0))}
                </dd>
              </div>
              {change ? (
                <div className="flex justify-between text-xl font-semibold">
                  <dt>Change</dt>
                  <dd className="tabular-nums" data-testid="payment-change">
                    {money(change)}
                  </dd>
                </div>
              ) : null}
            </dl>
            {problem || error ? (
              <Alert variant="destructive" aria-live="polite">
                <AlertDescription
                  className="text-base"
                  data-testid="payment-error"
                >
                  {problem ?? error}
                </AlertDescription>
              </Alert>
            ) : null}
            {due < 0 ? (
              <p className="text-base text-destructive">
                The payments are more than the total. Remove one.
              </p>
            ) : null}
            {due === 0 ? (
              <Button
                size="touch"
                className="h-16 text-xl"
                disabled={busy}
                onClick={() => onComplete(payments)}
              >
                {busy
                  ? "Saving…"
                  : total === 0
                    ? "Complete (nothing to pay)"
                    : "Complete sale"}
              </Button>
            ) : null}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
