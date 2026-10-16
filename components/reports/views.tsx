import Link from "next/link";
import { Select } from "@/components/admin/form";
import { EmptyState } from "@/components/admin/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatInZone } from "@/lib/datetime";
import { ORDER_STATUS_LABELS } from "@/lib/orders";
import {
  branchArg,
  CHANNEL_LABELS,
  EXPORT_KINDS,
  formatDuration,
  formatHour,
  ORDER_TYPE_LABELS,
  percentChange,
  rangePresets,
  reportMoney,
  type DashboardReport,
  type DiscountReport,
  type DurationStats,
  type SalesReport,
  type TaxReport,
} from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { AutoRefresh } from "./auto-refresh";
import { ChartCard } from "./chart-card";
import type { ReportsContext } from "./context";

const PAGES = [
  ["", "Today"],
  ["/sales", "Sales"],
  ["/tax", "Tax"],
  ["/discounts", "Discounts"],
  ["/promotions", "Promotions"],
] as const;

/** Page links, the branch picker (admins) and, except on Today, the dates. */
function ReportsNav({
  ctx,
  current,
  dates = true,
}: {
  ctx: ReportsContext;
  current: string;
  dates?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Reports" className="flex flex-wrap gap-2">
        {PAGES.map(([path, label]) => (
          <Link
            key={path}
            href={ctx.href(path, path === "" ? null : undefined)}
            aria-current={current === path ? "page" : undefined}
            className={buttonVariants({
              variant: current === path ? "default" : "outline",
              size: "lg",
            })}
          >
            {label}
          </Link>
        ))}
        <Link
          href={ctx.exceptionsHref}
          className={buttonVariants({ variant: "outline", size: "lg" })}
        >
          Exceptions
        </Link>
        <Link
          href={ctx.dayHref}
          className={buttonVariants({ variant: "outline", size: "lg" })}
        >
          Z reports
        </Link>
      </nav>
      <form
        className="flex flex-wrap items-end gap-3"
        aria-label="Report filters"
      >
        {ctx.branches ? (
          <label className="flex flex-col gap-1 text-sm">
            Branch
            <Select
              name="branch"
              defaultValue={ctx.branchId ?? "all"}
              className="w-56"
            >
              <option value="all">All branches</option>
              {ctx.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        {dates ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              From
              <Input
                type="date"
                name="from"
                defaultValue={ctx.from}
                max={ctx.today}
                className="w-44"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              To
              <Input
                type="date"
                name="to"
                defaultValue={ctx.to}
                max={ctx.today}
                className="w-44"
              />
            </label>
          </>
        ) : null}
        {dates || ctx.branches ? (
          <Button type="submit" variant="outline" size="lg">
            Show
          </Button>
        ) : null}
      </form>
      {dates ? (
        <div className="flex flex-wrap gap-2" aria-label="Quick dates">
          {rangePresets(ctx.today).map((p) => {
            const active = p.from === ctx.from && p.to === ctx.to;
            return (
              <Link
                key={p.key}
                href={ctx.href(current, p)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "rounded-full border px-3 py-2 text-sm",
                  active && "bg-foreground text-background",
                )}
              >
                {p.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  change,
  testId,
}: {
  label: string;
  value: string;
  note?: string;
  change?: number | null;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border p-4"
      data-testid={testId}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className="text-2xl font-semibold tabular-nums"
        data-testid={testId ? `${testId}-value` : undefined}
      >
        {value}
      </span>
      {note || change !== undefined ? (
        <span className="text-sm text-muted-foreground">
          {change !== undefined && change !== null ? (
            <span
              className={cn(
                "font-medium",
                change > 0 && "text-foreground",
                change < 0 && "text-destructive",
              )}
            >
              {change > 0 ? "▲ +" : change < 0 ? "▼ " : ""}
              {change}%{" "}
            </span>
          ) : null}
          {note}
        </span>
      ) : null}
    </div>
  );
}

function MixedCurrencies({ currency }: { currency: string | null }) {
  if (currency) return null;
  return (
    <Alert>
      <AlertDescription>
        These branches use different currencies, so amounts are shown as plain
        numbers. Choose one branch for totals in its currency.
      </AlertDescription>
    </Alert>
  );
}

function ReportError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export async function DashboardView({ ctx }: { ctx: ReportsContext }) {
  const supabase = await createClient();
  const [{ data, error }, { data: branches }] = await Promise.all([
    supabase.rpc("report_dashboard", {
      p_branch_id: branchArg(ctx.branchId),
    }),
    supabase.from("branches").select("id, name, timezone"),
  ]);
  if (error || !data)
    return (
      <div className="flex flex-col gap-5">
        <ReportsNav ctx={ctx} current="" dates={false} />
        <ReportError message={error?.message ?? "No report."} />
      </div>
    );
  const report = data as unknown as DashboardReport;
  const money = reportMoney(report.currency_code);
  const zone = new Map((branches ?? []).map((b) => [b.id, b]));
  const vs = report.last_week_so_far;
  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh seconds={30} />
      <ReportsNav ctx={ctx} current="" dates={false} />
      <MixedCurrencies currency={report.currency_code} />
      <p className="text-muted-foreground">
        {report.day_open ? "Business day open" : "Business day not open"} ·{" "}
        {formatInZone(`${report.business_date}T12:00:00Z`, "UTC", {
          dateStyle: "full",
        })}
        . Compared with the same weekday last week, up to this time. Updates
        every 30 seconds.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Sales today"
          value={money(report.today.net_sales)}
          change={percentChange(report.today.net_sales, vs.net_sales)}
          note={`vs ${money(vs.net_sales)} (all day ${money(report.last_week_day.net_sales)})`}
          testId="today-sales"
        />
        <Stat
          label="Orders"
          value={String(report.today.orders)}
          change={percentChange(report.today.orders, vs.orders)}
          note={`vs ${vs.orders}`}
          testId="today-orders"
        />
        <Stat
          label="Average order"
          value={money(report.today.average_order)}
          change={percentChange(report.today.average_order, vs.average_order)}
          note={`vs ${money(vs.average_order)}`}
          testId="today-average"
        />
      </div>
      <ChartCard
        title="Sales by hour"
        description="Today against the same weekday last week."
        rows={report.hourly
          .filter((h) => h.today || h.last_week)
          .map((h) => ({
            hour: formatHour(h.hour),
            today: h.today,
            last_week: h.last_week,
          }))}
        columns={[
          { key: "hour", label: "Hour" },
          { key: "today", label: "Today", kind: "money" },
          { key: "last_week", label: "Last week", kind: "money" },
        ]}
        chart={{
          type: "bar",
          x: "hour",
          series: [
            { key: "today", label: "Today" },
            { key: "last_week", label: "Last week" },
          ],
        }}
        currency={report.currency_code}
        fileName={`hourly-${report.business_date}`}
      />
      <section
        className="flex flex-col gap-3 rounded-xl border p-4"
        aria-label="Live orders"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">Live orders</h2>
          <Badge data-testid="live-orders-count">
            {report.open_orders.count}
          </Badge>
          {Object.entries(report.open_orders.by_status).map(([status, n]) => (
            <span key={status} className="text-sm text-muted-foreground">
              {ORDER_STATUS_LABELS[
                status as keyof typeof ORDER_STATUS_LABELS
              ] ?? status}
              : {n}
            </span>
          ))}
        </div>
        {report.open_orders.recent.length ? (
          <ul className="divide-y">
            {report.open_orders.recent.map((o) => {
              const b = zone.get(o.branch_id);
              return (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    <strong className="tabular-nums">{o.order_number}</strong>{" "}
                    <span className="text-sm text-muted-foreground">
                      {ORDER_TYPE_LABELS[o.order_type] ?? o.order_type} ·{" "}
                      {formatInZone(o.created_at, b?.timezone ?? "UTC", {
                        timeStyle: "short",
                      })}
                      {ctx.branchId ? "" : ` · ${b?.name ?? ""}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge variant="outline">
                      {ORDER_STATUS_LABELS[
                        o.status as keyof typeof ORDER_STATUS_LABELS
                      ] ?? o.status}
                    </Badge>
                    <span className="tabular-nums">{money(o.total)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground">No orders waiting.</p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

function speedText(stats: DurationStats) {
  if (!stats?.count) return { value: "–", note: "No orders timed" };
  return {
    value: formatDuration(stats.average),
    note: `median ${formatDuration(stats.median)} · 9 in 10 within ${formatDuration(stats.p90)} · ${stats.count} orders`,
  };
}

export async function SalesView({ ctx }: { ctx: ReportsContext }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_sales", {
    p_branch_id: branchArg(ctx.branchId),
    p_from: ctx.from,
    p_to: ctx.to,
  });
  if (error || !data)
    return (
      <div className="flex flex-col gap-5">
        <ReportsNav ctx={ctx} current="/sales" />
        <ReportError message={error?.message ?? "No report."} />
      </div>
    );
  const report = data as unknown as SalesReport;
  const money = reportMoney(report.currency_code);
  const c = report.currency_code;
  const s = report.summary;
  const range = `${ctx.from}-to-${ctx.to}`;
  // href() always carries the dates, so the kind follows with &.
  const exportHref = (kind: string) => `${ctx.href("/export")}&kind=${kind}`;
  const ready = speedText(report.speed.to_ready);
  const collected = speedText(report.speed.to_collected);
  const total = speedText(report.speed.total);

  return (
    <div className="flex flex-col gap-5">
      <ReportsNav ctx={ctx} current="/sales" />
      <MixedCurrencies currency={c} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Net sales"
          value={money(s.net_sales)}
          note={`${s.days} trading days`}
          testId="net-sales"
        />
        <Stat
          label="Orders"
          value={s.orders.toLocaleString("en-GB")}
          testId="orders"
        />
        <Stat
          label="Average order"
          value={money(s.average_order)}
          testId="average-order"
        />
        <Stat label="Items sold" value={s.items_sold.toLocaleString("en-GB")} />
        <Stat label="Before discounts and tax" value={money(s.gross_sales)} />
        <Stat label="Discounts" value={money(s.discounts)} />
        <Stat label="Tax" value={money(s.tax)} testId="tax" />
        <Stat
          label="Refunds and voids"
          value={money(s.refunds.amount)}
          note={`${s.refunds.count} refunds · ${s.voids.count} voids (${money(s.voids.amount)})`}
        />
      </div>
      <section
        className="flex flex-wrap items-center gap-2 rounded-xl border p-4"
        aria-label="Exports"
      >
        <span className="font-medium">For the accountant:</span>
        {Object.entries(EXPORT_KINDS).map(([kind, spec]) => (
          <a
            key={kind}
            href={exportHref(kind)}
            className={buttonVariants({ variant: "outline" })}
            download
          >
            {spec.label} CSV
          </a>
        ))}
        <span className="text-sm text-muted-foreground">
          One row per order, payment or tax per day. Opens in Excel.
        </span>
      </section>

      {ctx.branchId === null ? (
        <ChartCard
          title="Branches compared"
          rows={report.by_branch.map((b) => ({
            name: b.name,
            orders: b.orders,
            net_sales: b.net_sales,
            average_order: b.average_order,
            discounts: b.discounts,
            refunds: b.refunds,
            currency: b.currency_code,
          }))}
          columns={[
            { key: "name", label: "Branch" },
            { key: "net_sales", label: "Net sales", kind: "money" },
            { key: "orders", label: "Orders", kind: "number" },
            { key: "average_order", label: "Average order", kind: "money" },
            { key: "discounts", label: "Discounts", kind: "money" },
            { key: "refunds", label: "Refunds", kind: "money" },
            { key: "currency", label: "Currency" },
          ]}
          chart={
            c
              ? {
                  type: "bar",
                  x: "name",
                  series: [{ key: "net_sales", label: "Net sales" }],
                  horizontal: true,
                }
              : undefined
          }
          currency={c}
          fileName={`branches-${range}`}
        />
      ) : null}

      <ChartCard
        title="Sales by day"
        rows={report.daily.map((d) => ({
          date: d.date,
          net_sales: d.net_sales,
          orders: d.orders,
          refunds: d.refunds,
        }))}
        columns={[
          { key: "date", label: "Date" },
          { key: "net_sales", label: "Net sales", kind: "money" },
          { key: "orders", label: "Orders", kind: "number" },
          { key: "refunds", label: "Refunds", kind: "money" },
        ]}
        chart={{
          type: "line",
          x: "date",
          series: [{ key: "net_sales", label: "Net sales" }],
        }}
        currency={c}
        fileName={`daily-sales-${range}`}
      />
      <ChartCard
        title="Sales by hour"
        description="Branch local time. Busy hours at a glance."
        rows={report.hourly
          .filter((h) => h.orders > 0)
          .map((h) => ({
            hour: formatHour(h.hour),
            net_sales: h.net_sales,
            orders: h.orders,
          }))}
        columns={[
          { key: "hour", label: "Hour" },
          { key: "net_sales", label: "Net sales", kind: "money" },
          { key: "orders", label: "Orders", kind: "number" },
        ]}
        chart={{
          type: "bar",
          x: "hour",
          series: [{ key: "net_sales", label: "Net sales" }],
        }}
        currency={c}
        fileName={`hourly-sales-${range}`}
      />
      <ChartCard
        title="Product mix"
        description="Items as sold, before discounts. A meal counts as the meal."
        rows={report.products.map((p) => ({
          name: p.name,
          quantity: p.quantity,
          amount: p.amount,
          share: s.gross_sales
            ? Math.round((p.amount / s.gross_sales) * 1000) / 10
            : 0,
        }))}
        columns={[
          { key: "name", label: "Item" },
          { key: "quantity", label: "Quantity", kind: "number" },
          { key: "amount", label: "Revenue", kind: "money" },
          { key: "share", label: "Share", kind: "percent" },
        ]}
        chart={{
          type: "bar",
          x: "name",
          series: [{ key: "amount", label: "Revenue" }],
          horizontal: true,
        }}
        currency={c}
        fileName={`product-mix-${range}`}
        initialView="table"
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard
          title="Channels"
          rows={report.channels.map((x) => ({
            channel: CHANNEL_LABELS[x.channel] ?? x.channel,
            net_sales: x.net_sales,
            orders: x.orders,
          }))}
          columns={[
            { key: "channel", label: "Channel" },
            { key: "net_sales", label: "Net sales", kind: "money" },
            { key: "orders", label: "Orders", kind: "number" },
          ]}
          chart={{
            type: "bar",
            x: "channel",
            series: [{ key: "net_sales", label: "Net sales" }],
          }}
          currency={c}
          fileName={`channels-${range}`}
        />
        <ChartCard
          title="Order types"
          rows={report.order_types.map((x) => ({
            order_type: ORDER_TYPE_LABELS[x.order_type] ?? x.order_type,
            net_sales: x.net_sales,
            orders: x.orders,
          }))}
          columns={[
            { key: "order_type", label: "Order type" },
            { key: "net_sales", label: "Net sales", kind: "money" },
            { key: "orders", label: "Orders", kind: "number" },
          ]}
          chart={{
            type: "bar",
            x: "order_type",
            series: [{ key: "net_sales", label: "Net sales" }],
          }}
          currency={c}
          fileName={`order-types-${range}`}
        />
      </div>
      <ChartCard
        title="Payment methods"
        description="Payments taken on these business days."
        rows={report.payments.map((p) => ({
          name: p.name,
          amount: p.amount,
          count: p.count,
        }))}
        columns={[
          { key: "name", label: "Method" },
          { key: "amount", label: "Amount", kind: "money" },
          { key: "count", label: "Payments", kind: "number" },
        ]}
        chart={{
          type: "bar",
          x: "name",
          series: [{ key: "amount", label: "Amount" }],
        }}
        currency={c}
        fileName={`payments-${range}`}
      />
      <ChartCard
        title="Cashier performance"
        description="Sales by who took the order; voids and refunds by who did them."
        rows={report.cashiers.map((x) => ({
          name: x.name,
          orders: x.orders,
          net_sales: x.net_sales,
          average_order: x.average_order,
          discounts: x.discounts,
          voids: x.voids_count,
          voids_amount: x.voids_amount,
          refunds: x.refunds_count,
          refunds_amount: x.refunds_amount,
        }))}
        columns={[
          { key: "name", label: "Staff" },
          { key: "orders", label: "Orders", kind: "number" },
          { key: "net_sales", label: "Net sales", kind: "money" },
          { key: "average_order", label: "Average", kind: "money" },
          { key: "discounts", label: "Discounts", kind: "money" },
          { key: "voids", label: "Voids", kind: "number" },
          { key: "voids_amount", label: "Voided", kind: "money" },
          { key: "refunds", label: "Refunds", kind: "number" },
          { key: "refunds_amount", label: "Refunded", kind: "money" },
        ]}
        currency={c}
        fileName={`cashiers-${range}`}
      />
      <section className="flex flex-col gap-3" aria-label="Speed of service">
        <h2 className="text-lg font-semibold">Speed of service</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Kitchen: sent → ready"
            value={ready.value}
            note={ready.note}
            testId="speed-ready"
          />
          <Stat
            label="Counter: ready → collected"
            value={collected.value}
            note={collected.note}
          />
          <Stat
            label="Sent → collected"
            value={total.value}
            note={total.note}
          />
        </div>
        <ChartCard
          title="Kitchen time by hour"
          description="Average time from sent to ready."
          rows={report.speed.by_hour.map((h) => ({
            hour: formatHour(h.hour),
            average_seconds: h.average_seconds,
            minutes: Math.round(h.average_seconds / 6) / 10,
            orders: h.orders,
          }))}
          columns={[
            { key: "hour", label: "Hour" },
            { key: "average_seconds", label: "Average", kind: "duration" },
            { key: "minutes", label: "Minutes", kind: "number" },
            { key: "orders", label: "Orders", kind: "number" },
          ]}
          chart={{
            type: "bar",
            x: "hour",
            series: [{ key: "minutes", label: "Minutes" }],
          }}
          currency={c}
          fileName={`speed-${range}`}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tax and discounts
// ---------------------------------------------------------------------------

export async function TaxView({ ctx }: { ctx: ReportsContext }) {
  const supabase = await createClient();
  const [{ data, error }, { data: branches }] = await Promise.all([
    supabase.rpc("report_tax", {
      p_branch_id: branchArg(ctx.branchId),
      p_from: ctx.from,
      p_to: ctx.to,
    }),
    supabase.from("branches").select("id, name, currency_code"),
  ]);
  const currencies = new Set(
    (branches ?? [])
      .filter((b) => !ctx.branchId || b.id === ctx.branchId)
      .map((b) => b.currency_code),
  );
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  if (error || !data)
    return (
      <div className="flex flex-col gap-5">
        <ReportsNav ctx={ctx} current="/tax" />
        <ReportError message={error?.message ?? "No report."} />
      </div>
    );
  const report = data as unknown as TaxReport;
  const money = reportMoney(currency);
  const names = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const range = `${ctx.from}-to-${ctx.to}`;
  const rate = (bps: number) =>
    `${(bps / 100).toFixed(2).replace(/\.00$/, "")}%`;
  return (
    <div className="flex flex-col gap-5">
      <ReportsNav ctx={ctx} current="/tax" />
      <MixedCurrencies currency={currency} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Tax collected"
          value={money(report.total)}
          testId="tax-total"
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Tax on paid orders by business day. Refunds are listed separately in the
        payments export.
      </p>
      <ChartCard
        title="By tax"
        rows={report.taxes.map((t) => ({
          name: t.name,
          rate: rate(t.rate_bps),
          included: t.inclusive ? "Yes" : "No",
          taxable: t.taxable,
          amount: t.amount,
        }))}
        columns={[
          { key: "name", label: "Tax" },
          { key: "rate", label: "Rate" },
          { key: "included", label: "Included in price" },
          { key: "taxable", label: "Taxable amount", kind: "money" },
          { key: "amount", label: "Tax", kind: "money" },
        ]}
        currency={currency}
        fileName={`tax-${range}`}
      />
      <ChartCard
        title="By day"
        rows={report.daily.map((t) => ({
          date: t.date,
          branch: names.get(t.branch_id) ?? "",
          name: `${t.name} ${rate(t.rate_bps)}`,
          taxable: t.taxable,
          amount: t.amount,
        }))}
        columns={[
          { key: "date", label: "Date" },
          { key: "branch", label: "Branch" },
          { key: "name", label: "Tax" },
          { key: "taxable", label: "Taxable amount", kind: "money" },
          { key: "amount", label: "Tax", kind: "money" },
        ]}
        currency={currency}
        fileName={`tax-by-day-${range}`}
      />
    </div>
  );
}

export async function DiscountsView({ ctx }: { ctx: ReportsContext }) {
  const supabase = await createClient();
  const [{ data, error }, { data: sales }] = await Promise.all([
    supabase.rpc("report_discounts", {
      p_branch_id: branchArg(ctx.branchId),
      p_from: ctx.from,
      p_to: ctx.to,
    }),
    supabase.rpc("report_sales", {
      p_branch_id: branchArg(ctx.branchId),
      p_from: ctx.from,
      p_to: ctx.to,
    }),
  ]);
  if (error || !data)
    return (
      <div className="flex flex-col gap-5">
        <ReportsNav ctx={ctx} current="/discounts" />
        <ReportError message={error?.message ?? "No report."} />
      </div>
    );
  const report = data as unknown as DiscountReport;
  const salesReport = sales as unknown as SalesReport | null;
  const currency = salesReport?.currency_code ?? null;
  const money = reportMoney(currency);
  const gross = salesReport?.summary.gross_sales ?? 0;
  const range = `${ctx.from}-to-${ctx.to}`;
  return (
    <div className="flex flex-col gap-5">
      <ReportsNav ctx={ctx} current="/discounts" />
      <MixedCurrencies currency={currency} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Discounts given"
          value={money(report.total)}
          note={`${report.orders} orders${gross ? ` · ${Math.round((report.total / gross) * 1000) / 10}% of sales` : ""}`}
          testId="discount-total"
        />
        <Stat
          label="Price changes"
          value={money(report.price_overrides.amount)}
          note={`${report.price_overrides.count} lines charged below the menu price`}
        />
      </div>
      <ChartCard
        title="By reason"
        rows={report.by_reason.map((r) => ({
          reason: r.reason,
          orders: r.orders,
          amount: r.amount,
        }))}
        columns={[
          { key: "reason", label: "Reason" },
          { key: "orders", label: "Orders", kind: "number" },
          { key: "amount", label: "Discount", kind: "money" },
        ]}
        chart={{
          type: "bar",
          x: "reason",
          series: [{ key: "amount", label: "Discount" }],
          horizontal: true,
        }}
        currency={currency}
        fileName={`discounts-by-reason-${range}`}
      />
      <ChartCard
        title="By staff"
        rows={report.by_staff.map((r) => ({
          name: r.name,
          orders: r.orders,
          amount: r.amount,
          price_overrides: r.price_overrides,
        }))}
        columns={[
          { key: "name", label: "Staff" },
          { key: "orders", label: "Orders", kind: "number" },
          { key: "amount", label: "Discount", kind: "money" },
          { key: "price_overrides", label: "Price changes", kind: "money" },
        ]}
        currency={currency}
        fileName={`discounts-by-staff-${range}`}
      />
      {report.total === 0 && report.price_overrides.count === 0 ? (
        <EmptyState>No discounts in these dates.</EmptyState>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Promotions and loyalty
// ---------------------------------------------------------------------------

type PromotionReport = {
  total: number;
  orders: number;
  promotions: {
    id: string;
    name: string;
    coupon_code: string | null;
    uses: number;
    cost: number;
    sales: number;
    average_cost: number;
  }[];
  daily: { date: string; uses: number; cost: number }[];
  loyalty: {
    issued: number;
    redeemed: number;
    reversed: number;
    returned: number;
    redeemed_value: number;
    customers: number;
    orders: number;
    sales: number;
  };
};

export async function PromotionsView({ ctx }: { ctx: ReportsContext }) {
  const supabase = await createClient();
  const [{ data, error }, { data: sales }] = await Promise.all([
    supabase.rpc("report_promotions", {
      p_branch_id: branchArg(ctx.branchId),
      p_from: ctx.from,
      p_to: ctx.to,
    }),
    supabase.rpc("report_sales", {
      p_branch_id: branchArg(ctx.branchId),
      p_from: ctx.from,
      p_to: ctx.to,
    }),
  ]);
  if (error || !data)
    return (
      <div className="flex flex-col gap-5">
        <ReportsNav ctx={ctx} current="/promotions" />
        <ReportError message={error?.message ?? "No report."} />
      </div>
    );
  const report = data as unknown as PromotionReport;
  const salesReport = sales as unknown as SalesReport | null;
  const currency = salesReport?.currency_code ?? null;
  const money = reportMoney(currency);
  const gross = salesReport?.summary.gross_sales ?? 0;
  const l = report.loyalty;
  const range = `${ctx.from}-to-${ctx.to}`;
  return (
    <div className="flex flex-col gap-5">
      <ReportsNav ctx={ctx} current="/promotions" />
      <MixedCurrencies currency={currency} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Promotion cost"
          value={money(report.total)}
          note={`${report.orders} orders${gross ? ` · ${Math.round((report.total / gross) * 1000) / 10}% of sales` : ""}`}
          testId="promotion-cost"
        />
        <Stat
          label="Points spent"
          value={money(l.redeemed_value)}
          note={`${l.redeemed.toLocaleString("en-GB")} points`}
          testId="points-spent"
        />
        <Stat
          label="Points issued"
          value={l.issued.toLocaleString("en-GB")}
          note={`${l.reversed} taken back by refunds · ${l.returned} returned`}
          testId="points-issued"
        />
        <Stat
          label="Loyalty customers"
          value={String(l.customers)}
          note={`${l.orders} orders · ${money(l.sales)}`}
        />
      </div>
      <ChartCard
        title="By promotion"
        rows={report.promotions.map((p) => ({
          name: p.name,
          coupon: p.coupon_code ?? "",
          uses: p.uses,
          cost: p.cost,
          average_cost: p.average_cost,
          sales: p.sales,
        }))}
        columns={[
          { key: "name", label: "Promotion" },
          { key: "coupon", label: "Coupon" },
          { key: "uses", label: "Uses", kind: "number" },
          { key: "cost", label: "Cost", kind: "money" },
          { key: "average_cost", label: "Average per order", kind: "money" },
          { key: "sales", label: "Order sales", kind: "money" },
        ]}
        chart={{
          type: "bar",
          x: "name",
          series: [{ key: "cost", label: "Cost" }],
          horizontal: true,
        }}
        currency={currency}
        fileName={`promotions-${range}`}
        initialView="table"
      />
      <ChartCard
        title="Promotion cost by day"
        rows={report.daily.map((d) => ({
          date: d.date,
          cost: d.cost,
          uses: d.uses,
        }))}
        columns={[
          { key: "date", label: "Date" },
          { key: "cost", label: "Cost", kind: "money" },
          { key: "uses", label: "Uses", kind: "number" },
        ]}
        chart={{
          type: "bar",
          x: "date",
          series: [{ key: "cost", label: "Cost" }],
        }}
        currency={currency}
        fileName={`promotion-cost-by-day-${range}`}
      />
    </div>
  );
}
