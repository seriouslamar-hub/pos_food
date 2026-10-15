"use client";

import { useMemo, useState } from "react";
import {
  canSell,
  indexMenu,
  itemsInCategory,
  type MenuDoc,
  type MenuItem,
} from "@/lib/menu";
import { formatAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Category tabs and a grid of big item tiles, as on the till. */
export function MenuGrid({
  menu,
  onSelect,
}: {
  menu: MenuDoc;
  onSelect?: (item: MenuItem) => void;
}) {
  const index = useMemo(() => indexMenu(menu), [menu]);
  const [chosen, setChosen] = useState<string | null>(null);
  const categoryId = menu.categories.some((c) => c.id === chosen)
    ? chosen
    : (menu.categories[0]?.id ?? null);
  const items = categoryId ? itemsInCategory(menu, categoryId) : [];

  if (!menu.categories.length) {
    return (
      <p className="text-muted-foreground">
        The menu is empty. An admin can add items in the back office.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        role="tablist"
        aria-label="Menu categories"
        className="flex shrink-0 gap-2 overflow-x-auto pb-1"
      >
        {menu.categories.map((c) => {
          const selected = c.id === categoryId;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setChosen(c.id)}
              className={cn(
                "flex min-h-14 shrink-0 items-center gap-2 rounded-xl px-5 text-lg font-medium transition-colors",
                selected
                  ? "bg-foreground text-background"
                  : "bg-muted hover:bg-muted/70",
              )}
            >
              {c.colour ? (
                <span
                  aria-hidden
                  className="size-3 rounded-full"
                  style={{ backgroundColor: c.colour }}
                />
              ) : null}
              {c.name}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        className="grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-3 overflow-y-auto pb-2 xl:grid-cols-4"
      >
        {items.map((item) => (
          <MenuTile
            key={item.id}
            item={item}
            currency={menu.currency_code}
            sellable={canSell(item, index)}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

export function MenuTile({
  item,
  currency,
  sellable,
  onSelect,
}: {
  item: Pick<MenuItem, "id" | "name" | "price" | "image_url" | "type">;
  currency: string;
  sellable: boolean;
  onSelect?: (item: MenuItem) => void;
}) {
  const price = formatAmount(item.price, currency);
  return (
    <button
      type="button"
      data-testid={`menu-item-${item.id}`}
      data-available={sellable}
      disabled={!sellable}
      aria-label={`${item.name}, ${price}${sellable ? "" : ", out of stock"}`}
      onClick={() => onSelect?.(item as MenuItem)}
      className={cn(
        "flex min-h-28 flex-col justify-between gap-2 rounded-xl border-2 p-3 text-left transition-colors",
        sellable
          ? "bg-card hover:border-foreground/30 active:bg-muted"
          : "cursor-not-allowed border-dashed bg-muted text-muted-foreground",
      )}
    >
      <span className="flex items-start gap-2">
        {item.image_url ? (
          // Menu photos come from Supabase Storage; the host differs per environment.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image_url}
            alt=""
            className="size-12 shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <span className="text-lg leading-tight font-semibold">{item.name}</span>
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="text-base tabular-nums">{price}</span>
        {!sellable ? (
          <span className="rounded-md bg-background px-2 py-0.5 text-xs font-semibold uppercase">
            Out of stock
          </span>
        ) : item.type === "combo" ? (
          <span className="text-xs text-muted-foreground uppercase">Meal</span>
        ) : null}
      </span>
    </button>
  );
}
