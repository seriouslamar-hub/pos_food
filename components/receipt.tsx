import { formatInZone } from "@/lib/datetime";
import { formatAmount } from "@/lib/money";
import { ORDER_TYPE_LABELS, type OrderSummary } from "@/lib/orders";
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
  const lines = order.lines.filter((l) => l.status !== "voided");
  const payments = order.payments.filter((p) => p.status === "captured");

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
            {line.line_discount ? (
              <div className="ticket-row ticket-indent">
                <span>Discount</span>
                <span>−{money(line.line_discount)}</span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <dl className="ticket-rule">
        <div className="ticket-row">
          <dt>Subtotal</dt>
          <dd>{money(order.subtotal)}</dd>
        </div>
        {order.discount_total ? (
          <div className="ticket-row">
            <dt>Discounts</dt>
            <dd>−{money(order.discount_total)}</dd>
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

      {branch.receipt_footer ? (
        <p className="ticket-center ticket-pre ticket-rule">
          {branch.receipt_footer}
        </p>
      ) : null}
    </article>
  );
}
