"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Field,
  FormError,
  FormSuccess,
  invalid,
} from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveModifierGroup } from "@/lib/actions/menu";
import {
  fieldErrors,
  modifierGroupSchema,
  type ModifierGroupFormValues,
} from "@/lib/validation";
import { useFieldIds } from "@/lib/use-field-ids";

export function GroupForm({
  groupId,
  initial,
}: {
  groupId?: string;
  initial: ModifierGroupFormValues;
}) {
  const fid = useFieldIds();
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof ModifierGroupFormValues>(
    key: K,
    value: ModifierGroupFormValues[K],
  ) {
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = modifierGroupSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setFormError("Check the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await saveModifierGroup(groupId ?? null, values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      if (groupId) {
        setSaved(true);
        router.refresh();
      } else {
        router.push(`/admin/menu/modifiers/${result.data!.id}?notice=created`);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-5" noValidate>
      <FormError message={formError} />
      <Field
        id={fid("name")}
        label="Name"
        error={errors.name}
        hint="What the till asks, e.g. “Size” or “Extras”."
      >
        <Input
          id={fid("name")}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          {...invalid(fid("name"), errors.name)}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={fid("minSelect")}
          label="Must choose at least"
          error={errors.minSelect}
          hint="0 makes the group optional."
        >
          <Input
            id={fid("minSelect")}
            inputMode="numeric"
            value={values.minSelect}
            onChange={(e) => set("minSelect", e.target.value)}
            className="max-w-24"
            {...invalid(fid("minSelect"), errors.minSelect)}
          />
        </Field>
        <Field
          id={fid("maxSelect")}
          label="Can choose up to"
          error={errors.maxSelect}
        >
          <Input
            id={fid("maxSelect")}
            inputMode="numeric"
            value={values.maxSelect}
            onChange={(e) => set("maxSelect", e.target.value)}
            className="max-w-24"
            {...invalid(fid("maxSelect"), errors.maxSelect)}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Checkbox
          id={fid("isActive")}
          checked={values.isActive}
          onCheckedChange={(c) => set("isActive", c === true)}
        />
        <Label htmlFor={fid("isActive")}>In use</Label>
      </div>
      <FormSuccess message={saved ? "Saved." : null} />
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : groupId ? "Save group" : "Create group"}
        </Button>
      </div>
    </form>
  );
}
