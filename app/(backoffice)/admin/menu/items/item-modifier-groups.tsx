"use client";

import { useState, useTransition } from "react";
import { FormError, FormSuccess } from "@/components/admin/form";
import { SortableList } from "@/components/admin/sortable-list";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { setItemModifierGroups } from "@/lib/actions/menu";
import { useFieldIds } from "@/lib/use-field-ids";

export type GroupOption = {
  id: string;
  name: string;
  rule: string;
  modifiers: string;
  isActive: boolean;
};

/** Which modifier groups the till asks about for this item, and in what order. */
export function ItemModifierGroups({
  itemId,
  groups,
  initialSelected,
}: {
  itemId: string;
  groups: GroupOption[];
  initialSelected: string[];
}) {
  const fid = useFieldIds();
  const [selected, setSelected] = useState(initialSelected);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const byId = new Map(groups.map((g) => [g.id, g]));

  function toggle(id: string, on: boolean) {
    setSaved(false);
    setSelected((prev) => (on ? [...prev, id] : prev.filter((g) => g !== id)));
  }

  if (!groups.length) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no modifier groups yet.
      </p>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {groups.map((g) => (
          <li key={g.id} className="flex items-start gap-3">
            <Checkbox
              id={fid(`group-${g.id}`)}
              checked={selected.includes(g.id)}
              onCheckedChange={(checked) => toggle(g.id, checked === true)}
              className="mt-1"
            />
            <label
              htmlFor={fid(`group-${g.id}`)}
              className="flex flex-col text-sm"
            >
              <span className="font-medium">
                {g.name}{" "}
                <span className="font-normal text-muted-foreground">
                  · {g.rule}
                </span>
                {!g.isActive ? (
                  <span className="text-muted-foreground"> (hidden)</span>
                ) : null}
              </span>
              <span className="text-muted-foreground">{g.modifiers}</span>
            </label>
          </li>
        ))}
      </ul>
      {selected.length > 1 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Order on the till</p>
          <SortableList
            id={fid(`item-groups-${itemId}`)}
            label="Modifier group order"
            items={selected.map((id) => ({
              id,
              name: byId.get(id)?.name ?? "",
            }))}
            onReorder={(ids) => {
              setSaved(false);
              setSelected(ids);
            }}
            renderItem={(g) => <span className="text-sm">{g.name}</span>}
          />
        </div>
      ) : null}
      <FormError message={error} />
      <FormSuccess message={saved ? "Modifier groups saved." : null} />
      <div>
        <Button
          size="lg"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setItemModifierGroups(itemId, selected);
              if (!result.ok) setError(result.error);
              else {
                setError(null);
                setSaved(true);
              }
            })
          }
        >
          {pending ? "Saving…" : "Save modifier groups"}
        </Button>
      </div>
    </div>
  );
}
