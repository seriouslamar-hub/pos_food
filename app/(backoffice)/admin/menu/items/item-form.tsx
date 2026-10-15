"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Field,
  FormError,
  FormSuccess,
  invalid,
  Select,
} from "@/components/admin/form";
import { MoneyInput } from "@/components/admin/money-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveMenuItem } from "@/lib/actions/menu";
import {
  fieldErrors,
  menuItemSchema,
  type MenuItemFormValues,
} from "@/lib/validation";
import { useFieldIds } from "@/lib/use-field-ids";

type Option = { id: string; name: string };

export function ItemForm({
  itemId,
  initial,
  currency,
  categories,
  stations,
  taxCategories,
}: {
  itemId?: string;
  initial: MenuItemFormValues;
  currency: string;
  categories: Option[];
  stations: Option[];
  taxCategories: string[];
}) {
  const fid = useFieldIds();
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const isCombo = values.type === "combo";

  function set<K extends keyof MenuItemFormValues>(
    key: K,
    value: MenuItemFormValues[K],
  ) {
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = menuItemSchema(currency).safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setFormError("Check the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await saveMenuItem(itemId ?? null, values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      if (itemId) {
        setSaved(true);
        router.refresh();
      } else {
        router.push(`/admin/menu/items/${result.data!.id}?notice=created`);
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex max-w-2xl flex-col gap-5"
      noValidate
    >
      <FormError message={formError} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={fid("name")} label="Name" error={errors.name}>
          <Input
            id={fid("name")}
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            {...invalid(fid("name"), errors.name)}
          />
        </Field>
        <Field
          id={fid("shortName")}
          label="Short name"
          error={errors.shortName}
          hint="For receipts and kitchen tickets. Optional."
        >
          <Input
            id={fid("shortName")}
            value={values.shortName}
            onChange={(e) => set("shortName", e.target.value)}
          />
        </Field>
      </div>
      <Field
        id={fid("description")}
        label="Description"
        error={errors.description}
      >
        <Textarea
          id={fid("description")}
          rows={2}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={fid("categoryId")}
          label="Category"
          error={errors.categoryId}
        >
          <Select
            id={fid("categoryId")}
            value={values.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
            {...invalid(fid("categoryId"), errors.categoryId)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id={fid("price")}
          label={isCombo ? "Combo price" : "Price"}
          error={errors.price}
          hint={
            isCombo
              ? "Upcharges and extras are added on top."
              : "Branches can override it below."
          }
        >
          <MoneyInput
            id={fid("price")}
            currency={currency}
            value={values.price}
            onChange={(e) => set("price", e.target.value)}
            {...invalid(fid("price"), errors.price)}
          />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={fid("taxCategory")}
          label="Tax category"
          error={errors.taxCategory}
          hint="Taxes in this category apply to it."
        >
          <Input
            id={fid("taxCategory")}
            list={fid("tax-categories")}
            value={values.taxCategory}
            onChange={(e) => set("taxCategory", e.target.value)}
            className="font-mono"
            {...invalid(fid("taxCategory"), errors.taxCategory)}
          />
          <datalist id={fid("tax-categories")}>
            {taxCategories.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        {!isCombo ? (
          <Field
            id={fid("kdsStationId")}
            label="Kitchen station"
            error={errors.kdsStationId}
          >
            <Select
              id={fid("kdsStationId")}
              value={values.kdsStationId}
              onChange={(e) => set("kdsStationId", e.target.value)}
            >
              <option value="">No station (not prepared in the kitchen)</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="self-end text-sm text-muted-foreground">
            A combo&apos;s parts go to their own kitchen stations.
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Checkbox
          id={fid("isActive")}
          checked={values.isActive}
          onCheckedChange={(checked) => set("isActive", checked === true)}
        />
        <Label htmlFor={fid("isActive")}>
          On the menu (untick to hide it everywhere)
        </Label>
      </div>
      <FormSuccess message={saved ? "Saved." : null} />
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending
            ? "Saving…"
            : itemId
              ? "Save"
              : isCombo
                ? "Create combo"
                : "Create item"}
        </Button>
      </div>
    </form>
  );
}
