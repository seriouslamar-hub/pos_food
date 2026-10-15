"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError } from "@/components/admin/form";
import { SortableList } from "@/components/admin/sortable-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadSampleMenu, reorderMenu, type MenuList } from "@/lib/actions/menu";
import { formatAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

function useReorder(kind: MenuList, parentId?: string) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  return {
    error,
    reorder: (ids: string[]) =>
      startTransition(async () => {
        const result = await reorderMenu(kind, ids, parentId);
        setError(result.ok ? null : result.error);
      }),
  };
}

export type CategoryRow = {
  id: string;
  name: string;
  colour: string | null;
  is_active: boolean;
};

export function CategoryList({
  categories,
  selectedId,
}: {
  categories: CategoryRow[];
  selectedId: string;
}) {
  const { error, reorder } = useReorder("categories");
  return (
    <div className="flex flex-col gap-2">
      <FormError message={error} />
      <SortableList
        id="menu-categories"
        label="Categories"
        items={categories}
        onReorder={reorder}
        renderItem={(c) => (
          <div className="flex items-center justify-between gap-2">
            <Link
              href={`/admin/menu?category=${c.id}`}
              aria-current={c.id === selectedId ? "true" : undefined}
              className={cn(
                "flex min-h-9 flex-1 items-center gap-2 rounded-md px-2 hover:bg-muted",
                c.id === selectedId && "bg-muted font-medium",
              )}
            >
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full border"
                style={c.colour ? { backgroundColor: c.colour } : undefined}
              />
              {c.name}
            </Link>
            {!c.is_active ? <Badge variant="outline">Hidden</Badge> : null}
          </div>
        )}
      />
    </div>
  );
}

export type ItemRow = {
  id: string;
  name: string;
  type: "item" | "combo";
  base_price: number;
  is_active: boolean;
};

export function ItemList({
  items,
  currency,
}: {
  items: ItemRow[];
  currency: string;
}) {
  const { error, reorder } = useReorder("menu_items");
  return (
    <div className="flex flex-col gap-2">
      <FormError message={error} />
      <SortableList
        id="menu-items"
        label="Items"
        items={items}
        onReorder={reorder}
        renderItem={(item) => (
          <div className="flex items-center justify-between gap-3">
            <Link
              href={`/admin/menu/items/${item.id}`}
              className="flex min-h-9 flex-1 items-center gap-2 font-medium underline-offset-4 hover:underline"
            >
              {item.name}
            </Link>
            <span className="flex items-center gap-2">
              {item.type === "combo" ? (
                <Badge variant="secondary">Combo</Badge>
              ) : null}
              {!item.is_active ? <Badge variant="outline">Hidden</Badge> : null}
              <span className="w-24 text-right tabular-nums">
                {formatAmount(item.base_price, currency)}
              </span>
            </span>
          </div>
        )}
      />
    </div>
  );
}

export function SampleMenuButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await loadSampleMenu();
            if (!result.ok) setError(result.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Adding…" : "Start with a sample menu"}
      </Button>
      <FormError message={error} />
    </div>
  );
}
