import { formatInZone } from "@/lib/datetime";
import { formatAmount } from "@/lib/money";
import type { PaperWidth } from "@/lib/printing";
import {
  SHIFT_STATUS_LABELS,
  type SalesReport,
  type ShiftSummary,
} from "@/lib/shifts";

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ticket-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * An X report (one shift so far) or Z report (the business day), printed on
 * the till or shown in the back office. The cashier's X report has no
 * expected cash, counted cash or variance: those fields aren't in it.
 */
export function CashReport({
  report,
  paperWidth = 80,
}: {
  report: SalesReport;
  paperWidth?: PaperWidth;
}) {
  const { branch } = report;
  const money = (amount: number) => formatAmount(amount, branch.currency_code);
  const when = (iso: string) => formatInZone(iso, branch.timezone);
  const time = (iso: string) =>
    formatInZone(iso, branch.timezone, { timeStyle: "short" });
  const businessDate = report.day?.business_date ?? report.shift?.business_date;
  // A day still trading has running totals; its Z report comes at close.
  const title =
    report.kind === "x"
      ? "X report"
      : report.day?.status === "open"
        ? "Running totals"
        : "Z report";
  const cash = report.cash;

  return (
    <article
      className="ticket"
      data-paper={paperWidth}
      data-testid={report.kind === "x" ? "x-report" : "z-report"}
      aria-label={title}
    >
      <header className="ticket-center">
        <p className="ticket-shop">{branch.name}</p>
        <p className="ticket-big">{title}</p>
        <p>
          {report.kind === "x"
            ? "Shift so far"
            : report.day?.status === "open"
              ? "Day so far"
              : "End of day"}
        </p>
        {report.shift ? (
          <p>
            {report.shift.staff_name} · Till {report.shift.device_code}
          </p>
        ) : null}
        {businessDate ? (
          <p>
            Business day{" "}
            {formatInZone(`${businessDate}T12:00:00Z`, "UTC", {
              dateStyle: "medium",
            })}
          </p>
        ) : null}
        {report.shift ? <p>Opened {time(report.shift.opened_at)}</p> : null}
        {report.day ? (
          <p>
            Opened {when(report.day.opened_at)}
            {report.day.closed_at
              ? ` · Closed ${when(report.day.closed_at)}`
              : ""}
          </p>
        ) : null}
        <p>Printed {when(report.generated_at)}</p>
      </header>

      <dl className="ticket-rule">
        <Row label="Orders" value={report.orders} />
        <Row label="Gross sales" value={money(report.gross_sales)} />
        {report.discounts ? (
          <Row label="Discounts" value={`−${money(report.discounts)}`} />
        ) : null}
        <Row label="Tax" value={money(report.tax)} />
        <div className="ticket-row ticket-strong">
          <dt>Net sales</dt>
          <dd>{money(report.net_sales)}</dd>
        </div>
        <Row label="Average order" value={money(report.average_order)} />
      </dl>

      <dl className="ticket-rule">
        <p className="ticket-strong">Payments</p>
        {report.payments.length ? (
          report.payments.map((p) => (
            <Row
              key={`${p.method}-${p.name}`}
              label={`${p.name} (${p.count})`}
              value={money(p.amount)}
            />
          ))
        ) : (
          <p>None yet</p>
        )}
      </dl>

      <dl className="ticket-rule">
        <Row
          label={`Voids (${report.voids.count})`}
          value={money(report.voids.amount)}
        />
        <Row
          label={`Refunds (${report.refunds.count})`}
          value={money(report.refunds.amount)}
        />
        {report.unpaid_orders.count ? (
          <Row
            label={`Unpaid orders (${report.unpaid_orders.count})`}
            value={money(report.unpaid_orders.amount)}
          />
        ) : null}
      </dl>

      <div className="ticket-rule">
        <div className="ticket-row ticket-strong">
          <span>Items sold</span>
          <span>{report.items_sold}</span>
        </div>
        <ul>
          {report.items.map((item) => (
            <li key={item.name} className="ticket-row ticket-indent">
              <span>
                {item.quantity} × {item.name}
              </span>
              <span>{money(item.amount)}</span>
            </li>
          ))}
        </ul>
      </div>

      <dl className="ticket-rule">
        <p className="ticket-strong">Cash</p>
        <Row label="Float" value={money(cash.opening_float)} />
        {cash.cash_sales !== undefined ? (
          <Row label="Cash sales" value={money(cash.cash_sales)} />
        ) : null}
        {cash.cash_refunds ? (
          <Row label="Cash refunds" value={`−${money(cash.cash_refunds)}`} />
        ) : null}
        {cash.paid_in ? (
          <Row label="Paid in" value={money(cash.paid_in)} />
        ) : null}
        {cash.paid_out ? (
          <Row label="Paid out" value={`−${money(cash.paid_out)}`} />
        ) : null}
        {cash.drops ? (
          <Row label="Cash drops" value={`−${money(cash.drops)}`} />
        ) : null}
        {cash.no_sales ? <Row label="No sales" value={cash.no_sales} /> : null}
        {cash.expected !== undefined ? (
          <Row label="Expected" value={money(cash.expected)} />
        ) : null}
        {cash.counted !== undefined && cash.counted !== null ? (
          <Row label="Counted" value={money(cash.counted)} />
        ) : null}
        {cash.variance !== undefined && cash.variance !== null ? (
          <div className="ticket-row ticket-strong">
            <dt>Difference</dt>
            <dd>
              {cash.variance > 0 ? "+" : ""}
              {money(cash.variance)}
            </dd>
          </div>
        ) : null}
      </dl>

      {report.shifts?.length ? (
        <div className="ticket-rule">
          <p className="ticket-strong">Shifts</p>
          <ul>
            {report.shifts.map((s) => (
              <li key={s.id} className="ticket-line">
                <p>
                  {s.staff_name} · Till {s.device_code} ·{" "}
                  {SHIFT_STATUS_LABELS[s.status]}
                </p>
                {s.cash.counted !== null ? (
                  <p className="ticket-indent">
                    Expected {money(s.cash.expected)} · Counted{" "}
                    {money(s.cash.counted)} · {s.cash.variance! > 0 ? "+" : ""}
                    {money(s.cash.variance ?? 0)}
                  </p>
                ) : (
                  <p className="ticket-indent">Still open</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

/** Printed when a cashier closes their shift, to go in the cash bag. */
export function ShiftCloseSlip({
  shift,
  count,
  branch,
  paperWidth = 80,
}: {
  shift: ShiftSummary;
  count: Record<string, number>;
  branch: { name: string; currency_code: string; timezone: string };
  paperWidth?: PaperWidth;
}) {
  const money = (amount: number) => formatAmount(amount, branch.currency_code);
  const lines = Object.entries(count)
    .map(([value, n]) => ({ value: Number(value), n }))
    .filter((l) => l.n > 0)
    .sort((a, b) => b.value - a.value);
  return (
    <article
      className="ticket"
      data-paper={paperWidth}
      data-testid="shift-close-slip"
      aria-label="Shift closed"
    >
      <header className="ticket-center">
        <p className="ticket-shop">{branch.name}</p>
        <p className="ticket-big">Shift closed</p>
        <p>
          {shift.staff_name} · Till {shift.device_code}
        </p>
        {shift.closed_at ? (
          <p>{formatInZone(shift.closed_at, branch.timezone)}</p>
        ) : null}
      </header>
      <dl className="ticket-rule">
        {lines.map((l) => (
          <Row
            key={l.value}
            label={`${l.n} × ${money(l.value)}`}
            value={money(l.n * l.value)}
          />
        ))}
        <div className="ticket-row ticket-strong">
          <dt>Counted</dt>
          <dd>{money(shift.counted_cash ?? 0)}</dd>
        </div>
      </dl>
      <p className="ticket-rule">Signed: ____________________</p>
    </article>
  );
}
