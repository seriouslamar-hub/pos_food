"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FormError, invalid } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCategory } from "@/lib/actions/menu";
import {
  categorySchema,
  fieldErrors,
  type CategoryFormValues,
} from "@/lib/validation";
import { useFieldIds } from "@/lib/use-field-ids";

const SWATCHES = [
  "#9333EA",
  "#EA580C",
  "#DC2626",
  "#CA8A04",
  "#16A34A",
  "#2563EB",
  "#0891B2",
  "#DB2777",
];

export function CategoryForm({
  categoryId,
  initial,
}: {
  categoryId?: string;
  initial: CategoryFormValues;
}) {
  const fid = useFieldIds();
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = categorySchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setFormError("Check the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await saveCategory(categoryId ?? null, values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      router.push(
        `/admin/menu?category=${result.data!.id}&notice=category-saved`,
      );
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-lg flex-col gap-5" noValidate>
      <FormError message={formError} />
      <Field id={fid("name")} label="Name" error={errors.name}>
        <Input
          id={fid("name")}
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          {...invalid(fid("name"), errors.name)}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Colour on the till</legend>
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((colour) => (
            <button
              key={colour}
              type="button"
              aria-label={`Colour ${colour}`}
              aria-pressed={values.colour?.toUpperCase() === colour}
              onClick={() => setValues({ ...values, colour })}
              className="size-9 rounded-full border-2 border-transparent aria-pressed:border-foreground"
              style={{ backgroundColor: colour }}
            />
          ))}
          <button
            type="button"
            aria-pressed={!values.colour}
            onClick={() => setValues({ ...values, colour: "" })}
            className="h-9 rounded-full border px-3 text-sm aria-pressed:border-foreground aria-pressed:font-medium"
          >
            None
          </button>
        </div>
        {errors.colour ? (
          <p className="text-sm text-destructive">{errors.colour}</p>
        ) : null}
      </fieldset>
      <div className="flex items-center gap-3">
        <Checkbox
          id={fid("isActive")}
          checked={values.isActive}
          onCheckedChange={(checked) =>
            setValues({ ...values, isActive: checked === true })
          }
        />
        <Label htmlFor={fid("isActive")}>Show on the till</Label>
      </div>
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending
            ? "Saving…"
            : categoryId
              ? "Save category"
              : "Create category"}
        </Button>
      </div>
    </form>
  );
}
