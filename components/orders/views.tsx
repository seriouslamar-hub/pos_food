import Link from "next/link";
import { EmptyState } from "@/components/admin/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, dateInZone, formatInZone, isIsoDate } from "@/lib/datetime";
import { requestTime } from "@/lib/devices";
import { formatAmount, parseMoney } from "@/lib/money";
import { ORDER_STATUS_LABELS, parseOrderSummary } from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ExceptionsTable, type ExceptionRow } from "./exceptions-table";

type Params = Record<string, string | string[] | undefined>;
const text = (value: string | string[] | undefined) =>
  typeof value === "string" ? value.trim() : "";

async function branchInfo(branchId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("branches")
    .select("name, currency_code, timezone")
    .eq("id", branchId)
    .single();
  return { supabase, branch: data };
}

/**
 * Voids, refunds, discounts, price changes and no-sales between two
 * business dates (the last 7 days by default).
 */
export async function ExceptionsView({
  branchId,
  params,
  hidden = {},
  orderBasePath,
}: {
  branchId: string;
  params: Params;
  /** Extra query values to keep (the admin's branch). */
  hidden?: Record<string, string>;
  orderBasePath: string;
}) {
  const { supabase, branch } = await branchInfo(branchId);
  if (!branch) return <EmptyState>That branch doesn&apos;t exist.</EmptyState>;
  const today = dateInZone(requestTime(), branch.timezone);
  const to = isIsoDate(params.to) ? params.to : today;
  const from = isIsoDate(params.from) ? params.from : addDays(to, -6);
  const { data, error } = await supabase.rpc("report_exceptions", {
    p_branch_id: branchId,
    p_from: from,
    p_to: to,
  });

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-end gap-3" aria-label="Dates">
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="flex flex-col gap-1 text-sm">
          From
          <Input type="date" name="from" defaultValue={from} className="w-44" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <Input type="date" name="to" defaultValue={to} className="w-44" />
        </label>
        <Button type="submit" variant="outline" size="lg">
          Show
        </Button>
      </form>
      {error ? (
        <EmptyState>{error.message}</EmptyState>
      ) : (
        <ExceptionsTable
          rows={(data as ExceptionRow[] | null) ?? []}
          currency={branch.currency_code}
          timezone={branch.timezone}
          orderBasePath={orderBasePath}
        />
      )}
    </div>
  );
}

type FoundOrder = {
  id: string;
  order_number: string;
  business_date: string;
  created_at: string;
  status: keyof typeof ORDER_STATUS_LABELS;
  total: number;
  staff_name: string | null;
  refunded_total: number;
  payments: { method_name: string; amount: number; reference: string | null }[];
};

/** Find orders by business date, number, amount or payment reference. */
export async function OrderSearchView({
  branchId,
  params,
  hidden = {},
  orderHref,
}: {
  branchId: string;
  params: Params;
  hidden?: Record<string, string>;
  orderHref: (orderId: string) => string;
}) {
  const { supabase, branch } = await branchInfo(branchId);
  if (!branch) return <EmptyState>That branch doesn&apos;t exist.</EmptyState>;
  const date = isIsoDate(params.date)
    ? params.date
    : text(params.date) === "any"
      ? ""
      : dateInZone(requestTime(), branch.timezone);
  const number = text(params.number);
  const reference = text(params.reference);
  let amount: number | undefined;
  let amountError: string | null = null;
  if (text(params.amount)) {
    try {
      amount = parseMoney(text(params.amount), branch.currency_code);
    } catch {
      amountError = "Enter the amount like 12.50.";
    }
  }
  const { data, error } = amountError
    ? { data: [], error: null }
    : await supabase.rpc("search_orders", {
        p_branch_id: branchId,
        p_business_date: date || undefined,
        p_number: number || undefined,
        p_amount: amount,
        p_reference: reference || undefined,
      });
  const orders = (data as FoundOrder[] | null) ?? [];
  const money = (value: number) => formatAmount(value, branch.currency_code);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        aria-label="Search orders"
      >
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="flex flex-col gap-1 text-sm">
          Business day
          <Input type="date" name="date" defaultValue={date} className="w-44" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Order number
          <Input name="number" defaultValue={number} className="w-32" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Amount
          <Input
            name="amount"
            inputMode="decimal"
            defaultValue={text(params.amount)}
            className="w-32"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Payment reference
          <Input name="reference" defaultValue={reference} className="w-44" />
        </label>
        <Button type="submit" variant="outline" size="lg">
          Search
        </Button>
      </form>
      {amountError || error ? (
        <EmptyState>{amountError ?? error?.message}</EmptyState>
      ) : orders.length === 0 ? (
        <EmptyState>No orders found.</EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={orderHref(o.id)}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-muted"
                data-testid="order-result"
              >
                <span>
                  <span className="font-medium">Order {o.order_number}</span>
                  <span className="block text-sm text-muted-foreground">
                    {formatInZone(o.created_at, branch.timezone)} ·{" "}
                    {o.staff_name ?? "–"}
                    {o.payments.length
                      ? ` · ${o.payments.map((p) => p.method_name).join(", ")}`
                      : ""}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <Badge variant="secondary">
                    {ORDER_STATUS_LABELS[o.status]}
                  </Badge>
                  <span className="tabular-nums">{money(o.total)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type AuditEntry = {
  at: string;
  action: string;
  actor_name: string | null;
  approver_name: string | null;
  reason: string | null;
};

const HISTORY_LABELS: Record<string, string> = {
  "order.create": "Order taken",
  "order.paid": "Paid",
  "order.sent_to_kitchen": "Sent to kitchen unpaid",
  "order.discount": "Discount",
  "order.price_override": "Price changed",
  "order.void": "Items voided",
  "order.refund": "Refund",
};

/** One order: lines, payments, voids, refunds and its history. */
export async function OrderDetailView({ orderId }: { orderId: string }) {
  const supabase = await createClient();
  const [{ data, error }, { data: trailData }] = await Promise.all([
    supabase.rpc("get_order", { p_order_id: orderId }),
    supabase.rpc("order_audit_trail", { p_order_id: orderId }),
  ]);
  if (error || !data) return <EmptyState>Order not found.</EmptyState>;
  const order = parseOrderSummary(data);
  const trail = (trailData as AuditEntry[] | null) ?? [];
  const money = (value: number) =>
    formatAmount(value, order.branch.currency_code);
  const when = (iso: string) => formatInZone(iso, order.branch.timezone);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge>{ORDER_STATUS_LABELS[order.status]}</Badge>
        <span className="text-muted-foreground">
          Taken {when(order.created_at)} by {order.staff_name ?? "–"} on till{" "}
          {order.device_code ?? "–"}
        </span>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Items</h2>
        <ul className="divide-y rounded-xl border">
          {order.lines.map((l) => (
            <li
              key={l.id}
              className="flex items-start justify-between gap-3 px-4 py-3"
            >
              <span
                className={cn(
                  l.status === "voided" && !l.refunded_at && "line-through",
                )}
              >
                {l.quantity} × {l.name}
                {l.components.length ? (
                  <span className="block text-sm text-muted-foreground">
                    {l.components.map((c) => c.name).join(", ")}
                  </span>
                ) : null}
                {l.line_discount ? (
                  <span className="block text-sm text-muted-foreground">
                    Discount −{money(l.line_discount)}
                    {l.discount ? ` (${l.discount.reason})` : ""}
                  </span>
                ) : null}
                {l.price_override_from !== null ? (
                  <span className="block text-sm text-muted-foreground">
                    Price changed from {money(l.price_override_from)} (
                    {l.price_override_reason})
                  </span>
                ) : null}
                {l.refunded_at ? (
                  <span className="block text-sm">Refunded</span>
                ) : l.status === "voided" ? (
                  <span className="block text-sm text-destructive">
                    Voided: {l.void_reason}
                  </span>
                ) : null}
              </span>
              <span className="tabular-nums">{money(l.line_total)}</span>
            </li>
          ))}
        </ul>
        <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-1">
          <dt>Subtotal</dt>
          <dd className="text-right tabular-nums">{money(order.subtotal)}</dd>
          {order.discount_total ? (
            <>
              <dt>Discounts</dt>
              <dd className="text-right tabular-nums">
                −{money(order.discount_total)}
              </dd>
            </>
          ) : null}
          <dt>Tax</dt>
          <dd className="text-right tabular-nums">{money(order.tax_total)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold tabular-nums">
            {money(order.total)}
          </dd>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Payments and refunds</h2>
        {order.payments.length === 0 && order.refunds.length === 0 ? (
          <p className="text-muted-foreground">Not paid.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {order.payments.map((p) => (
              <li key={p.id}>
                {p.method_name} {money(p.amount)}
                {p.reference ? ` · ref ${p.reference}` : ""}
                {p.change_given ? ` · change ${money(p.change_given)}` : ""}
              </li>
            ))}
            {order.refunds.map((r) => (
              <li key={r.id} className="text-destructive">
                Refund {r.method_name} −{money(r.amount)} · {r.reason} ·{" "}
                {when(r.created_at)}
                {r.approved_by_name
                  ? ` · approved by ${r.approved_by_name}`
                  : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">History</h2>
        <ol className="flex flex-col gap-1">
          {trail.map((t, i) => (
            <li key={i} data-testid="history-entry">
              <span className="text-muted-foreground">{when(t.at)}</span> ·{" "}
              {HISTORY_LABELS[t.action] ?? t.action} by {t.actor_name ?? "–"}
              {t.approver_name ? `, approved by ${t.approver_name}` : ""}
              {t.reason ? ` · ${t.reason}` : ""}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
