"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FormError, invalid, Select } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { savePromotion } from "@/lib/actions/promotions";
import {
  CHANNELS,
  ORDER_TYPES,
  parsePromotion,
  PROMOTION_TYPES,
  WEEKDAYS,
  type PromotionFormValues,
} from "@/lib/promotion-form";
import { useFieldIds } from "@/lib/use-field-ids";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

/** Tick boxes laid out as chips; nothing ticked means "all". */
function Chips<T extends string | number>({
  legend,
  hint,
  options,
  selected,
  onChange,
}: {
  legend: string;
  hint?: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <label
              key={String(o.value)}
              className={cn(
                "flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm",
                on && "border-foreground bg-muted",
              )}
            >
              <Checkbox
                checked={on}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...selected, o.value]
                      : selected.filter((x) => x !== o.value),
                  )
                }
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PromotionForm({
  promotionId,
  initial,
  currency,
  items,
  categories,
  branches,
}: {
  promotionId?: string;
  initial: PromotionFormValues;
  currency: string;
  items: Option[];
  categories: Option[];
  branches: Option[];
}) {
  const fid = useFieldIds();
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof PromotionFormValues>(
    key: K,
    value: PromotionFormValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parsePromotion(values, currency);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setFormError("Check the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await savePromotion(promotionId ?? null, values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      router.push(
        `/admin/promotions?notice=${promotionId ? "saved" : "created"}`,
      );
    });
  }

  const type = PROMOTION_TYPES.find((t) => t.value === values.type);
  return (
    <form
      onSubmit={submit}
      className="flex max-w-3xl flex-col gap-6"
      noValidate
    >
      <FormError message={formError} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={fid("name")}
          label="Name"
          error={errors.name}
          hint="Shown on the till and the receipt."
        >
          <Input
            id={fid("name")}
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            {...invalid(fid("name"), errors.name)}
          />
        </Field>
        <Field
          id={fid("type")}
          label="Type"
          error={errors.type}
          hint={type?.help}
        >
          <Select
            id={fid("type")}
            value={values.type}
            onChange={(e) =>
              set("type", e.target.value as PromotionFormValues["type"])
            }
          >
            {PROMOTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id={fid("description")} label="Description (optional)">
        <Textarea
          id={fid("description")}
          rows={2}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-3">
        {values.type === "percent_off" ? (
          <Field id={fid("percent")} label="Percent off" error={errors.percent}>
            <Input
              id={fid("percent")}
              inputMode="decimal"
              value={values.percent}
              onChange={(e) => set("percent", e.target.value)}
              className="max-w-32"
              {...invalid(fid("percent"), errors.percent)}
            />
          </Field>
        ) : null}
        {values.type === "amount_off" || values.type === "fixed_price" ? (
          <Field
            id={fid("amount")}
            label={
              values.type === "amount_off" ? "Amount off" : "Price of each item"
            }
            error={errors.amount}
          >
            <Input
              id={fid("amount")}
              inputMode="decimal"
              value={values.amount}
              onChange={(e) => set("amount", e.target.value)}
              className="max-w-40"
              {...invalid(fid("amount"), errors.amount)}
            />
          </Field>
        ) : null}
        {values.type === "buy_x_get_y" ? (
          <>
            <Field id={fid("buy")} label="Buy" error={errors.buyQuantity}>
              <Input
                id={fid("buy")}
                inputMode="numeric"
                value={values.buyQuantity}
                onChange={(e) => set("buyQuantity", e.target.value)}
                className="max-w-24"
                {...invalid(fid("buy"), errors.buyQuantity)}
              />
            </Field>
            <Field id={fid("get")} label="Get" error={errors.getQuantity}>
              <Input
                id={fid("get")}
                inputMode="numeric"
                value={values.getQuantity}
                onChange={(e) => set("getQuantity", e.target.value)}
                className="max-w-24"
                {...invalid(fid("get"), errors.getQuantity)}
              />
            </Field>
            <Field
              id={fid("getPercent")}
              label="Percent off those (100 = free)"
              error={errors.percent}
            >
              <Input
                id={fid("getPercent")}
                inputMode="decimal"
                value={values.percent}
                placeholder="100"
                onChange={(e) => set("percent", e.target.value)}
                className="max-w-24"
              />
            </Field>
          </>
        ) : null}
      </div>

      <Chips
        legend="Items"
        hint="Which items it applies to. Tick none for every item."
        options={items}
        selected={values.itemIds}
        onChange={(v) => set("itemIds", v)}
      />
      <Chips
        legend="Or whole categories"
        options={categories}
        selected={values.categoryIds}
        onChange={(v) => set("categoryIds", v)}
      />

      <div className="grid gap-5 sm:grid-cols-4">
        <Field id={fid("startDate")} label="From" error={errors.startDate}>
          <Input
            id={fid("startDate")}
            type="date"
            value={values.startDate}
            onChange={(e) => set("startDate", e.target.value)}
          />
        </Field>
        <Field id={fid("endDate")} label="Until" error={errors.endDate}>
          <Input
            id={fid("endDate")}
            type="date"
            value={values.endDate}
            onChange={(e) => set("endDate", e.target.value)}
          />
        </Field>
        <Field id={fid("startTime")} label="Daily from" hint="Branch time">
          <Input
            id={fid("startTime")}
            type="time"
            value={values.startTime}
            onChange={(e) => set("startTime", e.target.value)}
          />
        </Field>
        <Field id={fid("endTime")} label="Daily until" error={errors.endTime}>
          <Input
            id={fid("endTime")}
            type="time"
            value={values.endTime}
            onChange={(e) => set("endTime", e.target.value)}
          />
        </Field>
      </div>
      <Chips
        legend="Days"
        hint="Tick none for every day."
        options={WEEKDAYS.map((d, i) => ({ value: i + 1, label: d }))}
        selected={values.daysOfWeek}
        onChange={(v) => set("daysOfWeek", v)}
      />
      <Chips
        legend="Branches"
        hint="Tick none for every branch."
        options={branches}
        selected={values.branchIds}
        onChange={(v) => set("branchIds", v)}
      />
      <Chips
        legend="Channels"
        options={CHANNELS}
        selected={values.channels}
        onChange={(v) => set("channels", v)}
      />
      <Chips
        legend="Order types"
        options={ORDER_TYPES}
        selected={values.orderTypes}
        onChange={(v) => set("orderTypes", v)}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={fid("minSpend")}
          label="Minimum spend (optional)"
          error={errors.minSpend}
        >
          <Input
            id={fid("minSpend")}
            inputMode="decimal"
            value={values.minSpend}
            onChange={(e) => set("minSpend", e.target.value)}
            className="max-w-40"
          />
        </Field>
        <Field
          id={fid("coupon")}
          label="Coupon code (optional)"
          error={errors.couponCode}
          hint="With a code, it applies only when the cashier enters it."
        >
          <Input
            id={fid("coupon")}
            value={values.couponCode}
            onChange={(e) => set("couponCode", e.target.value.toUpperCase())}
            className="max-w-56 font-mono uppercase"
            {...invalid(fid("coupon"), errors.couponCode)}
          />
        </Field>
        <Field
          id={fid("maxUses")}
          label="Most uses in total (optional)"
          error={errors.maxUses}
        >
          <Input
            id={fid("maxUses")}
            inputMode="numeric"
            value={values.maxUses}
            onChange={(e) => set("maxUses", e.target.value)}
            className="max-w-32"
          />
        </Field>
        <Field
          id={fid("perCustomer")}
          label="Most uses per customer (optional)"
          error={errors.maxUsesPerCustomer}
          hint="Then it needs a loyalty customer on the order."
        >
          <Input
            id={fid("perCustomer")}
            inputMode="numeric"
            value={values.maxUsesPerCustomer}
            onChange={(e) => set("maxUsesPerCustomer", e.target.value)}
            className="max-w-32"
          />
        </Field>
        <Field
          id={fid("priority")}
          label="Priority"
          error={errors.priority}
          hint="Higher goes first."
        >
          <Input
            id={fid("priority")}
            inputMode="numeric"
            value={values.priority}
            onChange={(e) => set("priority", e.target.value)}
            className="max-w-24"
          />
        </Field>
      </div>
      <div className="flex flex-col gap-3">
        <label className="flex min-h-10 items-center gap-3">
          <Checkbox
            checked={values.stackable}
            onCheckedChange={(c) => set("stackable", c === true)}
          />
          Stacks with other promotions (otherwise it applies on its own)
        </label>
        <label className="flex min-h-10 items-center gap-3">
          <Checkbox
            checked={values.isActive}
            onCheckedChange={(c) => set("isActive", c === true)}
          />
          Active
        </label>
      </div>
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending
            ? "Saving…"
            : promotionId
              ? "Save promotion"
              : "Add promotion"}
        </Button>
      </div>
    </form>
  );
}
