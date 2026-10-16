"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Select } from "@/components/admin/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatInZone } from "@/lib/datetime";
import { formatAmount } from "@/lib/money";
import { useFieldIds } from "@/lib/use-field-ids";

export type ExceptionRow = {
  kind: "void" | "refund" | "discount" | "price_override" | "no_sale";
  at: string;
  business_date: string;
  order_id: string | null;
  order_number: string | null;
  staff_name: string | null;
  approver_name: string | null;
  amount: number;
  reason: string | null;
  detail: string | null;
};

export const EXCEPTION_LABELS: Record<ExceptionRow["kind"], string> = {
  void: "Void",
  refund: "Refund",
  discount: "Discount",
  price_override: "Price change",
  no_sale: "No sale",
};

type SortKey = "at" | "kind" | "staff_name" | "amount";

/** The exceptions report: filter, sort, and totals by kind and by cashier. */
export function ExceptionsTable({
  rows,
  currency,
  timezone,
  orderBasePath,
}: {
  rows: ExceptionRow[];
  currency: string;
  timezone: string;
  /** Order pages live at `${orderBasePath}/${orderId}`. */
  orderBasePath: string;
}) {
  const fid = useFieldIds();
  const [kind, setKind] = useState<"" | ExceptionRow["kind"]>("");
  const [cashier, setCashier] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "at",
    desc: true,
  });
  const money = (amount: number) => formatAmount(amount, currency);
  const cashiers = useMemo(
    () => [...new Set(rows.map((r) => r.staff_name ?? "–"))].sort(),
    [rows],
  );

  const shown = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        (!kind || r.kind === kind) &&
        (!cashier || (r.staff_name ?? "–") === cashier),
    );
    const value = (r: ExceptionRow) =>
      sort.key === "amount" ? r.amount : (r[sort.key] ?? "");
    return [...filtered].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const order = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -order : order;
    });
  }, [rows, kind, cashier, sort]);

  const byKind = useMemo(() => {
    const totals = new Map<
      ExceptionRow["kind"],
      { n: number; amount: number }
    >();
    for (const r of shown) {
      const t = totals.get(r.kind) ?? { n: 0, amount: 0 };
      totals.set(r.kind, { n: t.n + 1, amount: t.amount + r.amount });
    }
    return totals;
  }, [shown]);
  const byCashier = useMemo(() => {
    const totals = new Map<string, { n: number; amount: number }>();
    for (const r of shown) {
      const name = r.staff_name ?? "–";
      const t = totals.get(name) ?? { n: 0, amount: 0 };
      totals.set(name, { n: t.n + 1, amount: t.amount + r.amount });
    }
    return [...totals.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [shown]);

  function header(key: SortKey, label: string, right = false) {
    const active = sort.key === key;
    return (
      <TableHead
        className={right ? "text-right" : undefined}
        aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      >
        <button
          type="button"
          className="font-medium hover:underline"
          onClick={() =>
            setSort((s) => ({
              key,
              desc: s.key === key ? !s.desc : key === "at" || key === "amount",
            }))
          }
        >
          {label}
          {active ? (sort.desc ? " ↓" : " ↑") : ""}
        </button>
      </TableHead>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor={fid("kind")} className="flex flex-col gap-1 text-sm">
          Type
          <Select
            id={fid("kind")}
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="w-44"
          >
            <option value="">All types</option>
            {Object.entries(EXCEPTION_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label htmlFor={fid("cashier")} className="flex flex-col gap-1 text-sm">
          Cashier
          <Select
            id={fid("cashier")}
            value={cashier}
            onChange={(e) => setCashier(e.target.value)}
            className="w-48"
          >
            <option value="">Everyone</option>
            {cashiers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-xl border p-3" aria-label="Totals by type">
          <h3 className="mb-2 font-semibold">By type</h3>
          <dl className="flex flex-col gap-1">
            {[...byKind.entries()].map(([k, t]) => (
              <div
                key={k}
                className="flex justify-between"
                data-testid="kind-total"
              >
                <dt>
                  {EXCEPTION_LABELS[k]} ({t.n})
                </dt>
                <dd className="tabular-nums">
                  {k === "no_sale" ? "–" : money(t.amount)}
                </dd>
              </div>
            ))}
            {byKind.size === 0 ? (
              <p className="text-muted-foreground">Nothing in this period.</p>
            ) : null}
          </dl>
        </section>
        <section
          className="rounded-xl border p-3"
          aria-label="Totals by cashier"
        >
          <h3 className="mb-2 font-semibold">By cashier</h3>
          <dl className="flex flex-col gap-1">
            {byCashier.map(([name, t]) => (
              <div key={name} className="flex justify-between">
                <dt>
                  {name} ({t.n})
                </dt>
                <dd className="tabular-nums">{money(t.amount)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {header("at", "When")}
              {header("kind", "Type")}
              <TableHead>Order</TableHead>
              {header("staff_name", "Cashier")}
              <TableHead>Approved by</TableHead>
              <TableHead>Reason</TableHead>
              {header("amount", "Amount", true)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r, i) => (
              <TableRow
                key={`${r.kind}-${r.order_id}-${r.at}-${i}`}
                data-testid="exception-row"
              >
                <TableCell className="whitespace-nowrap">
                  {formatInZone(r.at, timezone, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </TableCell>
                <TableCell>
                  {EXCEPTION_LABELS[r.kind]}
                  {r.detail ? (
                    <span className="block text-xs text-muted-foreground">
                      {r.detail}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  {r.order_id ? (
                    <Link
                      href={`${orderBasePath}/${r.order_id}`}
                      className="underline underline-offset-2"
                    >
                      {r.order_number}
                    </Link>
                  ) : (
                    "–"
                  )}
                </TableCell>
                <TableCell>{r.staff_name ?? "–"}</TableCell>
                <TableCell>{r.approver_name ?? "–"}</TableCell>
                <TableCell className="max-w-56">{r.reason ?? "–"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.kind === "no_sale" ? "–" : money(r.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
