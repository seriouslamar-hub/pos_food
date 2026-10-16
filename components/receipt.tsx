import { formatInZone } from "@/lib/datetime";
import { formatAmount } from "@/lib/money";
import {
  ORDER_TYPE_LABELS,
  staffLineDiscount,
  type OrderSummary,
} from "@/lib/orders";
import { bpsToPercentInput } from "@/lib/percent";
import type { PaperWidth } from "@/lib/printing";

/**
 * A customer receipt, sized for 80 mm or 58 mm thermal paper (see .ticket in
 * globals.css). Everything on it comes from the saved order, so a reprint
 * shows exactly what was charged.
 */
export function Receipt({
  order,
  paperWidth = 80,
  copy = false,
}: {
  order: OrderSummary;
  paperWidth?: PaperWidth;
  copy?: boolean;
}) {
  const { branch } = order;
  const money = (amount: number) => formatAmount(amount, branch.currency_code);
  // Voided lines weren't charged; refunded ones were, and say so.
  const lines = order.lines.filter(
    (l) => l.status !== "voided" || l.refunded_at !== null,
  );
  const payments = order.payments;
  const orderDiscount = order.lines.reduce(
    (sum, l) =>
      sum +
      (l.status === "voided" && !l.refunded_at ? 0 : l.order_discount_share),
    0,
  );

  return (
    <article
      className="ticket"
      data-paper={paperWidth}
      data-testid="receipt"
      aria-label={`Receipt for order ${order.order_number}`}
    >
      <header className="ticket-center">
        {branch.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branch.logo_url} alt="" className="ticket-logo" />
        ) : null}
        <p className="ticket-shop">{branch.name}</p>
        {branch.address ? <p>{branch.address}</p> : null}
        {branch.phone ? <p>Tel {branch.phone}</p> : null}
        {branch.receipt_header ? (
          <p className="ticket-pre">{branch.receipt_header}</p>
        ) : null}
      </header>

      <div className="ticket-center ticket-rule">
        {copy ? <p className="ticket-strong">COPY</p> : null}
        <p className="ticket-big">Order {order.order_number}</p>
        <p>{ORDER_TYPE_LABELS[order.order_type]}</p>
        {order.paid_at ? null : <p className="ticket-strong">NOT PAID</p>}
      </div>
      <p>{formatInZone(order.paid_at ?? order.created_at, branch.timezone)}</p>
      {order.staff_name ? (
        <p>
          Served by {order.staff_name}
          {order.device_code ? ` · Till ${order.device_code}` : ""}
        </p>
      ) : null}
      {order.order_type === "delivery" ? (
        <p>
          Deliver to {order.delivery_address} · {order.customer_phone}
        </p>
      ) : null}

      <ul className="ticket-rule">
        {lines.map((line) => (
          <li key={line.id} className="ticket-line">
            <div className="ticket-row">
              <span>
                {line.quantity} × {line.name}
              </span>
              <span>{money(line.line_subtotal)}</span>
            </div>
            {line.modifiers.map((m) => (
              <p key={m.id} className="ticket-indent">
                {m.name}
                {m.price_delta
                  ? ` (${m.price_delta > 0 ? "+" : ""}${money(m.price_delta)})`
                  : ""}
              </p>
            ))}
            {line.components.map((c) => (
              <p key={c.id} className="ticket-indent">
                {c.name}
                {c.modifiers.length
                  ? ` (${c.modifiers.map((m) => m.name).join(", ")})`
                  : ""}
              </p>
            ))}
            {line.notes ? (
              <p className="ticket-indent">“{line.notes}”</p>
            ) : null}
            {line.price_override_from !== null ? (
              <p className="ticket-indent">
                Price changed from {money(line.price_override_from)}
                {line.price_override_reason
                  ? ` (${line.price_override_reason})`
                  : ""}
              </p>
            ) : null}
            {staffLineDiscount(line) > 0 ? (
              <div className="ticket-row ticket-indent">
                <span>
                  Discount
                  {line.discount ? ` (${line.discount.reason})` : ""}
                </span>
                <span>−{money(staffLineDiscount(line))}</span>
              </div>
            ) : null}
            {line.refunded_at ? (
              <p className="ticket-indent ticket-strong">Refunded</p>
            ) : null}
          </li>
        ))}
      </ul>

      <dl className="ticket-rule">
        <div className="ticket-row">
          <dt>Subtotal</dt>
          <dd>{money(order.subtotal)}</dd>
        </div>
        {orderDiscount ? (
          <div className="ticket-row">
            <dt>
              Order discount
              {order.discount ? ` (${order.discount.reason})` : ""}
            </dt>
            <dd>−{money(orderDiscount)}</dd>
          </div>
        ) : null}
        {(order.promotions ?? []).map((p) => (
          <div key={p.id} className="ticket-row">
            <dt>{p.name}</dt>
            <dd>−{money(p.amount)}</dd>
          </div>
        ))}
        {order.loyalty?.discount ? (
          <div className="ticket-row">
            <dt>Points ({order.loyalty.points_redeemed})</dt>
            <dd>−{money(order.loyalty.discount)}</dd>
          </div>
        ) : null}
        {order.taxes.map((t) => (
          <div
            key={`${t.name}-${t.rate_bps}-${t.inclusive}`}
            className="ticket-row"
          >
            <dt>
              {t.inclusive ? "Includes " : ""}
              {t.name} {bpsToPercentInput(t.rate_bps)}%
            </dt>
            <dd>{money(t.amount)}</dd>
          </div>
        ))}
        <div className="ticket-row ticket-big">
          <dt>Total</dt>
          <dd>{money(order.total)}</dd>
        </div>
      </dl>

      {payments.length ? (
        <dl className="ticket-rule">
          {payments.map((p) => (
            <div key={p.id}>
              <div className="ticket-row">
                <dt>{p.method_name}</dt>
                <dd>{money(p.tendered ?? p.amount)}</dd>
              </div>
              {p.reference ? (
                <p className="ticket-indent">Ref {p.reference}</p>
              ) : null}
            </div>
          ))}
          {order.change_given ? (
            <div className="ticket-row ticket-strong">
              <dt>Change</dt>
              <dd>{money(order.change_given)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {order.refunds.length ? (
        <dl className="ticket-rule">
          {order.refunds.map((r) => (
            <div key={r.id}>
              <div className="ticket-row ticket-strong">
                <dt>Refund · {r.method_name}</dt>
                <dd>−{money(r.amount)}</dd>
              </div>
              <p className="ticket-indent">{r.reason}</p>
            </div>
          ))}
        </dl>
      ) : null}

      {order.customer ? (
        <p className="ticket-center ticket-rule" data-testid="receipt-points">
          {order.customer.name ?? "Rewards"}:{" "}
          {order.loyalty?.points_earned
            ? `${order.loyalty.points_earned} points earned. `
            : ""}
          Balance {order.customer.points_balance} points
        </p>
      ) : null}

      {branch.receipt_footer ? (
        <p className="ticket-center ticket-pre ticket-rule">
          {branch.receipt_footer}
        </p>
      ) : null}
    </article>
  );
}

/** Printed when money goes back: for the customer, or the cash bag. */
export function RefundSlip({
  order,
  refundId,
  paperWidth = 80,
}: {
  order: OrderSummary;
  refundId: string;
  paperWidth?: PaperWidth;
}) {
  const { branch } = order;
  const money = (amount: number) => formatAmount(amount, branch.currency_code);
  const refund = order.refunds.find((r) => r.id === refundId);
  if (!refund) return null;
  const lines = order.lines.filter((l) => refund.line_ids.includes(l.id));
  return (
    <article
      className="ticket"
      data-paper={paperWidth}
      data-testid="refund-slip"
      aria-label={`Refund for order ${order.order_number}`}
    >
      <header className="ticket-center">
        <p className="ticket-shop">{branch.name}</p>
        <p className="ticket-big">Refund</p>
        <p>Order {order.order_number}</p>
        <p>{formatInZone(refund.created_at, branch.timezone)}</p>
      </header>
      <ul className="ticket-rule">
        {lines.map((l) => (
          <li key={l.id} className="ticket-row">
            <span>
              {l.quantity} × {l.name}
            </span>
            <span>{money(l.line_total)}</span>
          </li>
        ))}
      </ul>
      <dl className="ticket-rule">
        <div className="ticket-row ticket-big">
          <dt>Refunded</dt>
          <dd>{money(refund.amount)}</dd>
        </div>
        <div className="ticket-row">
          <dt>By</dt>
          <dd>{refund.method_name}</dd>
        </div>
        {refund.reference ? (
          <p className="ticket-indent">Ref {refund.reference}</p>
        ) : null}
        <p>Reason: {refund.reason}</p>
        {refund.staff_name ? <p>Refunded by {refund.staff_name}</p> : null}
        {refund.approved_by_name ? (
          <p>Approved by {refund.approved_by_name}</p>
        ) : null}
      </dl>
      <p className="ticket-rule">Customer signature: ______________</p>
    </article>
  );
}
