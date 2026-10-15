"use client";

import { useState, useTransition } from "react";
import {
  FormError,
  FormSuccess,
  invalid,
  Select,
} from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { savePaymentMethod } from "@/lib/actions/catalog";
import {
  fieldErrors,
  paymentMethodSchema,
  type PaymentMethodFormValues,
  type PaymentTypeValue,
} from "@/lib/validation";

export type PaymentMethodRow = {
  id: string;
  type: PaymentTypeValue;
  name: string;
  is_enabled: boolean;
  requires_reference: boolean;
  sort_order: number;
};

const TYPE_LABELS: Record<PaymentTypeValue, string> = {
  cash: "Cash",
  card: "Card",
  mobile_money: "Mobile money",
  other: "Other",
};

function toValues(row: PaymentMethodRow): PaymentMethodFormValues {
  return {
    type: row.type,
    name: row.name,
    isEnabled: row.is_enabled,
    requiresReference: row.requires_reference,
    sortOrder: String(row.sort_order),
  };
}

export function PaymentMethodsEditor({
  methods,
}: {
  methods: PaymentMethodRow[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col divide-y rounded-xl border">
        {methods.map((m) => (
          <MethodRow
            key={`${m.id}:${m.name}:${m.is_enabled}:${m.requires_reference}:${m.sort_order}`}
            method={m}
          />
        ))}
      </div>
      <AddMethod />
    </div>
  );
}

function MethodRow({ method }: { method: PaymentMethodRow }) {
  const initial = toValues(method);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const id = `pm-${method.id}`;

  function save() {
    const parsed = paymentMethodSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setError(null);
    startTransition(async () => {
      const result = await savePaymentMethod(method.id, values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setError(result.error);
      }
    });
  }

  return (
    <div
      className="flex flex-col gap-3 p-4"
      data-testid={`payment-method-${method.type}`}
    >
      <div className="flex flex-wrap items-center gap-4">
        <span className="w-28 text-sm text-muted-foreground">
          {TYPE_LABELS[method.type]}
        </span>
        <Input
          aria-label={`${method.name} name`}
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          className="w-48"
          {...invalid(`${id}-name`, errors.name)}
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={values.isEnabled}
            onCheckedChange={(checked) =>
              setValues({ ...values, isEnabled: checked })
            }
            aria-label={`${method.name} enabled`}
          />
          Enabled
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={values.type !== "cash" && values.requiresReference}
            disabled={values.type === "cash"}
            onCheckedChange={(checked) =>
              setValues({ ...values, requiresReference: checked })
            }
            aria-label={`${method.name} needs a reference`}
          />
          Needs a reference number
        </label>
        <Button
          size="lg"
          variant="outline"
          disabled={!dirty || pending}
          onClick={save}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {errors.name ? (
        <p className="text-sm text-destructive">{errors.name}</p>
      ) : null}
      <FormError message={error} />
    </div>
  );
}

function AddMethod() {
  const empty: PaymentMethodFormValues = {
    type: "mobile_money",
    name: "",
    isEnabled: true,
    requiresReference: true,
    sortOrder: "50",
  };
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [pending, startTransition] = useTransition();

  function add(event: React.FormEvent) {
    event.preventDefault();
    setAdded(false);
    const parsed = paymentMethodSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setError(null);
    startTransition(async () => {
      const result = await savePaymentMethod(null, values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setError(result.error);
        return;
      }
      setValues(empty);
      setAdded(true);
    });
  }

  return (
    <form
      onSubmit={add}
      className="flex flex-col gap-3 rounded-xl border border-dashed p-4"
      noValidate
    >
      <h2 className="font-semibold">Add a payment method</h2>
      <p className="text-sm text-muted-foreground">
        For example a second mobile money network or a voucher scheme.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Select
          aria-label="Type"
          value={values.type}
          onChange={(e) =>
            setValues({ ...values, type: e.target.value as PaymentTypeValue })
          }
          className="w-40"
        >
          <option value="card">Card</option>
          <option value="mobile_money">Mobile money</option>
          <option value="other">Other</option>
        </Select>
        <Input
          aria-label="Name"
          placeholder="Name"
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          className="w-48"
          {...invalid("new-method-name", errors.name)}
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={values.requiresReference}
            onCheckedChange={(checked) =>
              setValues({ ...values, requiresReference: checked })
            }
            aria-label="New method needs a reference"
          />
          Needs a reference number
        </label>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      {errors.name ? (
        <p className="text-sm text-destructive">{errors.name}</p>
      ) : null}
      <FormError message={error} />
      {added ? <FormSuccess message="Payment method added." /> : null}
    </form>
  );
}
