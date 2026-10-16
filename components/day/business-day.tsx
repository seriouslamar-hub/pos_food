import Link from "next/link";
import { EmptyState } from "@/components/admin/page";
import { CashReport } from "@/components/cash-report";
import { Badge } from "@/components/ui/badge";
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
import { toPaperWidth } from "@/lib/printing";
import { getSetting } from "@/lib/settings.server";
import {
  isVarianceAlert,
  parseReport,
  SHIFT_STATUS_LABELS,
  type DaySummary,
  type ManagerShift,
} from "@/lib/shifts";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { DayControl, PrintReport, ShiftReview } from "./day-actions";

/** A business date (no time) for people, e.g. "16 Oct 2026". */
function formatDate(date: string) {
  return formatInZone(`${date}T12:00:00Z`, "UTC", { dateStyle: "medium" });
}

function signed(amount: number, currency: string) {
  return `${amount > 0 ? "+" : ""}${formatAmount(amount, currency)}`;
}

/**
 * A branch's business days for managers: open or close today, reconcile each
 * shift's cash, and read or print the Z report.
 */
export async function BusinessDay({
  branchId,
  selectedDayId,
  dayHref,
}: {
  branchId: string;
  selectedDayId?: string;
  /** The page URL showing one day. */
  dayHref: (dayId: string) => string;
}) {
  const supabase = await createClient();
  const [{ data: branch }, { data: days }, alertAt, paperWidth] =
    await Promise.all([
      supabase
        .from("branches")
        .select("name, currency_code, timezone")
        .eq("id", branchId)
        .single(),
      supabase
        .from("business_days")
        .select(
          "id, business_date, status, net_sales:z_report->net_sales, orders:z_report->orders",
        )
        .eq("branch_id", branchId)
        .order("business_date", { ascending: false })
        .limit(30),
      getSetting(supabase, "cash.variance_alert", branchId),
      getSetting(supabase, "receipt.paper_width_mm", branchId),
    ]);
  if (!branch) return <EmptyState>That branch doesn&apos;t exist.</EmptyState>;

  const currency = branch.currency_code;
  const money = (amount: number) => formatAmount(amount, currency);
  const time = (iso: string) =>
    formatInZone(iso, branch.timezone, { timeStyle: "short" });
  const openDay = days?.find((d) => d.status === "open") ?? null;
  const selected =
    days?.find((d) => d.id === selectedDayId) ?? openDay ?? days?.[0] ?? null;

  const [{ data: detailJson }, { count: openShifts }] = await Promise.all([
    selected
      ? supabase.rpc("get_day_report", { p_day_id: selected.id })
      : Promise.resolve({ data: null }),
    openDay
      ? supabase
          .from("shifts")
          .select("id", { count: "exact", head: true })
          .eq("business_day_id", openDay.id)
          .eq("status", "open")
      : Promise.resolve({ count: 0 }),
  ]);
  const detail = detailJson as {
    day: DaySummary;
    report: unknown;
    shifts: ManagerShift[];
  } | null;
  const report = detail ? parseReport(detail.report) : null;
  const variance = detail?.shifts.reduce(
    (sum, s) => sum + (s.cash.variance ?? 0),
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold" data-testid="day-status">
            {openDay
              ? `Open: ${formatDate(openDay.business_date)}`
              : "No business day is open"}
          </h2>
          <p className="text-muted-foreground">
            {openDay
              ? "Tills can sell. Close the day once every shift is counted and closed."
              : "Tills can't sell until the day is opened."}
          </p>
        </div>
        <DayControl
          branchId={branchId}
          dayOpen={openDay !== null}
          openShifts={openShifts ?? 0}
        />
      </section>

      {detail && report && selected ? (
        <section className="flex flex-col gap-4" aria-label="Business day">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              {formatDate(detail.day.business_date)}
              <Badge
                variant={detail.day.status === "open" ? "default" : "outline"}
              >
                {detail.day.status === "open" ? "Open" : "Closed"}
              </Badge>
            </h2>
            <PrintReport
              report={report}
              paperWidth={toPaperWidth(paperWidth)}
              label={
                detail.day.status === "closed"
                  ? "Print Z report"
                  : "Print running totals"
              }
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Opened {formatInZone(detail.day.opened_at, branch.timezone)}
            {detail.day.opened_by_name
              ? ` by ${detail.day.opened_by_name}`
              : ""}
            {detail.day.closed_at
              ? ` · Closed ${formatInZone(detail.day.closed_at, branch.timezone)}${detail.day.closed_by_name ? ` by ${detail.day.closed_by_name}` : ""}`
              : ""}
          </p>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Net sales", value: money(report.net_sales) },
              { label: "Orders", value: String(report.orders) },
              { label: "Average order", value: money(report.average_order) },
              {
                label: "Cash difference",
                value: signed(variance ?? 0, currency),
                alert: isVarianceAlert(variance, Number(alertAt)),
              },
            ].map((tile) => (
              <div key={tile.label} className="rounded-xl border p-3">
                <dt className="text-sm text-muted-foreground">{tile.label}</dt>
                <dd
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    tile.alert && "text-destructive",
                  )}
                >
                  {tile.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">Shifts</h3>
            {detail.shifts.length === 0 ? (
              <EmptyState>No shifts were opened this day.</EmptyState>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cashier</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead className="text-right">Float</TableHead>
                      <TableHead className="text-right">Expected</TableHead>
                      <TableHead className="text-right">Counted</TableHead>
                      <TableHead className="text-right">Difference</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.shifts.map((s) => {
                      const alert = isVarianceAlert(
                        s.cash.variance,
                        Number(alertAt),
                      );
                      return (
                        <TableRow key={s.id} data-testid="day-shift">
                          <TableCell>
                            <span className="font-medium">{s.staff_name}</span>
                            <span className="block text-xs text-muted-foreground">
                              Till {s.device_code}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {time(s.opened_at)}–
                            {s.closed_at ? time(s.closed_at) : "now"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(s.cash.opening_float)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(s.cash.expected)}
                            {s.status === "open" ? (
                              <span className="block text-xs text-muted-foreground">
                                so far
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {s.cash.counted === null
                              ? "–"
                              : money(s.cash.counted)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              alert && "font-semibold text-destructive",
                            )}
                            data-alert={alert || undefined}
                          >
                            {s.cash.variance === null
                              ? "–"
                              : signed(s.cash.variance, currency)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-2">
                              <span>
                                <Badge
                                  variant={
                                    s.status === "flagged"
                                      ? "destructive"
                                      : s.status === "approved"
                                        ? "secondary"
                                        : "outline"
                                  }
                                >
                                  {SHIFT_STATUS_LABELS[s.status]}
                                </Badge>
                                {s.reviewed_by_name ? (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    by {s.reviewed_by_name}
                                  </span>
                                ) : null}
                              </span>
                              {s.review_note ? (
                                <span className="text-sm">{s.review_note}</span>
                              ) : null}
                              {s.status !== "open" ? (
                                <ShiftReview
                                  shiftId={s.id}
                                  staffName={s.staff_name}
                                />
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Differences over {money(Number(alertAt))} are highlighted. Change
              this in Settings.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">
              {detail.day.status === "closed"
                ? "Z report"
                : "Running totals (the Z report is made when the day closes)"}
            </h3>
            <div className="w-fit rounded-xl border bg-white p-4 shadow-sm">
              <CashReport report={report} />
            </div>
          </div>
        </section>
      ) : (
        <EmptyState>No business days yet. Open the first one above.</EmptyState>
      )}

      {days && days.length > 1 ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">Recent days</h3>
          <ul className="divide-y rounded-xl border">
            {days.map((d) => (
              <li key={d.id}>
                <Link
                  href={dayHref(d.id)}
                  aria-current={d.id === selected?.id ? "page" : undefined}
                  className={cn(
                    "flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted",
                    d.id === selected?.id && "bg-muted font-medium",
                  )}
                >
                  <span>
                    {formatDate(d.business_date)}{" "}
                    <span className="text-sm text-muted-foreground">
                      {d.status === "open" ? "open" : "closed"}
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {typeof d.orders === "number"
                      ? `${d.orders} orders · `
                      : ""}
                    {typeof d.net_sales === "number" ? money(d.net_sales) : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
