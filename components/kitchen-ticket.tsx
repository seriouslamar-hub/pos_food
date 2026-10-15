import { formatInZone } from "@/lib/datetime";
import { ORDER_TYPE_LABELS, type OrderSummary } from "@/lib/orders";
import type { PaperWidth } from "@/lib/printing";

/**
 * A printed ticket for kitchens without a screen: big order number, short
 * names, choices and notes, no prices.
 */
export function KitchenTicket({
  order,
  paperWidth = 80,
}: {
  order: OrderSummary;
  paperWidth?: PaperWidth;
}) {
  const lines = order.lines.filter((l) => l.status !== "voided");
  return (
    <article
      className="ticket ticket-kitchen"
      data-paper={paperWidth}
      data-testid="kitchen-ticket"
      aria-label={`Kitchen ticket for order ${order.order_number}`}
    >
      <div className="ticket-row ticket-big">
        <span>#{order.order_number}</span>
        <span>{ORDER_TYPE_LABELS[order.order_type]}</span>
      </div>
      <p>
        {formatInZone(
          order.sent_to_kitchen_at ?? order.created_at,
          order.branch.timezone,
          {
            timeStyle: "short",
          },
        )}
        {order.staff_name ? ` · ${order.staff_name}` : ""}
        {order.device_code ? ` · ${order.device_code}` : ""}
      </p>
      {order.paid_at ? null : <p className="ticket-strong">NOT PAID YET</p>}

      <ul className="ticket-rule">
        {lines.map((line) => (
          <li key={line.id} className="ticket-line">
            <p className="ticket-strong">
              {line.quantity} × {line.short_name || line.name}
            </p>
            {line.modifiers.length ? (
              <p className="ticket-indent">
                {line.modifiers.map((m) => m.name).join(", ")}
              </p>
            ) : null}
            {line.components.map((c) => (
              <p key={c.id} className="ticket-indent">
                • {c.short_name || c.name}
                {c.modifiers.length
                  ? ` (${c.modifiers.map((m) => m.name).join(", ")})`
                  : ""}
              </p>
            ))}
            {line.notes ? (
              <p className="ticket-indent ticket-strong">“{line.notes}”</p>
            ) : null}
          </li>
        ))}
      </ul>
      {order.notes ? <p className="ticket-rule">{order.notes}</p> : null}
    </article>
  );
}
