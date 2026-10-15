"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FormError } from "@/components/admin/form";
import { SortableList } from "@/components/admin/sortable-list";
import { Badge } from "@/components/ui/badge";
import { reorderMenu } from "@/lib/actions/menu";

type GroupRow = {
  id: string;
  name: string;
  rule: string;
  modifierCount: number;
  itemCount: number;
  isActive: boolean;
};

export function GroupList({ groups }: { groups: GroupRow[] }) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <FormError message={error} />
      <SortableList
        id="modifier-groups"
        label="Modifier groups"
        items={groups}
        onReorder={(ids) =>
          startTransition(async () => {
            const result = await reorderMenu("modifier_groups", ids);
            setError(result.ok ? null : result.error);
          })
        }
        renderItem={(g) => (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/admin/menu/modifiers/${g.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {g.name}
            </Link>
            <span className="flex items-center gap-3 text-sm text-muted-foreground">
              {g.rule} · {g.modifierCount} options · used by {g.itemCount} item
              {g.itemCount === 1 ? "" : "s"}
              {!g.isActive ? <Badge variant="outline">Hidden</Badge> : null}
            </span>
          </div>
        )}
      />
    </div>
  );
}
