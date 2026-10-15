"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FormError, invalid } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTax, updateTax } from "@/lib/actions/catalog";
import { fieldErrors, taxSchema, type TaxFormValues } from "@/lib/validation";

export function TaxForm({
  taxId,
  initial,
}: {
  taxId?: string;
  initial: TaxFormValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof TaxFormValues>(key: K, value: TaxFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = taxSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setFormError("Check the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = taxId
        ? await updateTax(taxId, values)
        : await createTax(values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      router.push(`/admin/taxes?notice=${taxId ? "saved" : "created"}`);
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
        <Field
          id="name"
          label="Name"
          error={errors.name}
          hint="As printed on receipts, e.g. VAT."
        >
          <Input
            id="name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            {...invalid("name", errors.name)}
          />
        </Field>
        <Field id="ratePercent" label="Rate (%)" error={errors.ratePercent}>
          <Input
            id="ratePercent"
            inputMode="decimal"
            value={values.ratePercent}
            onChange={(e) => set("ratePercent", e.target.value)}
            className="max-w-32"
            {...invalid("ratePercent", errors.ratePercent)}
          />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="taxCategory"
          label="Tax category"
          error={errors.taxCategory}
          hint="Menu items in this category pay this tax. Several taxes can share a category."
        >
          <Input
            id="taxCategory"
            value={values.taxCategory}
            onChange={(e) => set("taxCategory", e.target.value)}
            className="font-mono"
            {...invalid("taxCategory", errors.taxCategory)}
          />
        </Field>
        <Field
          id="sortOrder"
          label="Order on receipts"
          error={errors.sortOrder}
        >
          <Input
            id="sortOrder"
            inputMode="numeric"
            value={values.sortOrder}
            onChange={(e) => set("sortOrder", e.target.value)}
            className="max-w-32"
          />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Prices</legend>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="radio"
            name="inclusive"
            checked={values.isInclusive}
            onChange={() => set("isInclusive", true)}
            className="size-4"
          />
          Included in menu prices (the receipt shows the tax inside the price)
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="radio"
            name="inclusive"
            checked={!values.isInclusive}
            onChange={() => set("isInclusive", false)}
            className="size-4"
          />
          Added on top of menu prices
        </label>
      </fieldset>
      <div className="flex items-center gap-3">
        <Checkbox
          id="isActive"
          checked={values.isActive}
          onCheckedChange={(checked) => set("isActive", checked === true)}
        />
        <Label htmlFor="isActive">Active</Label>
      </div>
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : taxId ? "Save tax" : "Add tax"}
        </Button>
      </div>
    </form>
  );
}
