"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FormError, invalid, Select } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBranch, updateBranch } from "@/lib/actions/branches";
import {
  branchSchema,
  fieldErrors,
  type BranchFormValues,
} from "@/lib/validation";
import { useFieldIds } from "@/lib/use-field-ids";

export type Option = { value: string; label: string };

export function BranchForm({
  branchId,
  initial,
  timezones,
  currencies,
  menuCurrency,
}: {
  branchId?: string;
  initial: BranchFormValues;
  timezones: string[];
  currencies: Option[];
  /** The currency menu prices are in (null before the first branch exists). */
  menuCurrency: string | null;
}) {
  const fid = useFieldIds();
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof BranchFormValues>(
    key: K,
    value: BranchFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = branchSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setFormError("Check the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = branchId
        ? await updateBranch(branchId, values)
        : await createBranch(values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      router.push(`/admin/branches?notice=${branchId ? "saved" : "created"}`);
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex max-w-2xl flex-col gap-5"
      noValidate
    >
      <FormError message={formError} />

      <Field id={fid("name")} label="Name" error={errors.name}>
        <Input
          id={fid("name")}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          {...invalid(fid("name"), errors.name)}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={fid("timezone")}
          label="Timezone"
          error={errors.timezone}
          hint="Business days and receipts use this."
        >
          <Select
            id={fid("timezone")}
            value={values.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            {...invalid(fid("timezone"), errors.timezone)}
          >
            <option value="">Choose a timezone</option>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id={fid("currencyCode")}
          label="Currency"
          error={errors.currencyCode}
          hint={
            menuCurrency &&
            values.currencyCode &&
            values.currencyCode !== menuCurrency
              ? `Menu prices are in ${menuCurrency}. Branches share one menu, so they should use the same currency.`
              : undefined
          }
        >
          <Select
            id={fid("currencyCode")}
            value={values.currencyCode}
            onChange={(e) => set("currencyCode", e.target.value)}
            {...invalid(fid("currencyCode"), errors.currencyCode)}
          >
            <option value="">Choose a currency</option>
            {currencies.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={fid("address")} label="Address" error={errors.address}>
          <Input
            id={fid("address")}
            value={values.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        <Field id={fid("phone")} label="Phone" error={errors.phone}>
          <Input
            id={fid("phone")}
            type="tel"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </Field>
      </div>

      <Field
        id={fid("receiptHeader")}
        label="Receipt header"
        error={errors.receiptHeader}
        hint="Printed at the top of every receipt."
      >
        <Textarea
          id={fid("receiptHeader")}
          rows={2}
          value={values.receiptHeader}
          onChange={(e) => set("receiptHeader", e.target.value)}
        />
      </Field>
      <Field
        id={fid("receiptFooter")}
        label="Receipt footer"
        error={errors.receiptFooter}
        hint="For example a thank-you note or tax number."
      >
        <Textarea
          id={fid("receiptFooter")}
          rows={2}
          value={values.receiptFooter}
          onChange={(e) => set("receiptFooter", e.target.value)}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Checkbox
          id={fid("isActive")}
          checked={values.isActive}
          onCheckedChange={(checked) => set("isActive", checked === true)}
        />
        <Label htmlFor={fid("isActive")}>
          Active (inactive branches can&apos;t trade)
        </Label>
      </div>

      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : branchId ? "Save branch" : "Create branch"}
        </Button>
      </div>
    </form>
  );
}
