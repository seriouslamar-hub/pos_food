"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { countTotal, type CashCount } from "@/lib/cash";
import { formatAmount } from "@/lib/money";

const MAX_COUNT = 99999;

/**
 * Counting a drawer note by note and coin by coin: tap + and −, or type the
 * number of each.
 */
export function CashCountForm({
  denominations,
  currency,
  value,
  onChange,
  disabled,
}: {
  denominations: number[];
  currency: string;
  value: CashCount;
  onChange: (next: CashCount) => void;
  disabled?: boolean;
}) {
  const money = (amount: number) => formatAmount(amount, currency);
  const set = (denomination: number, count: number) =>
    onChange({
      ...value,
      [denomination]: Math.min(Math.max(count, 0), MAX_COUNT),
    });

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid gap-2 lg:grid-cols-2">
        {denominations.map((d) => {
          const n = value[d] ?? 0;
          return (
            <li
              key={d}
              className="flex items-center gap-2 rounded-xl border p-2"
              data-testid="cash-count-row"
            >
              <span className="w-24 text-lg font-semibold tabular-nums">
                {money(d)}
              </span>
              <Button
                variant="outline"
                size="icon-lg"
                className="size-12"
                aria-label={`One less ${money(d)}`}
                disabled={disabled || n === 0}
                onClick={() => set(d, n - 1)}
              >
                <MinusIcon />
              </Button>
              <Input
                aria-label={`Number of ${money(d)}`}
                inputMode="numeric"
                value={n ? String(n) : ""}
                placeholder="0"
                disabled={disabled}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "");
                  set(d, digits ? Number(digits) : 0);
                }}
                className="h-12 w-20 text-center text-lg"
              />
              <Button
                variant="outline"
                size="icon-lg"
                className="size-12"
                aria-label={`One more ${money(d)}`}
                disabled={disabled}
                onClick={() => set(d, n + 1)}
              >
                <PlusIcon />
              </Button>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {money(n * d)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-2xl font-bold">
        Total{" "}
        <span className="tabular-nums" data-testid="cash-count-total">
          {money(countTotal(value))}
        </span>
      </p>
    </div>
  );
}
