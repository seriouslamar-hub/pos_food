"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FormError, invalid } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCashier, updateCashier } from "@/lib/actions/staff";
import {
  cashierCreateSchema,
  cashierSchema,
  fieldErrors,
  type CashierFormValues,
} from "@/lib/validation";

/** A manager's form for a cashier in their own branch. */
export function CashierForm({
  staffId,
  initial,
}: {
  staffId?: string;
  initial: CashierFormValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isCreate = !staffId;

  function set<K extends keyof CashierFormValues>(
    key: K,
    value: CashierFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = (isCreate ? cashierCreateSchema : cashierSchema).safeParse(
      values,
    );
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setFormError("Check the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      if (isCreate) {
        const result = await createCashier(values);
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {});
          setFormError(result.error);
          return;
        }
        router.push(
          result.data?.pinError
            ? `/manager/staff/${result.data.id}?notice=pin-not-set`
            : "/manager/staff?notice=created",
        );
        return;
      }
      const result = await updateCashier(staffId, values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      router.push("/manager/staff?notice=saved");
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex max-w-2xl flex-col gap-5"
      noValidate
    >
      <FormError message={formError} />
      <Field id="fullName" label="Full name" error={errors.fullName}>
        <Input
          id="fullName"
          value={values.fullName}
          onChange={(e) => set("fullName", e.target.value)}
          {...invalid("fullName", errors.fullName)}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="phone" label="Phone" error={errors.phone}>
          <Input
            id="phone"
            type="tel"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </Field>
        <Field
          id="discountPercent"
          label="Discount limit (%)"
          error={errors.discountPercent}
          hint="Up to your own limit. Bigger discounts need your approval."
        >
          <Input
            id="discountPercent"
            inputMode="decimal"
            value={values.discountPercent}
            onChange={(e) => set("discountPercent", e.target.value)}
            {...invalid("discountPercent", errors.discountPercent)}
          />
        </Field>
      </div>
      {isCreate ? (
        <Field
          id="pin"
          label="Till PIN"
          error={errors.pin}
          hint="4 to 6 digits. You can set it later."
        >
          <Input
            id="pin"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            className="max-w-40"
            value={values.pin ?? ""}
            onChange={(e) => set("pin", e.target.value)}
            {...invalid("pin", errors.pin)}
          />
        </Field>
      ) : null}
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
          {pending ? "Saving…" : isCreate ? "Add cashier" : "Save"}
        </Button>
      </div>
    </form>
  );
}
