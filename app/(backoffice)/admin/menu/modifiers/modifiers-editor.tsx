"use client";

import { useState, useTransition } from "react";
import { FormError, Select } from "@/components/admin/form";
import { MoneyInput } from "@/components/admin/money-input";
import { SortableList } from "@/components/admin/sortable-list";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { reorderMenu, saveModifier } from "@/lib/actions/menu";
import { toMoneyInput } from "@/lib/money";
import {
  fieldErrors,
  modifierSchema,
  type ModifierFormValues,
} from "@/lib/validation";

export type ModifierRow = {
  id: string;
  name: string;
  price_delta: number;
  kds_station_id: string | null;
  is_active: boolean;
};
type Station = { id: string; name: string };

/** Edit a group's modifiers in place: name, price change, station, on/off. */
export function ModifiersEditor({
  groupId,
  currency,
  modifiers,
  stations,
}: {
  groupId: string;
  currency: string;
  modifiers: ModifierRow[];
  stations: Station[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      {modifiers.length ? (
        <SortableList
          id={`modifiers-${groupId}`}
          label="Modifiers"
          items={modifiers}
          onReorder={(ids) =>
            startTransition(async () => {
              const result = await reorderMenu("modifiers", ids);
              setError(result.ok ? null : result.error);
            })
          }
          renderItem={(m) => (
            <ModifierEditor
              groupId={groupId}
              currency={currency}
              stations={stations}
              modifierId={m.id}
              initial={{
                name: m.name,
                priceDelta: toMoneyInput(m.price_delta, currency),
                kdsStationId: m.kds_station_id ?? "",
                isActive: m.is_active,
              }}
            />
          )}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No modifiers yet.</p>
      )}
      <div className="rounded-xl border border-dashed p-3">
        <p className="mb-2 text-sm font-medium">Add a modifier</p>
        <ModifierEditor
          key={modifiers.length}
          groupId={groupId}
          currency={currency}
          stations={stations}
          initial={{
            name: "",
            priceDelta: "0",
            kdsStationId: "",
            isActive: true,
          }}
        />
      </div>
    </div>
  );
}

function ModifierEditor({
  groupId,
  modifierId,
  currency,
  stations,
  initial,
}: {
  groupId: string;
  modifierId?: string;
  currency: string;
  stations: Station[];
  initial: ModifierFormValues;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const label = modifierId ? values.name || "modifier" : "new modifier";

  function save() {
    const parsed = modifierSchema(currency).safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setError(null);
    startTransition(async () => {
      const result = await saveModifier(groupId, modifierId ?? null, values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setError(result.error);
      } else {
        setSavedAt(Date.now());
        if (!modifierId) setValues(initial);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={`Name of ${label}`}
          placeholder="Name"
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          aria-invalid={errors.name ? true : undefined}
          className="w-40"
        />
        <MoneyInput
          aria-label={`Price change for ${label}`}
          currency={currency}
          value={values.priceDelta}
          onChange={(e) => setValues({ ...values, priceDelta: e.target.value })}
          aria-invalid={errors.priceDelta ? true : undefined}
          className="w-32"
        />
        <Select
          aria-label={`Kitchen station for ${label}`}
          value={values.kdsStationId}
          onChange={(e) =>
            setValues({ ...values, kdsStationId: e.target.value })
          }
          className="w-44"
        >
          <option value="">Same station as the item</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={values.isActive}
            onCheckedChange={(c) =>
              setValues({ ...values, isActive: c === true })
            }
          />
          In use
        </label>
        <Button size="sm" variant="outline" disabled={pending} onClick={save}>
          {modifierId ? "Save" : "Add"}
        </Button>
        {savedAt && modifierId ? (
          <span className="text-xs text-muted-foreground">Saved</span>
        ) : null}
      </div>
      {errors.name || errors.priceDelta ? (
        <p className="text-sm text-destructive">
          {errors.name ?? errors.priceDelta}
        </p>
      ) : null}
      <FormError message={error} />
    </div>
  );
}
