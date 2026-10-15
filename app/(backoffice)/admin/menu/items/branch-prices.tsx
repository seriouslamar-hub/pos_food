"use client";

import { useState, useTransition } from "react";
import { FormError } from "@/components/admin/form";
import { MoneyInput } from "@/components/admin/money-input";
import { Button } from "@/components/ui/button";
import { setBranchPrice } from "@/lib/actions/menu";
import { formatAmount, toMoneyInput } from "@/lib/money";

export type BranchPriceRow = {
  branchId: string;
  branchName: string;
  currency: string;
  priceOverride: number | null;
  isAvailable: boolean;
};

/** A different price per branch; empty means the menu price. */
export function BranchPrices({
  itemId,
  basePrice,
  rows,
}: {
  itemId: string;
  basePrice: number;
  rows: BranchPriceRow[];
}) {
  if (!rows.length)
    return <p className="text-sm text-muted-foreground">No branches yet.</p>;
  return (
    <table className="w-full max-w-2xl text-sm">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-2 font-normal">Branch</th>
          <th className="py-2 font-normal">Price there</th>
          <th className="py-2 font-normal">Override</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <BranchPriceEditor
            key={row.branchId}
            itemId={itemId}
            basePrice={basePrice}
            row={row}
          />
        ))}
      </tbody>
    </table>
  );
}

function BranchPriceEditor({
  itemId,
  basePrice,
  row,
}: {
  itemId: string;
  basePrice: number;
  row: BranchPriceRow;
}) {
  const [value, setValue] = useState(
    row.priceOverride === null
      ? ""
      : toMoneyInput(row.priceOverride, row.currency),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const effective = row.priceOverride ?? basePrice;

  function save(next: string) {
    setError(null);
    startTransition(async () => {
      const result = await setBranchPrice(row.branchId, itemId, next);
      if (!result.ok) setError(result.error);
      else setValue(next);
    });
  }

  return (
    <tr className="border-t align-top">
      <td className="py-2 pr-3">
        {row.branchName}
        {!row.isAvailable ? (
          <div className="text-xs text-muted-foreground">
            Out of stock there
          </div>
        ) : null}
      </td>
      <td
        className="py-2 pr-3 tabular-nums"
        data-testid={`effective-price-${row.branchName}`}
      >
        {formatAmount(effective, row.currency)}
        {row.priceOverride === null ? (
          <div className="text-xs text-muted-foreground">Menu price</div>
        ) : null}
      </td>
      <td className="py-2">
        <div className="flex flex-wrap items-center gap-2">
          <MoneyInput
            aria-label={`Price at ${row.branchName}`}
            currency={row.currency}
            value={value}
            placeholder="Menu price"
            onChange={(e) => setValue(e.target.value)}
            className="w-36"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => save(value)}
          >
            Save
          </Button>
          {row.priceOverride !== null ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => save("")}
            >
              Use menu price
            </Button>
          ) : null}
        </div>
        <FormError message={error} />
      </td>
    </tr>
  );
}
