"use client";

import { CheckIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CartComboChoice, CartLine } from "@/lib/cart";
import { MAX_QUANTITY } from "@/lib/cart";
import {
  comboProblems,
  defaultComboChoices,
  defaultModifiers,
  modifierProblems,
  toggleModifier,
} from "@/lib/choices";
import {
  availableOptions,
  type MenuIndex,
  type MenuItem,
  type MenuModifierGroup,
} from "@/lib/menu";
import { formatAmount } from "@/lib/money";
import { unitPrice } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/**
 * Configures one cart line: modifiers for an item, or a combo's choices step
 * by step (each with the part's own options, like size). Defaults are
 * pre-selected, so "Add" works straight away for the usual order.
 */
export function ItemSheet({
  item,
  index,
  currency,
  initial,
  newId,
  onConfirm,
  onRemove,
  onClose,
}: {
  item: MenuItem;
  index: MenuIndex;
  currency: string;
  /** The line being edited, if any. */
  initial?: CartLine;
  newId: () => string;
  onConfirm: (line: CartLine) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const isCombo = item.type === "combo";
  const [modifierIds, setModifierIds] = useState(
    () => initial?.modifierIds ?? defaultModifiers(item.modifier_groups),
  );
  const [combo, setCombo] = useState<CartComboChoice[]>(
    () => initial?.combo ?? (isCombo ? defaultComboChoices(item, index) : []),
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1);
  const steps = isCombo ? item.combo_slots : [];
  const [step, setStep] = useState(0);

  const unit =
    unitPrice({ menuItemId: item.id, modifierIds, combo }, index) ?? 0;
  const problems = useMemo(
    () => [
      ...(item.is_available ? [] : [`${item.name} is out of stock`]),
      ...modifierProblems(item, modifierIds),
      ...(isCombo ? comboProblems(item, combo, index) : []),
    ],
    [item, modifierIds, combo, index, isCombo],
  );

  function choose(slotId: string, menuItemId: string) {
    const part = index.items.get(menuItemId);
    const next = [
      ...combo.filter((c) => c.slotId !== slotId),
      {
        slotId,
        menuItemId,
        modifierIds: part ? defaultModifiers(part.modifier_groups) : [],
      },
    ];
    // Keep the slots in menu order.
    next.sort(
      (a, b) =>
        steps.findIndex((s) => s.id === a.slotId) -
        steps.findIndex((s) => s.id === b.slotId),
    );
    setCombo(next);
    // Move on unless the part has options to pick (e.g. a drink's size).
    if (!part?.modifier_groups.length && step < steps.length - 1)
      setStep(step + 1);
  }

  function setPartModifiers(slotId: string, ids: string[]) {
    setCombo(
      combo.map((c) => (c.slotId === slotId ? { ...c, modifierIds: ids } : c)),
    );
  }

  function confirm() {
    onConfirm({
      id: initial?.id ?? newId(),
      menuItemId: item.id,
      quantity,
      modifierIds,
      combo,
      notes: notes.trim(),
    });
  }

  const slot = steps[step];
  const slotChoice = slot ? combo.find((c) => c.slotId === slot.id) : undefined;
  const chosenPart = slotChoice
    ? index.items.get(slotChoice.menuItemId)
    : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92dvh] w-[min(56rem,96vw)] max-w-none flex-col gap-4 overflow-hidden p-5 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-2xl">{item.name}</DialogTitle>
          <DialogDescription className="text-base">
            {formatAmount(item.price, currency)}
            {item.description ? ` · ${item.description}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
          {isCombo ? (
            <>
              <div
                role="tablist"
                aria-label="Meal steps"
                className="flex flex-wrap gap-2"
              >
                {steps.map((s, i) => {
                  const choice = combo.find((c) => c.slotId === s.id);
                  const name = choice
                    ? index.items.get(choice.menuItemId)?.name
                    : undefined;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="tab"
                      aria-selected={i === step}
                      onClick={() => setStep(i)}
                      className={cn(
                        "flex min-h-14 flex-col items-start justify-center rounded-xl border-2 px-4 text-left",
                        i === step
                          ? "border-foreground"
                          : "border-transparent bg-muted",
                      )}
                    >
                      <span className="text-sm text-muted-foreground">
                        {i + 1}. {s.name}
                        {!s.required ? " (optional)" : ""}
                      </span>
                      <span className="flex items-center gap-1 font-semibold">
                        {name ? <CheckIcon className="size-4" /> : null}
                        {name ?? "Choose"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {slot ? (
                <section className="flex flex-col gap-3" aria-label={slot.name}>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {slot.options.map((option) => {
                      const part = index.items.get(option.menu_item_id);
                      if (!part) return null;
                      const selected = slotChoice?.menuItemId === part.id;
                      const available = availableOptions(slot, index).some(
                        (o) => o.menu_item_id === part.id,
                      );
                      return (
                        <OptionButton
                          key={part.id}
                          label={part.name}
                          detail={
                            option.upcharge
                              ? `+${formatAmount(option.upcharge, currency)}`
                              : undefined
                          }
                          selected={selected}
                          disabled={!available}
                          onClick={() => choose(slot.id, part.id)}
                        />
                      );
                    })}
                    {!slot.required && slotChoice ? (
                      <OptionButton
                        label={`No ${slot.name.toLowerCase()}`}
                        selected={false}
                        onClick={() =>
                          setCombo(combo.filter((c) => c.slotId !== slot.id))
                        }
                      />
                    ) : null}
                  </div>
                  {chosenPart && slotChoice
                    ? chosenPart.modifier_groups.map((group) => (
                        <ModifierGroupPicker
                          key={group.id}
                          group={group}
                          currency={currency}
                          selected={slotChoice.modifierIds}
                          label={`${chosenPart.name}: ${group.name}`}
                          onChange={(ids) => setPartModifiers(slot.id, ids)}
                        />
                      ))
                    : null}
                </section>
              ) : null}
            </>
          ) : null}

          {item.modifier_groups.map((group) => (
            <ModifierGroupPicker
              key={group.id}
              group={group}
              currency={currency}
              selected={modifierIds}
              label={group.name}
              onChange={setModifierIds}
            />
          ))}

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex min-w-60 flex-1 flex-col gap-2 text-sm font-medium">
              Notes for the kitchen
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. no pepper"
                className="h-12 text-base"
                maxLength={200}
              />
            </label>
            <div
              className="flex items-center gap-2"
              role="group"
              aria-label="Quantity"
            >
              <Button
                type="button"
                variant="outline"
                size="touch"
                aria-label="One less"
                disabled={quantity <= 1}
                onClick={() => setQuantity(quantity - 1)}
              >
                <MinusIcon />
              </Button>
              <span
                className="w-12 text-center text-2xl font-semibold tabular-nums"
                aria-live="polite"
              >
                {quantity}
              </span>
              <Button
                type="button"
                variant="outline"
                size="touch"
                aria-label="One more"
                disabled={quantity >= MAX_QUANTITY}
                onClick={() => setQuantity(quantity + 1)}
              >
                <PlusIcon />
              </Button>
            </div>
          </div>
        </div>

        {problems.length ? (
          <p className="text-sm text-destructive" role="status">
            {problems[0]}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="flex gap-2">
            {onRemove ? (
              <Button
                type="button"
                variant="destructive"
                size="touch"
                onClick={onRemove}
              >
                Remove
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="touch"
              onClick={onClose}
            >
              Cancel
            </Button>
          </div>
          <div className="flex gap-2">
            {isCombo && step < steps.length - 1 ? (
              <Button
                type="button"
                variant="secondary"
                size="touch"
                onClick={() => setStep(step + 1)}
              >
                Next: {steps[step + 1].name}
              </Button>
            ) : null}
            <Button
              type="button"
              size="touch"
              disabled={problems.length > 0}
              onClick={confirm}
              className="min-w-56"
            >
              {initial ? "Update" : "Add to order"} ·{" "}
              {formatAmount(unit * quantity, currency)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OptionButton({
  label,
  detail,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-16 items-center justify-between gap-2 rounded-xl border-2 px-4 text-left text-lg font-medium transition-colors",
        selected
          ? "border-foreground bg-foreground text-background"
          : "bg-card hover:border-foreground/30",
        disabled &&
          "cursor-not-allowed border-dashed bg-muted text-muted-foreground opacity-60",
      )}
    >
      <span>
        {label}
        {disabled ? (
          <span className="block text-xs font-semibold uppercase">
            Out of stock
          </span>
        ) : null}
      </span>
      {detail ? (
        <span className="text-base tabular-nums opacity-80">{detail}</span>
      ) : null}
    </button>
  );
}

function ModifierGroupPicker({
  group,
  currency,
  selected,
  label,
  onChange,
}: {
  group: MenuModifierGroup;
  currency: string;
  selected: string[];
  label: string;
  onChange: (ids: string[]) => void;
}) {
  const rule =
    group.min_select === group.max_select
      ? `Choose ${group.min_select}`
      : group.min_select === 0
        ? `Optional, up to ${group.max_select}`
        : `Choose ${group.min_select} to ${group.max_select}`;
  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      <h3 className="text-lg font-semibold">
        {label}{" "}
        <span className="text-sm font-normal text-muted-foreground">
          · {rule}
        </span>
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {group.modifiers.map((m) => (
          <OptionButton
            key={m.id}
            label={m.name}
            detail={
              m.price_delta
                ? `${m.price_delta > 0 ? "+" : "−"}${formatAmount(Math.abs(m.price_delta), currency)}`
                : undefined
            }
            selected={selected.includes(m.id)}
            disabled={!m.is_available}
            onClick={() => onChange(toggleModifier(group, selected, m.id))}
          />
        ))}
      </div>
    </section>
  );
}
