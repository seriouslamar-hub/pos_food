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
import { Input } from "@/components/ui/input";
import type { CartLine, Discount, PriceChange } from "@/lib/cart";
import type { MenuItem } from "@/lib/menu";
import { formatAmount, parseMoney, toMoneyInput } from "@/lib/money";
import { bpsToPercentInput, parsePercentToBps } from "@/lib/percent";
import { useFieldIds } from "@/lib/use-field-ids";
import { cn } from "@/lib/utils";

const DISCOUNT_REASONS = [
  "Staff meal",
  "Customer complaint",
  "Loyalty",
  "Promotion",
];
const PRICE_REASONS = ["Damaged item", "Manager special", "Price match"];

function ReasonField({
  id,
  value,
  onChange,
  suggestions,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        Reason
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 text-base"
        maxLength={120}
        autoComplete="off"
      />
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <Button
            key={s}
            type="button"
            variant="secondary"
            className="h-11 px-3"
            onClick={() => onChange(s)}
          >
            {s}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * A discount: percent or a fixed amount, with a reason. `max` is the amount
 * it comes off (a fixed discount can't be more).
 */
function DiscountForm({
  initial,
  currency,
  max,
  onApply,
  onRemove,
}: {
  initial: Discount | null | undefined;
  currency: string;
  max: number;
  onApply: (discount: Discount) => void;
  onRemove?: () => void;
}) {
  const fid = useFieldIds();
  const [type, setType] = useState<Discount["type"]>(
    initial?.type ?? "percent",
  );
  const [value, setValue] = useState(
    initial
      ? initial.type === "percent"
        ? bpsToPercentInput(initial.value)
        : toMoneyInput(initial.value, currency)
      : "",
  );
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [error, setError] = useState<string | null>(null);

  function apply(event: React.FormEvent) {
    event.preventDefault();
    let parsed: number;
    try {
      parsed =
        type === "percent"
          ? parsePercentToBps(value)
          : parseMoney(value, currency);
    } catch {
      setError(
        type === "percent"
          ? "Enter a percentage, like 10 or 12.5."
          : "Enter an amount, like 2 or 1.50.",
      );
      return;
    }
    if (parsed <= 0) {
      setError("A discount must be more than zero.");
      return;
    }
    if (type === "percent" && parsed > 10000) {
      setError("A discount can't be more than 100%.");
      return;
    }
    if (type === "fixed" && parsed > max) {
      setError(
        `The discount can't be more than ${formatAmount(max, currency)}.`,
      );
      return;
    }
    if (!reason.trim()) {
      setError("Give a reason for the discount.");
      return;
    }
    onApply({ type, value: parsed, reason: reason.trim() });
  }

  return (
    <form onSubmit={apply} className="flex flex-col gap-3" noValidate>
      <div role="radiogroup" aria-label="Discount type" className="flex gap-2">
        {(
          [
            ["percent", "Percent"],
            ["fixed", "Amount"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            onClick={() => setType(t)}
            className={cn(
              "min-h-12 flex-1 rounded-xl text-base font-medium",
              type === t ? "bg-foreground text-background" : "bg-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <label htmlFor={fid("value")} className="text-sm font-medium">
        {type === "percent" ? "Percent off" : `Amount off (${currency})`}
      </label>
      <Input
        id={fid("value")}
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-12 text-lg"
        autoComplete="off"
      />
      <ReasonField
        id={fid("reason")}
        value={reason}
        onChange={setReason}
        suggestions={DISCOUNT_REASONS}
      />
      {error ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription className="text-base">{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {onRemove ? (
          <Button
            type="button"
            variant="outline"
            size="touch"
            onClick={onRemove}
          >
            Remove discount
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" size="touch">
          Apply discount
        </Button>
      </div>
    </form>
  );
}

/** Discount and price for one cart line. */
export function LineOptionsDialog({
  line,
  item,
  menuUnitPrice,
  currency,
  canDiscount,
  onClose,
  onChange,
}: {
  line: CartLine;
  item: MenuItem;
  /** The price of one with its choices, from the menu. */
  menuUnitPrice: number;
  currency: string;
  canDiscount: boolean;
  onClose: () => void;
  onChange: (patch: Pick<CartLine, "discount" | "price">) => void;
}) {
  const fid = useFieldIds();
  const money = (amount: number) => formatAmount(amount, currency);
  const [price, setPrice] = useState(
    line.price ? toMoneyInput(line.price.unitPrice, currency) : "",
  );
  const [reason, setReason] = useState(line.price?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const unit = line.price?.unitPrice ?? menuUnitPrice;

  function changePrice(event: React.FormEvent) {
    event.preventDefault();
    let parsed: number;
    try {
      parsed = parseMoney(price, currency);
    } catch {
      setError("Enter a price, like 8 or 7.50.");
      return;
    }
    if (parsed < 0) {
      setError("A price can't be below zero.");
      return;
    }
    if (!reason.trim()) {
      setError("Give a reason for changing the price.");
      return;
    }
    const next: PriceChange = { unitPrice: parsed, reason: reason.trim() };
    onChange({ discount: line.discount, price: next });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[94dvh] w-[min(40rem,97vw)] max-w-none overflow-y-auto p-5 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {line.quantity} × {item.name}
          </DialogTitle>
          <DialogDescription>
            {money(unit)} each
            {line.price ? ` (menu price ${money(menuUnitPrice)})` : ""}.
          </DialogDescription>
        </DialogHeader>

        <section aria-label="Discount" className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">Discount</h3>
          {canDiscount ? (
            <DiscountForm
              initial={line.discount}
              currency={currency}
              max={unit * line.quantity}
              onApply={(discount) => onChange({ discount, price: line.price })}
              onRemove={
                line.discount
                  ? () => onChange({ discount: null, price: line.price })
                  : undefined
              }
            />
          ) : (
            <p className="text-muted-foreground">
              You can&apos;t give discounts. Ask a manager.
            </p>
          )}
        </section>

        <section
          aria-label="Price"
          className="mt-2 flex flex-col gap-3 border-t pt-4"
        >
          <h3 className="text-lg font-semibold">Price for one</h3>
          <form
            onSubmit={changePrice}
            className="flex flex-col gap-3"
            noValidate
          >
            <label htmlFor={fid("price")} className="text-sm font-medium">
              New price ({currency})
            </label>
            <Input
              id={fid("price")}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={toMoneyInput(menuUnitPrice, currency)}
              className="h-12 text-lg"
              autoComplete="off"
            />
            <ReasonField
              id={fid("price-reason")}
              value={reason}
              onChange={setReason}
              suggestions={PRICE_REASONS}
            />
            {error ? (
              <Alert variant="destructive" aria-live="polite">
                <AlertDescription className="text-base">
                  {error}
                </AlertDescription>
              </Alert>
            ) : null}
            <p className="text-sm text-muted-foreground">
              Without the right to change prices, a manager approves it when you
              charge.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {line.price ? (
                <Button
                  type="button"
                  variant="outline"
                  size="touch"
                  onClick={() =>
                    onChange({ discount: line.discount, price: null })
                  }
                >
                  Use the menu price
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" size="touch">
                Change price
              </Button>
            </div>
          </form>
        </section>
      </DialogContent>
    </Dialog>
  );
}

/** A discount on the whole order. */
export function OrderDiscountDialog({
  discount,
  currency,
  max,
  onClose,
  onChange,
}: {
  discount: Discount | null | undefined;
  currency: string;
  /** What's left on the order after line discounts. */
  max: number;
  onClose: () => void;
  onChange: (discount: Discount | null) => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(36rem,97vw)] max-w-none p-5 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-xl">Discount the order</DialogTitle>
          <DialogDescription>
            Shared across every line. Above your discount limit, a manager
            approves it when you charge.
          </DialogDescription>
        </DialogHeader>
        <DiscountForm
          initial={discount}
          currency={currency}
          max={max}
          onApply={onChange}
          onRemove={discount ? () => onChange(null) : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}
