"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { ItemSheet } from "@/components/till/item-sheet";
import { Button } from "@/components/ui/button";
import {
  addLine,
  changeQuantity,
  replaceLine,
  type Cart,
  type CartLine,
} from "@/lib/cart";
import {
  canSell,
  indexMenu,
  itemsInCategory,
  type MenuDoc,
  type MenuItem,
} from "@/lib/menu";
import { formatAmount } from "@/lib/money";
import { priceCart, type CartTotals } from "@/lib/pricing";
import { mealOffer, type MealOffer } from "@/lib/upsell";
import { cn } from "@/lib/utils";

const newId = () => crypto.randomUUID();

function describeLine(line: CartLine, menu: ReturnType<typeof indexMenu>) {
  const parts = line.combo
    .map((c) => menu.items.get(c.menuItemId)?.short_name)
    .filter(Boolean);
  const mods = line.modifierIds
    .map((id) => menu.modifiers.get(id)?.name)
    .filter(Boolean);
  return [...parts, ...mods].join(", ");
}

/**
 * The customer's menu and order, for the kiosk (large) and online
 * ordering. Prices shown are a preview; the server works them out again.
 */
export function CustomerMenu({
  menu,
  cart,
  onCart,
  large = false,
  checkout,
}: {
  menu: MenuDoc;
  cart: Cart;
  onCart: (cart: Cart) => void;
  /** Kiosk: bigger text and targets. */
  large?: boolean;
  /** The checkout area under the order, given the totals. */
  checkout: (totals: CartTotals) => React.ReactNode;
}) {
  const index = useMemo(() => indexMenu(menu), [menu]);
  const money = (n: number) => formatAmount(n, menu.currency_code);
  const [category, setCategory] = useState(menu.categories[0]?.id ?? "");
  const [editing, setEditing] = useState<{
    item: MenuItem;
    line?: CartLine;
  } | null>(null);
  const [offer, setOffer] = useState<{
    line: CartLine;
    offer: MealOffer;
  } | null>(null);
  const totals = useMemo(
    () => priceCart(cart, menu, index),
    [cart, menu, index],
  );
  const items = itemsInCategory(menu, category);

  function add(line: CartLine) {
    onCart(addLine(cart, line));
    const meal = mealOffer(line, menu, index);
    if (meal) setOffer({ line, offer: meal });
  }

  function choose(item: MenuItem) {
    if (!canSell(item, index)) return;
    if (item.type === "combo" || item.modifier_groups.length) {
      setEditing({ item });
      return;
    }
    add({
      id: newId(),
      menuItemId: item.id,
      quantity: 1,
      modifierIds: [],
      combo: [],
      notes: "",
    });
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 lg:flex-row",
        large && "text-lg",
      )}
    >
      <section className="flex min-w-0 flex-1 flex-col gap-4" aria-label="Menu">
        <nav
          aria-label="Categories"
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {menu.categories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === category}
              onClick={() => setCategory(c.id)}
              className={cn(
                "shrink-0 rounded-full border px-5 font-medium",
                large ? "min-h-16 text-xl" : "min-h-12",
                c.id === category &&
                  "border-foreground bg-foreground text-background",
              )}
            >
              {c.name}
            </button>
          ))}
        </nav>
        <ul
          className={cn(
            "grid gap-3",
            large
              ? "grid-cols-2 sm:grid-cols-3"
              : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4",
          )}
        >
          {items.map((item) => {
            const available = canSell(item, index);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => choose(item)}
                  disabled={!available}
                  aria-label={`${item.name}, ${money(item.price)}${available ? "" : ", sold out"}`}
                  className="flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card text-left disabled:opacity-50"
                >
                  <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span
                        className="text-4xl font-bold text-muted-foreground"
                        aria-hidden
                      >
                        {item.name.slice(0, 1)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <span className={cn("font-semibold", large && "text-xl")}>
                      {item.name}
                    </span>
                    {item.description ? (
                      <span className="line-clamp-2 text-sm text-muted-foreground">
                        {item.description}
                      </span>
                    ) : null}
                    <span className="mt-auto font-medium tabular-nums">
                      {available ? money(item.price) : "Sold out"}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <aside
        id="your-order"
        aria-label="Your order"
        className="flex flex-col gap-3 rounded-2xl border bg-card p-4 lg:sticky lg:top-4 lg:w-96 lg:self-start"
      >
        <h2 className={cn("font-semibold", large ? "text-2xl" : "text-xl")}>
          Your order
        </h2>
        {cart.lines.length === 0 ? (
          <p className="text-muted-foreground">
            Tap something tasty to add it.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {cart.lines.map((line) => {
              const item = index.items.get(line.menuItemId);
              const price = totals.lines.get(line.id);
              return (
                <li
                  key={line.id}
                  className="flex flex-col gap-2 py-2"
                  data-testid="customer-line"
                >
                  <button
                    type="button"
                    className="text-left"
                    onClick={() => item && setEditing({ item, line })}
                    disabled={
                      !item ||
                      (item.type !== "combo" && !item.modifier_groups.length)
                    }
                  >
                    <span className="flex justify-between gap-2 font-medium">
                      <span>
                        {line.quantity} × {item?.name}
                      </span>
                      <span className="tabular-nums">
                        {money(price?.gross ?? 0)}
                      </span>
                    </span>
                    {describeLine(line, index) ? (
                      <span className="block text-sm text-muted-foreground">
                        {describeLine(line, index)}
                      </span>
                    ) : null}
                  </button>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className={large ? "size-14" : "size-11"}
                      aria-label={`One less ${item?.name}`}
                      onClick={() => onCart(changeQuantity(cart, line.id, -1))}
                    >
                      <MinusIcon />
                    </Button>
                    <span className="w-8 text-center tabular-nums">
                      {line.quantity}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className={large ? "size-14" : "size-11"}
                      aria-label={`One more ${item?.name}`}
                      onClick={() => onCart(changeQuantity(cart, line.id, 1))}
                    >
                      <PlusIcon />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {totals.promotions.map((p) => (
          <div
            key={p.id}
            className="flex justify-between font-medium text-foreground"
          >
            <span>{p.name}</span>
            <span className="tabular-nums">−{money(p.amount)}</span>
          </div>
        ))}
        {totals.taxTotal ? (
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Tax</span>
            <span className="tabular-nums">{money(totals.taxTotal)}</span>
          </div>
        ) : null}
        <div
          className={cn(
            "flex justify-between font-bold",
            large ? "text-3xl" : "text-2xl",
          )}
        >
          <span>Total</span>
          <span className="tabular-nums" data-testid="customer-total">
            {money(totals.total)}
          </span>
        </div>
        {checkout(totals)}
      </aside>

      {editing ? (
        <ItemSheet
          item={editing.item}
          index={index}
          currency={menu.currency_code}
          initial={editing.line}
          newId={newId}
          onClose={() => setEditing(null)}
          onRemove={
            editing.line
              ? () => {
                  onCart(
                    changeQuantity(
                      cart,
                      editing.line!.id,
                      -editing.line!.quantity,
                    ),
                  );
                  setEditing(null);
                }
              : undefined
          }
          onConfirm={(line) => {
            if (editing.line) onCart(replaceLine(cart, line));
            else add(line);
            setEditing(null);
          }}
        />
      ) : null}

      {offer ? (
        <div
          role="dialog"
          aria-label="Make it a meal?"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-lg flex-col gap-3 rounded-2xl border bg-background p-5 shadow-xl"
        >
          <p className={cn("font-semibold", large ? "text-2xl" : "text-xl")}>
            Make it a meal?
          </p>
          <p>
            {offer.offer.combo.name} for {money(offer.offer.extra)} more.
          </p>
          <div className="flex gap-2">
            <Button
              size="lg"
              className={cn("flex-1", large && "h-16 text-xl")}
              onClick={() => {
                // The item may have joined an identical line already there.
                const same = cart.lines.find(
                  (l) =>
                    l.menuItemId === offer.line.menuItemId &&
                    l.combo.length === 0 &&
                    l.modifierIds.join() === offer.line.modifierIds.join(),
                );
                const next = same ? changeQuantity(cart, same.id, -1) : cart;
                onCart(
                  addLine(next, {
                    ...offer.offer.line,
                    id: newId(),
                    quantity: 1,
                    notes: "",
                  }),
                );
                setOffer(null);
              }}
            >
              Yes, make it a meal
            </Button>
            <Button
              size="lg"
              variant="outline"
              className={cn("flex-1", large && "h-16 text-xl")}
              onClick={() => setOffer(null)}
            >
              No thanks
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
