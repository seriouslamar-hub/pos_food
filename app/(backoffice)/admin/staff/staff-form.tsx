"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Field,
  FormError,
  invalid,
  SecretPanel,
  Select,
} from "@/components/admin/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createStaff,
  updateStaff,
  type Credentials,
} from "@/lib/actions/staff";
import {
  fieldErrors,
  staffCreateSchema,
  staffSchema,
  type StaffFormValues,
} from "@/lib/validation";
import { useFieldIds } from "@/lib/use-field-ids";

export type BranchOption = { id: string; name: string };

/** Admin form for any staff member. Creating an admin or manager makes a login. */
export function StaffForm({
  staffId,
  initial,
  branches,
}: {
  staffId?: string;
  initial: StaffFormValues;
  branches: BranchOption[];
}) {
  const fid = useFieldIds();
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    credentials: Credentials;
    pinError?: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const isCreate = !staffId;
  const needsLogin = values.role !== "cashier";
  const listHref = `/admin/staff?notice=${isCreate ? "created" : "saved"}`;

  function set<K extends keyof StaffFormValues>(
    key: K,
    value: StaffFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = (isCreate ? staffCreateSchema : staffSchema).safeParse(
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
        const result = await createStaff(values);
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {});
          setFormError(result.error);
          return;
        }
        if (result.data?.credentials) {
          setDone({
            credentials: result.data.credentials,
            pinError: result.data.pinError,
          });
        } else if (result.data?.pinError) {
          router.push(`/admin/staff/${result.data.id}?notice=pin-not-set`);
        } else {
          router.push(listHref);
        }
        return;
      }
      const result = await updateStaff(staffId, values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      if (result.data?.credentials)
        setDone({ credentials: result.data.credentials });
      else router.push(listHref);
    });
  }

  if (done) {
    return (
      <SecretPanel
        title={`Login for ${values.fullName}`}
        rows={[
          {
            label: "Email",
            value: done.credentials.email,
            testId: "credential-email",
          },
          {
            label: "Temporary password",
            value: done.credentials.password,
            testId: "credential-password",
          },
        ]}
      >
        <p className="text-sm">
          Give these to {values.fullName.split(" ")[0]} in person. They sign in
          at <strong>/login</strong>.
        </p>
        {done.pinError ? (
          <FormError
            message={`The PIN wasn't set: ${done.pinError} Set it from their page.`}
          />
        ) : null}
        <Link
          href={listHref}
          className={buttonVariants({ size: "lg", className: "self-start" })}
        >
          Done
        </Link>
      </SecretPanel>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex max-w-2xl flex-col gap-5"
      noValidate
    >
      <FormError message={formError} />

      <Field id={fid("fullName")} label="Full name" error={errors.fullName}>
        <Input
          id={fid("fullName")}
          value={values.fullName}
          onChange={(e) => set("fullName", e.target.value)}
          {...invalid(fid("fullName"), errors.fullName)}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={fid("role")} label="Role" error={errors.role}>
          <Select
            id={fid("role")}
            value={values.role}
            onChange={(e) =>
              set("role", e.target.value as StaffFormValues["role"])
            }
          >
            <option value="cashier">Cashier</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
        <Field
          id={fid("branchId")}
          label="Branch"
          error={errors.branchId}
          hint={
            values.role === "admin"
              ? "Admins can work in every branch."
              : undefined
          }
        >
          <Select
            id={fid("branchId")}
            value={values.branchId}
            onChange={(e) => set("branchId", e.target.value)}
            {...invalid(fid("branchId"), errors.branchId)}
          >
            <option value="">
              {values.role === "admin"
                ? "Head office (no branch)"
                : "Choose a branch"}
            </option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={fid("email")}
          label={needsLogin ? "Email (to sign in)" : "Email (optional)"}
          error={errors.email}
          hint={
            needsLogin
              ? "They sign in to the back office with this."
              : "Cashiers don't need one."
          }
        >
          <Input
            id={fid("email")}
            type="email"
            autoComplete="off"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            {...invalid(fid("email"), errors.email)}
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

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={fid("discountPercent")}
          label="Discount limit (%)"
          error={errors.discountPercent}
          hint="Bigger discounts need a manager's approval."
        >
          <Input
            id={fid("discountPercent")}
            inputMode="decimal"
            value={values.discountPercent}
            onChange={(e) => set("discountPercent", e.target.value)}
            {...invalid(fid("discountPercent"), errors.discountPercent)}
          />
        </Field>
        {isCreate ? (
          <Field
            id={fid("pin")}
            label="Till PIN (optional)"
            error={errors.pin}
            hint="4 to 6 digits. You can set it later."
          >
            <Input
              id={fid("pin")}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={values.pin ?? ""}
              onChange={(e) => set("pin", e.target.value)}
              {...invalid(fid("pin"), errors.pin)}
            />
          </Field>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <Checkbox
          id={fid("isActive")}
          checked={values.isActive}
          onCheckedChange={(checked) => set("isActive", checked === true)}
        />
        <Label htmlFor={fid("isActive")}>Active</Label>
      </div>
      {!values.isActive ? (
        <p className="text-sm text-muted-foreground">
          Inactive staff can&apos;t sign in or use the till. Reactivating
          someone clears their PIN.
        </p>
      ) : null}

      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : isCreate ? "Add staff member" : "Save"}
        </Button>
      </div>
    </form>
  );
}
