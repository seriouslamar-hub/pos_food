"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError, Select } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  receivePurchaseOrder,
  recordWaste,
  reviewStockCount,
  savePurchaseOrder,
  setPurchaseOrderStatus,
  submitStockCount,
  suggestPurchase,
  transferStock,
} from "@/lib/actions/inventory";
import { formatQuantity, WASTE_REASONS, type StockUnit } from "@/lib/inventory";
import { formatAmount, toMoneyInput } from "@/lib/money";
import { useFieldIds } from "@/lib/use-field-ids";

export type StockIngredient = {
  id: string;
  name: string;
  unit: StockUnit;
  category: string | null;
  cost_per_unit: number;
  supplier_id: string | null;
  on_hand: number;
};

type Line = {
  ingredientId: string;
  quantity: string;
  reason?: string;
  unitCost?: string;
};

function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    onDone?: () => void,
  ) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else onDone?.();
    });
  }
  return { pending, error, run };
}

/** Rows of ingredient + quantity (+ reason or cost). */
function LineEditor({
  ingredients,
  lines,
  onChange,
  withReason,
  withCost,
  currency,
}: {
  ingredients: StockIngredient[];
  lines: Line[];
  onChange: (lines: Line[]) => void;
  withReason?: boolean;
  withCost?: boolean;
  currency?: string;
}) {
  const fid = useFieldIds();
  const set = (i: number, patch: Partial<Line>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, i) => {
        const ing = ingredients.find((x) => x.id === line.ingredientId);
        return (
          <div
            key={i}
            className="flex flex-wrap items-end gap-2"
            data-testid="stock-line"
          >
            <label
              htmlFor={fid(`i${i}`)}
              className="flex min-w-48 flex-1 flex-col gap-1 text-sm"
            >
              Ingredient
              <Select
                id={fid(`i${i}`)}
                value={line.ingredientId}
                onChange={(e) => {
                  const next = ingredients.find((x) => x.id === e.target.value);
                  set(i, {
                    ingredientId: e.target.value,
                    ...(withCost && next && currency
                      ? { unitCost: toMoneyInput(next.cost_per_unit, currency) }
                      : {}),
                  });
                }}
              >
                <option value="">Choose…</option>
                {ingredients.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </label>
            <label
              htmlFor={fid(`q${i}`)}
              className="flex w-28 flex-col gap-1 text-sm"
            >
              Quantity{ing ? ` (${ing.unit})` : ""}
              <Input
                id={fid(`q${i}`)}
                inputMode="decimal"
                value={line.quantity}
                onChange={(e) => set(i, { quantity: e.target.value })}
              />
            </label>
            {withCost ? (
              <label
                htmlFor={fid(`c${i}`)}
                className="flex w-28 flex-col gap-1 text-sm"
              >
                Cost each
                <Input
                  id={fid(`c${i}`)}
                  inputMode="decimal"
                  value={line.unitCost ?? ""}
                  onChange={(e) => set(i, { unitCost: e.target.value })}
                />
              </label>
            ) : null}
            {withReason ? (
              <label
                htmlFor={fid(`r${i}`)}
                className="flex w-36 flex-col gap-1 text-sm"
              >
                Reason
                <Select
                  id={fid(`r${i}`)}
                  value={line.reason ?? ""}
                  onChange={(e) => set(i, { reason: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {WASTE_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange(lines.filter((_, j) => j !== i))}
              aria-label={`Remove line ${i + 1}`}
            >
              Remove
            </Button>
          </div>
        );
      })}
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onChange([...lines, { ingredientId: "", quantity: "" }])
          }
        >
          Add a line
        </Button>
      </div>
    </div>
  );
}

/** Waste and transfer buttons on the stock page. */
export function StockActions({
  branchId,
  ingredients,
  otherBranches,
}: {
  branchId: string;
  ingredients: StockIngredient[];
  otherBranches: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState<"waste" | "transfer" | null>(null);
  return (
    <>
      <Button size="lg" variant="outline" onClick={() => setOpen("waste")}>
        Record waste
      </Button>
      <Button
        size="lg"
        variant="outline"
        onClick={() => setOpen("transfer")}
        disabled={otherBranches.length === 0}
      >
        Transfer stock
      </Button>
      {open ? (
        <StockMovementDialog
          kind={open}
          branchId={branchId}
          ingredients={ingredients}
          otherBranches={otherBranches}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

function StockMovementDialog({
  kind,
  branchId,
  ingredients,
  otherBranches,
  onClose,
}: {
  kind: "waste" | "transfer";
  branchId: string;
  ingredients: StockIngredient[];
  otherBranches: { id: string; name: string }[];
  onClose: () => void;
}) {
  const fid = useFieldIds();
  const { pending, error, run } = useRun();
  const [id] = useState(() => crypto.randomUUID());
  const [lines, setLines] = useState<Line[]>([
    { ingredientId: "", quantity: "" },
  ]);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="w-[min(46rem,97vw)] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            {kind === "waste" ? "Record waste" : "Transfer stock"}
          </DialogTitle>
          <DialogDescription>
            {kind === "waste"
              ? "Stock thrown away, with why."
              : "Stock sent to another branch. It moves straight away."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                kind === "waste"
                  ? recordWaste(branchId, id, lines)
                  : transferStock(branchId, id, to, note, lines),
              onClose,
            );
          }}
        >
          <FormError message={error} />
          {kind === "transfer" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label
                htmlFor={fid("to")}
                className="flex flex-col gap-1 text-sm"
              >
                Send to
                <Select
                  id={fid("to")}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                >
                  <option value="">Choose a branch…</option>
                  {otherBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label
                htmlFor={fid("note")}
                className="flex flex-col gap-1 text-sm"
              >
                Note
                <Input
                  id={fid("note")}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </div>
          ) : null}
          <LineEditor
            ingredients={ingredients}
            lines={lines}
            onChange={setLines}
            withReason={kind === "waste"}
          />
          <Button type="submit" disabled={pending}>
            {pending
              ? "Saving…"
              : kind === "waste"
                ? "Record waste"
                : "Send stock"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A new purchase order, optionally filled from recent usage. */
export function PurchaseOrderForm({
  branchId,
  ingredients,
  suppliers,
  currency,
  doneHref,
}: {
  branchId: string;
  ingredients: StockIngredient[];
  suppliers: { id: string; name: string }[];
  currency: string;
  doneHref: string;
}) {
  const fid = useFieldIds();
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [id] = useState(() => crypto.randomUUID());
  const [supplierId, setSupplierId] = useState("");
  const [expectedOn, setExpectedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { ingredientId: "", quantity: "", unitCost: "" },
  ]);
  const [suggesting, startSuggest] = useTransition();
  const [hint, setHint] = useState<string | null>(null);

  function suggest(days: number) {
    setHint(null);
    startSuggest(async () => {
      const result = await suggestPurchase(branchId, days);
      if (!result.ok) {
        setHint(result.error);
        return;
      }
      const rows = (result.data ?? []).filter(
        (r) => !supplierId || r.supplier_id === supplierId,
      );
      if (!rows.length) {
        setHint("Nothing needs ordering from this supplier right now.");
        return;
      }
      if (!supplierId && rows[0].supplier_id)
        setSupplierId(rows[0].supplier_id);
      const supplier = supplierId || rows[0].supplier_id;
      setLines(
        rows
          .filter((r) => r.supplier_id === supplier)
          .map((r) => ({
            ingredientId: r.ingredient_id,
            quantity: formatQuantity(r.suggested),
            unitCost: toMoneyInput(r.cost_per_unit, currency),
          })),
      );
      setHint(
        `Filled from the last ${days} days of use, plus each reorder level.`,
      );
    });
  }

  return (
    <form
      className="flex max-w-4xl flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            savePurchaseOrder(branchId, {
              id,
              supplierId,
              expectedOn,
              notes,
              lines,
            }),
          () => router.push(doneHref.replace("{id}", id)),
        );
      }}
    >
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <label
          htmlFor={fid("supplier")}
          className="flex flex-col gap-1 text-sm"
        >
          Supplier
          <Select
            id={fid("supplier")}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Choose…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
        <label
          htmlFor={fid("expected")}
          className="flex flex-col gap-1 text-sm"
        >
          Expected on
          <Input
            id={fid("expected")}
            type="date"
            value={expectedOn}
            onChange={(e) => setExpectedOn(e.target.value)}
          />
        </label>
        <label htmlFor={fid("notes")} className="flex flex-col gap-1 text-sm">
          Notes
          <Input
            id={fid("notes")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Suggest from usage:
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={suggesting}
          onClick={() => suggest(7)}
        >
          Last 7 days
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={suggesting}
          onClick={() => suggest(14)}
        >
          Last 14 days
        </Button>
        {hint ? (
          <span className="text-sm text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      <LineEditor
        ingredients={ingredients}
        lines={lines}
        onChange={setLines}
        withCost
        currency={currency}
      />
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </form>
  );
}

/** Send, cancel and receive a purchase order. */
export function PurchaseOrderActions({
  orderId,
  status,
  lines,
  currency,
}: {
  orderId: string;
  status: string;
  lines: {
    ingredient_id: string;
    name: string;
    unit: StockUnit;
    quantity: number;
    unit_cost: number;
  }[];
  currency: string;
}) {
  const fid = useFieldIds();
  const { pending, error, run } = useRun();
  const [receiving, setReceiving] = useState(false);
  const [received, setReceived] = useState(
    lines.map((l) => ({
      ingredientId: l.ingredient_id,
      quantity: formatQuantity(l.quantity),
      unitCost: toMoneyInput(l.unit_cost, currency),
    })),
  );
  if (status === "received" || status === "cancelled") return null;
  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {status === "draft" ? (
          <Button
            size="lg"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => setPurchaseOrderStatus(orderId, "sent"))}
          >
            Mark as sent
          </Button>
        ) : null}
        <Button size="lg" disabled={pending} onClick={() => setReceiving(true)}>
          Receive delivery
        </Button>
        <Button
          size="lg"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (window.confirm("Cancel this purchase order?"))
              run(() => setPurchaseOrderStatus(orderId, "cancelled"));
          }}
        >
          Cancel order
        </Button>
      </div>
      <Dialog open={receiving} onOpenChange={setReceiving}>
        <DialogContent className="w-[min(40rem,97vw)] max-w-none sm:max-w-none">
          <DialogHeader>
            <DialogTitle>Receive delivery</DialogTitle>
            <DialogDescription>
              Change any line that arrived short, over or at a different price.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => receivePurchaseOrder(orderId, received),
                () => setReceiving(false),
              );
            }}
          >
            <FormError message={error} />
            {lines.map((l, i) => (
              <div
                key={l.ingredient_id}
                className="flex flex-wrap items-end gap-2"
              >
                <span className="min-w-40 flex-1 pb-2 font-medium">
                  {l.name}
                </span>
                <label
                  htmlFor={fid(`q${i}`)}
                  className="flex w-28 flex-col gap-1 text-sm"
                >
                  Arrived ({l.unit})
                  <Input
                    id={fid(`q${i}`)}
                    inputMode="decimal"
                    value={received[i].quantity}
                    onChange={(e) =>
                      setReceived(
                        received.map((r, j) =>
                          j === i ? { ...r, quantity: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </label>
                <label
                  htmlFor={fid(`c${i}`)}
                  className="flex w-28 flex-col gap-1 text-sm"
                >
                  Cost each
                  <Input
                    id={fid(`c${i}`)}
                    inputMode="decimal"
                    value={received[i].unitCost}
                    onChange={(e) =>
                      setReceived(
                        received.map((r, j) =>
                          j === i ? { ...r, unitCost: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ))}
            <Button type="submit" disabled={pending}>
              {pending ? "Receiving…" : "Receive into stock"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Counting stock on the shelf, for everything or one category. */
export function StockCountForm({
  branchId,
  ingredients,
}: {
  branchId: string;
  ingredients: StockIngredient[];
}) {
  const fid = useFieldIds();
  const { pending, error, run } = useRun();
  const [id, setId] = useState(() => crypto.randomUUID());
  const [category, setCategory] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const categories = [
    ...new Set(ingredients.map((i) => i.category).filter(Boolean)),
  ] as string[];
  const shown = ingredients.filter((i) => !category || i.category === category);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(
          () =>
            submitStockCount(
              branchId,
              id,
              category || null,
              shown.map((i) => ({
                ingredientId: i.id,
                quantity: counts[i.id] ?? "",
              })),
            ),
          () => {
            setSaved(true);
            setCounts({});
            setId(crypto.randomUUID());
          },
        );
      }}
    >
      <FormError message={error} />
      {saved ? (
        <p className="text-sm text-emerald-700">
          Count saved. It waits for approval below.
        </p>
      ) : null}
      <label
        htmlFor={fid("category")}
        className="flex w-60 flex-col gap-1 text-sm"
      >
        What to count
        <Select
          id={fid("category")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Everything</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </label>
      <ul className="grid gap-2 sm:grid-cols-2">
        {shown.map((i) => (
          <li
            key={i.id}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
          >
            <label htmlFor={fid(`n-${i.id}`)} className="flex-1">
              {i.name}
            </label>
            <Input
              id={fid(`n-${i.id}`)}
              inputMode="decimal"
              className="w-24"
              placeholder="–"
              value={counts[i.id] ?? ""}
              onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })}
              aria-label={`Counted ${i.name} (${i.unit})`}
            />
            <span className="w-8 text-sm text-muted-foreground">{i.unit}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        Leave blank what you didn&apos;t count.
      </p>
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save count"}
        </Button>
      </div>
    </form>
  );
}

export function CountReview({ countId }: { countId: string }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <FormError message={error} />
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        rows={2}
        aria-label="Review note"
      />
      <div className="flex gap-2">
        <Button
          disabled={pending}
          onClick={() => run(() => reviewStockCount(countId, true, note))}
        >
          Approve and adjust stock
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run(() => reviewStockCount(countId, false, note))}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

export function formatMoneyCell(amount: number, currency: string) {
  return formatAmount(amount, currency);
}
