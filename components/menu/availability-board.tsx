"use client";

import { useState, useTransition } from "react";
import { FormError } from "@/components/admin/form";
import { Switch } from "@/components/ui/switch";
import { setAvailability } from "@/lib/actions/menu";
import type { MenuDoc, MenuModifierGroup } from "@/lib/menu";
import { useLiveMenu } from "@/lib/use-live-menu";
import { cn } from "@/lib/utils";

/**
 * Big in-stock / out-of-stock switches for a branch's items and modifiers.
 * Changes show at once here and reach every till through Realtime.
 */
export function AvailabilityBoard({
  branchId,
  initialMenu,
}: {
  branchId: string;
  initialMenu: MenuDoc;
}) {
  const { menu: live, apply } = useLiveMenu(branchId, initialMenu);
  const menu = live ?? initialMenu;
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(kind: "item" | "modifier", id: string, available: boolean) {
    setError(null);
    apply({ kind, id, isAvailable: available });
    startTransition(async () => {
      const result = await setAvailability(branchId, kind, id, available);
      if (!result.ok) {
        apply({ kind, id, isAvailable: !available });
        setError(result.error);
      }
    });
  }

  const groups = new Map<string, MenuModifierGroup>();
  for (const item of menu.items)
    for (const group of item.modifier_groups) groups.set(group.id, group);
  const outCount =
    menu.items.filter((i) => !i.is_available).length +
    [...groups.values()]
      .flatMap((g) => g.modifiers)
      .filter((m) => !m.is_available).length;

  return (
    <div className="flex flex-col gap-8">
      <p className="text-muted-foreground" data-testid="out-of-stock-count">
        {outCount === 0
          ? "Everything is in stock."
          : `${outCount} out of stock.`}
      </p>
      <FormError message={error} />
      {menu.categories.map((category) => {
        const items = menu.items.filter((i) => i.category_id === category.id);
        if (!items.length) return null;
        return (
          <section key={category.id} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{category.name}</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map((item) => (
                <AvailabilityRow
                  key={item.id}
                  label={item.name}
                  available={item.is_available}
                  onChange={(available) => toggle("item", item.id, available)}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {groups.size ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Options and extras</h2>
          {[...groups.values()].map((group) => (
            <div key={group.id} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-muted-foreground">
                {group.name}
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {group.modifiers.map((m) => (
                  <AvailabilityRow
                    key={m.id}
                    label={m.name}
                    available={m.is_available}
                    onChange={(available) =>
                      toggle("modifier", m.id, available)
                    }
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function AvailabilityRow({
  label,
  available,
  onChange,
}: {
  label: string;
  available: boolean;
  onChange: (available: boolean) => void;
}) {
  return (
    <li>
      <label
        className={cn(
          "flex min-h-16 cursor-pointer items-center justify-between gap-4 rounded-xl border-2 px-4 transition-colors",
          available ? "bg-card" : "border-dashed bg-muted",
        )}
      >
        <span className="text-lg font-medium">{label}</span>
        <span className="flex items-center gap-3">
          <span
            className={cn(
              "text-sm font-semibold",
              available ? "text-foreground" : "text-destructive",
            )}
          >
            {available ? "In stock" : "Out of stock"}
          </span>
          <Switch
            checked={available}
            onCheckedChange={onChange}
            aria-label={`${label} in stock`}
            className="scale-125"
          />
        </span>
      </label>
    </li>
  );
}
