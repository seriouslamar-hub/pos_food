"use client";

import { useState, useTransition } from "react";
import { Field, FormSuccess, invalid } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setStaffPin } from "@/lib/actions/staff";
import { useFieldIds } from "@/lib/use-field-ids";

/** Set or change someone's till PIN. set_staff_pin enforces who may do this. */
export function PinPanel({
  staffId,
  hasPin,
  isActive,
}: {
  staffId: string;
  hasPin: boolean;
  isActive: boolean;
}) {
  const fid = useFieldIds();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!isActive) {
    return (
      <p className="text-sm text-muted-foreground">
        Reactivate them to set a PIN.
      </p>
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    if (!/^\d{4,6}$/.test(pin)) {
      setError("PIN must be 4 to 6 digits");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setStaffPin(staffId, pin);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPin("");
      setSaved(true);
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-3" noValidate>
      <p className="text-sm text-muted-foreground">
        {hasPin
          ? "A PIN is set. Enter a new one to change it."
          : "No PIN yet, so they can't use the till."}
      </p>
      <Field
        id={fid("new-pin")}
        label={hasPin ? "New PIN" : "PIN"}
        error={error ?? undefined}
      >
        <div className="flex gap-2">
          <Input
            id={fid("new-pin")}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="max-w-40"
            {...invalid(fid("new-pin"), error ?? undefined)}
          />
          <Button type="submit" variant="outline" size="lg" disabled={pending}>
            {pending ? "Saving…" : "Save PIN"}
          </Button>
        </div>
      </Field>
      {saved ? <FormSuccess message="PIN saved." /> : null}
    </form>
  );
}
