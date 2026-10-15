"use client";

import { Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { FormError, FormSuccess, Select } from "@/components/admin/form";
import { MoneyInput } from "@/components/admin/money-input";
import { SortableList } from "@/components/admin/sortable-list";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  deleteComboSlot,
  reorderMenu,
  saveComboSlot,
  setComboSlotOptions,
} from "@/lib/actions/menu";
import { toMoneyInput } from "@/lib/money";

export type ComboSlotData = {
  id: string;
  name: string;
  required: boolean;
  options: { menuItemId: string; upcharge: number; isDefault: boolean }[];
};
type PlainItem = { id: string; name: string; isActive: boolean };

/**
 * Builds a combo from slots ("Side", "Drink"), each offering plain items with
 * an optional upcharge and one default.
 */
export function ComboBuilder({
  comboId,
  currency,
  slots,
  items,
}: {
  comboId: string;
  currency: string;
  slots: ComboSlotData[];
  items: PlainItem[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      {slots.length ? (
        <SortableList
          id={`combo-${comboId}`}
          label="Combo slots"
          items={slots}
          onReorder={(ids) =>
            startTransition(async () => {
              const result = await reorderMenu("combo_slots", ids);
              setError(result.ok ? null : result.error);
            })
          }
          renderItem={(slot) => (
            <SlotEditor
              key={slot.id}
              comboId={comboId}
              slot={slot}
              items={items}
              currency={currency}
            />
          )}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          No slots yet. Add the first one, e.g. “Side”.
        </p>
      )}
      <AddSlot comboId={comboId} />
    </div>
  );
}

function SlotEditor({
  comboId,
  slot,
  items,
  currency,
}: {
  comboId: string;
  slot: ComboSlotData;
  items: PlainItem[];
  currency: string;
}) {
  const [name, setName] = useState(slot.name);
  const [required, setRequired] = useState(slot.required);
  const [options, setOptions] = useState(
    slot.options.map((o) => ({
      ...o,
      upcharge: toMoneyInput(o.upcharge, currency),
    })),
  );
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const addable = items.filter(
    (i) => i.isActive && !options.some((o) => o.menuItemId === i.id),
  );

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    message: string,
  ) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else setSaved(message);
    });
  }

  return (
    <div
      className="flex flex-col gap-3 py-1"
      data-testid={`combo-slot-${slot.name}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Slot name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-40"
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={required}
            onCheckedChange={(checked) => setRequired(checked === true)}
          />
          Required
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () => saveComboSlot(comboId, slot.id, { name, required }),
              "Slot saved.",
            )
          }
        >
          Save slot
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          aria-label={`Delete slot ${slot.name}`}
          onClick={() => {
            if (
              window.confirm(`Delete the “${slot.name}” slot and its options?`)
            ) {
              run(() => deleteComboSlot(slot.id), "Slot deleted.");
            }
          }}
        >
          <Trash2Icon />
        </Button>
      </div>

      <table className="w-full max-w-xl text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 font-normal">Choice</th>
            <th className="py-1 font-normal">Upcharge</th>
            <th className="py-1 font-normal">Default</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {options.map((o, index) => (
            <tr key={o.menuItemId}>
              <td className="py-1 pr-2">
                {itemName.get(o.menuItemId) ?? "Unknown item"}
              </td>
              <td className="py-1 pr-2">
                <MoneyInput
                  aria-label={`Upcharge for ${itemName.get(o.menuItemId)}`}
                  currency={currency}
                  value={o.upcharge}
                  onChange={(e) =>
                    setOptions(
                      options.map((x, i) =>
                        i === index ? { ...x, upcharge: e.target.value } : x,
                      ),
                    )
                  }
                  className="w-32"
                />
              </td>
              <td className="py-1 pr-2">
                <input
                  type="radio"
                  name={`default-${slot.id}`}
                  aria-label={`Default: ${itemName.get(o.menuItemId)}`}
                  checked={o.isDefault}
                  onChange={() =>
                    setOptions(
                      options.map((x, i) => ({ ...x, isDefault: i === index })),
                    )
                  }
                  className="size-4"
                />
              </td>
              <td className="py-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${itemName.get(o.menuItemId)}`}
                  onClick={() =>
                    setOptions(options.filter((_, i) => i !== index))
                  }
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Add a choice"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          className="w-56"
        >
          <option value="">Add a choice…</option>
          {addable.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
        <Button
          variant="outline"
          size="sm"
          disabled={!adding}
          onClick={() => {
            setOptions([
              ...options,
              {
                menuItemId: adding,
                upcharge: "0",
                isDefault: options.length === 0,
              },
            ]);
            setAdding("");
          }}
        >
          Add
        </Button>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => setComboSlotOptions(slot.id, options), "Choices saved.")
          }
        >
          Save choices
        </Button>
      </div>
      <FormError message={error} />
      <FormSuccess message={saved} />
    </div>
  );
}

function AddSlot({ comboId }: { comboId: string }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveComboSlot(comboId, null, {
            name,
            required: true,
          });
          if (!result.ok) setError(result.error);
          else {
            setError(null);
            setName("");
          }
        });
      }}
    >
      <Input
        aria-label="New slot name"
        placeholder="New slot, e.g. Drink"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-56"
      />
      <Button
        type="submit"
        variant="outline"
        size="lg"
        disabled={pending || !name.trim()}
      >
        Add slot
      </Button>
      <FormError message={error} />
    </form>
  );
}
