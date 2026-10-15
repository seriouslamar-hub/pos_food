"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FormError, invalid, Select } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createDevice,
  updateDevice,
  type SetupCode,
} from "@/lib/actions/devices";
import {
  DEVICE_TYPE_LABELS,
  suggestDeviceCode,
  type DeviceKind,
} from "@/lib/devices";
import {
  deviceSchema,
  fieldErrors,
  type DeviceFormValues,
} from "@/lib/validation";
import { SetupCodePanel } from "./setup-code-panel";

export type ExistingDevice = { id: string; branchId: string; code: string };

const TYPES: DeviceKind[] = ["till", "kds", "pickup"];

export function DeviceForm({
  deviceId,
  initial,
  branches,
  existing,
}: {
  deviceId?: string;
  initial: DeviceFormValues;
  branches: { id: string; name: string }[];
  existing: ExistingDevice[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [codeEdited, setCodeEdited] = useState(Boolean(deviceId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    name: string;
    setupCode: SetupCode | null;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const codesInBranch = (branchId: string) =>
    existing
      .filter((d) => d.branchId === branchId && d.id !== deviceId)
      .map((d) => d.code);

  function set<K extends keyof DeviceFormValues>(
    key: K,
    value: DeviceFormValues[K],
  ) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      // Keep suggesting the next free code until the admin types their own.
      if (
        !codeEdited &&
        (key === "type" || key === "branchId") &&
        next.branchId
      ) {
        next.code = suggestDeviceCode(
          next.type as DeviceKind,
          codesInBranch(next.branchId),
        );
      }
      return next;
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = deviceSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setFormError("Check the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      if (deviceId) {
        const result = await updateDevice(deviceId, values);
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {});
          setFormError(result.error);
          return;
        }
        router.push("/admin/devices?notice=saved");
        return;
      }
      const result = await createDevice(values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      setCreated({
        name: values.name,
        setupCode: result.data?.setupCode ?? null,
      });
    });
  }

  if (created) {
    return (
      <SetupCodePanel
        deviceName={created.name}
        setupCode={created.setupCode}
        doneHref="/admin/devices"
      />
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex max-w-2xl flex-col gap-5"
      noValidate
    >
      <FormError message={formError} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="branchId" label="Branch" error={errors.branchId}>
          <Select
            id="branchId"
            value={values.branchId}
            onChange={(e) => set("branchId", e.target.value)}
            {...invalid("branchId", errors.branchId)}
          >
            <option value="">Choose a branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="type" label="Type" error={errors.type}>
          <Select
            id="type"
            value={values.type}
            onChange={(e) =>
              set("type", e.target.value as DeviceFormValues["type"])
            }
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {DEVICE_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="name"
          label="Name"
          error={errors.name}
          hint="For example “Front counter” or “Grill screen”."
        >
          <Input
            id="name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            {...invalid("name", errors.name)}
          />
        </Field>
        <Field
          id="code"
          label="Short code"
          error={errors.code}
          hint="Unique in the branch. Starts offline order numbers, like T1-042."
        >
          <Input
            id="code"
            value={values.code}
            onChange={(e) => {
              setCodeEdited(true);
              setValues((prev) => ({
                ...prev,
                code: e.target.value.toUpperCase(),
              }));
            }}
            className="max-w-32 font-mono uppercase"
            {...invalid("code", errors.code)}
          />
        </Field>
      </div>
      {values.type === "kds" ? (
        <Field
          id="station"
          label="Kitchen station"
          error={errors.station}
          hint="Leave empty to show every station."
        >
          <Input
            id="station"
            value={values.station}
            onChange={(e) => set("station", e.target.value)}
          />
        </Field>
      ) : null}
      <div className="flex items-center gap-3">
        <Checkbox
          id="isActive"
          checked={values.isActive}
          onCheckedChange={(checked) => set("isActive", checked === true)}
        />
        <Label htmlFor="isActive">
          Active (an inactive device is signed out and can&apos;t be used)
        </Label>
      </div>
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : deviceId ? "Save device" : "Create device"}
        </Button>
      </div>
    </form>
  );
}
