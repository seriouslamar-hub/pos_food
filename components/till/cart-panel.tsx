"use client";

import { EllipsisIcon, MinusIcon, PlusIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Cart, CartLine, OrderType } from "@/lib/cart";
import type { MenuIndex } from "@/lib/menu";
import { formatAmount } from "@/lib/money";
import { describeDiscount, ORDER_TYPE_LABELS } from "@/lib/orders";
import { unitPrice, type CartTotals } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/** The right-hand side of the till: order type, lines, totals and actions. */
export function CartPanel({
  cart,
  index,
  currency,
  totals,
  heldCount,
  busy,
  error,
  onOrderType,
  onCustomer,
  onEdit,
  onQuantity,
  onHold,
  onRecall,
  onClear,
  onCharge,
  onSendToKitchen,
  onLineOptions,
  onOrderDiscount,
  onLoyalty,
  onCoupon,
}: {
  cart: Cart;
  index: MenuIndex;
  currency: string;
  totals: CartTotals;
  heldCount: number;
  busy: boolean;
  error: string | null;
  onOrderType: (type: OrderType) => void;
  onCustomer: (
    patch: Partial<Pick<Cart, "customerPhone" | "deliveryAddress">>,
  ) => void;
  onEdit: (line: CartLine) => void;
  onQuantity: (lineId: string, delta: number) => void;
  onHold: () => void;
  onRecall: () => void;
  onClear: () => void;
  onCharge: () => void;
  /** Pay-later dine-in is on: send the order to the kitchen unpaid. */
  onSendToKitchen?: () => void;
  /** Discount or price for one line. */
  onLineOptions: (line: CartLine) => void;
  onOrderDiscount: () => void;
  /** Find or change the loyalty customer (online only). */
  onLoyalty?: () => void;
  onCoupon?: () => void;
}) {
  const money = (amount: number) => formatAmount(amount, currency);
  const empty = cart.lines.length === 0;
  const exclusiveTax = totals.taxes
    .filter((t) => !t.inclusive)
    .reduce((s, t) => s + t.amount, 0);
  const inclusiveTax = totals.taxTotal - exclusiveTax;
  const deliveryMissing =
    cart.orderType === "delivery" &&
    (!cart.customerPhone.trim() || !cart.deliveryAddress.trim());
  const cannotSend =
    empty || busy || totals.problems.length > 0 || deliveryMissing;

  return (
    <aside
      aria-label="Current order"
      className="flex min-h-0 w-[26rem] shrink-0 flex-col border-l bg-card"
    >
      <div
        role="radiogroup"
        aria-label="Order type"
        className="grid grid-cols-3 gap-2 border-b p-3"
      >
        {(Object.keys(ORDER_TYPE_LABELS) as OrderType[]).map((type) => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={cart.orderType === type}
            onClick={() => onOrderType(type)}
            className={cn(
              "min-h-12 rounded-xl text-base font-medium",
              cart.orderType === type
                ? "bg-foreground text-background"
                : "bg-muted",
            )}
          >
            {ORDER_TYPE_LABELS[type]}
          </button>
        ))}
      </div>
      {cart.orderType === "delivery" ? (
        <div className="flex flex-col gap-2 border-b p-3">
          <Input
            aria-label="Customer phone"
            placeholder="Customer phone"
            inputMode="tel"
            value={cart.customerPhone}
            onChange={(e) => onCustomer({ customerPhone: e.target.value })}
            className="h-12 text-base"
          />
          <Input
            aria-label="Delivery address"
            placeholder="Delivery address"
            value={cart.deliveryAddress}
            onChange={(e) => onCustomer({ deliveryAddress: e.target.value })}
            className="h-12 text-base"
          />
        </div>
      ) : null}

      <ol
        aria-label="Order lines"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {empty ? (
          <li className="p-6 text-center text-muted-foreground">
            Tap an item to start an order.
          </li>
        ) : (
          cart.lines.map((line) => {
            const item = index.items.get(line.menuItemId);
            const price = totals.lines.get(line.id);
            const parts = line.combo.map((c) => {
              const part = index.items.get(c.menuItemId)?.name ?? "?";
              const mods = c.modifierIds
                .map((id) => index.modifiers.get(id)?.name)
                .filter(Boolean);
              return mods.length ? `${part} (${mods.join(", ")})` : part;
            });
            const mods = line.modifierIds
              .map((id) => index.modifiers.get(id)?.name)
              .filter(Boolean);
            const problem = price?.problems[0];
            return (
              <li
                key={line.id}
                className="flex items-start gap-2 border-b px-3 py-2"
                data-testid="cart-line"
              >
                <button
                  type="button"
                  onClick={() => onEdit(line)}
                  className="flex min-h-12 flex-1 flex-col items-start rounded-lg px-1 text-left hover:bg-muted"
                >
                  <span className="text-base font-semibold">
                    {line.quantity} × {item?.name ?? "Removed item"}
                  </span>
                  {[...mods, ...parts].length ? (
                    <span className="text-sm text-muted-foreground">
                      {[...mods, ...parts].join(", ")}
                    </span>
                  ) : null}
                  {line.notes ? (
                    <span className="text-sm italic">“{line.notes}”</span>
                  ) : null}
                  {line.price ? (
                    <span className="text-sm" data-testid="line-price-change">
                      {money(line.price.unitPrice)} each (menu{" "}
                      {money(unitPrice(line, index) ?? 0)}) ·{" "}
                      {line.price.reason}
                    </span>
                  ) : null}
                  {line.discount && price ? (
                    <span
                      className="text-sm font-medium text-foreground"
                      data-testid="line-discount"
                    >
                      {describeDiscount(line.discount, money)} off (
                      {line.discount.reason}) −
                      {money(price.discount - price.orderDiscountShare)}
                    </span>
                  ) : null}
                  {problem ? (
                    <span className="text-sm font-medium text-destructive">
                      {problem}
                    </span>
                  ) : null}
                </button>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-base tabular-nums">
                    {formatAmount(price?.gross ?? 0, currency)}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      className="size-11"
                      aria-label={`Discount or price for ${item?.name ?? ""}`}
                      disabled={!item}
                      onClick={() => onLineOptions(line)}
                    >
                      <EllipsisIcon />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-lg"
                      className="size-11"
                      aria-label={`One less ${item?.name ?? ""}`}
                      onClick={() => onQuantity(line.id, -1)}
                    >
                      <MinusIcon />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-lg"
                      className="size-11"
                      aria-label={`One more ${item?.name ?? ""}`}
                      onClick={() => onQuantity(line.id, 1)}
                    >
                      <PlusIcon />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ol>

      <div className="flex flex-col gap-2 border-t p-3">
        <dl className="flex flex-col gap-1 text-base">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">
              {formatAmount(totals.subtotal, currency)}
            </dd>
          </div>
          {totals.staffDiscountTotal ? (
            <div
              className="flex justify-between font-medium text-foreground"
              data-testid="cart-discounts"
            >
              <dt>
                Discounts
                {cart.discount
                  ? ` (order ${describeDiscount(cart.discount, money)})`
                  : ""}
              </dt>
              <dd className="tabular-nums">
                −{money(totals.staffDiscountTotal)}
              </dd>
            </div>
          ) : null}
          {totals.promotions.map((p) => (
            <div
              key={p.id}
              className="flex justify-between font-medium text-foreground"
              data-testid="cart-promotion"
            >
              <dt>{p.name}</dt>
              <dd className="tabular-nums">−{money(p.amount)}</dd>
            </div>
          ))}
          {cart.coupon &&
          !totals.promotions.some((p) => p.id === cart.coupon!.promotion.id) ? (
            <div className="flex justify-between text-sm text-muted-foreground">
              <dt>Coupon {cart.coupon.code}</dt>
              <dd>doesn&apos;t apply to this order yet</dd>
            </div>
          ) : null}
          {totals.loyaltyDiscount ? (
            <div
              className="flex justify-between font-medium text-foreground"
              data-testid="cart-points"
            >
              <dt>Points ({totals.loyaltyPoints})</dt>
              <dd className="tabular-nums">−{money(totals.loyaltyDiscount)}</dd>
            </div>
          ) : null}
          {exclusiveTax ? (
            <div className="flex justify-between">
              <dt>Tax</dt>
              <dd className="tabular-nums">
                {formatAmount(exclusiveTax, currency)}
              </dd>
            </div>
          ) : null}
          {inclusiveTax ? (
            <div className="flex justify-between text-sm text-muted-foreground">
              <dt>Includes tax</dt>
              <dd className="tabular-nums">
                {formatAmount(inclusiveTax, currency)}
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between text-2xl font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums" data-testid="cart-total">
              {formatAmount(totals.total, currency)}
            </dd>
          </div>
        </dl>
        {onLoyalty || onCoupon || cart.customer ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="touch"
              className="min-w-0 px-2"
              disabled={busy || !onLoyalty}
              onClick={onLoyalty}
              data-testid="loyalty-button"
            >
              <span className="truncate">
                {cart.customer
                  ? `${cart.customer.name ?? cart.customer.phone} · ${cart.customer.pointsBalance - totals.loyaltyPoints} pts`
                  : "Customer"}
              </span>
            </Button>
            <Button
              variant="outline"
              size="touch"
              className="min-w-0 px-2"
              disabled={busy || !onCoupon}
              onClick={onCoupon}
            >
              <span className="truncate">
                {cart.coupon ? `Coupon ${cart.coupon.code}` : "Coupon"}
              </span>
            </Button>
          </div>
        ) : null}
        {cart.customer && totals.pointsToEarn ? (
          <p className="text-sm text-muted-foreground">
            Earns {totals.pointsToEarn} points when paid.
          </p>
        ) : null}
        {error ? (
          <Alert variant="destructive" aria-live="polite">
            <AlertDescription className="text-base" data-testid="cart-error">
              {error}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="grid grid-cols-4 gap-2">
          <Button
            variant="outline"
            size="touch"
            className="px-2"
            disabled={empty || busy}
            onClick={onHold}
          >
            Hold
          </Button>
          <Button
            variant="outline"
            size="touch"
            className="px-2"
            disabled={busy}
            onClick={onRecall}
          >
            Recall{heldCount ? ` (${heldCount})` : ""}
          </Button>
          <Button
            variant="outline"
            size="touch"
            className="px-2"
            disabled={empty || busy}
            onClick={onOrderDiscount}
          >
            Discount
          </Button>
          <Button
            variant="outline"
            size="touch"
            className="px-2"
            disabled={empty || busy}
            onClick={onClear}
          >
            Clear
          </Button>
        </div>
        {onSendToKitchen && cart.orderType === "dine_in" ? (
          <Button
            variant="secondary"
            size="touch"
            disabled={cannotSend}
            onClick={onSendToKitchen}
          >
            Send to kitchen, pay later
          </Button>
        ) : null}
        <Button
          size="touch"
          className="h-16 text-xl"
          disabled={cannotSend}
          onClick={onCharge}
        >
          {busy ? "Sending…" : `Charge ${formatAmount(totals.total, currency)}`}
        </Button>
        {deliveryMissing && !empty ? (
          <p className="text-sm text-muted-foreground">
            Add the customer&apos;s phone and address for delivery.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
