"use client";

import type { MenuPaymentMethod } from "@/lib/menu";
import { cn } from "@/lib/utils";

/** The ways a customer can pay at the counter (not "other"). */
export function counterMethods(
  methods: MenuPaymentMethod[],
): MenuPaymentMethod[] {
  return methods.filter(
    (m) => m.type === "cash" || m.type === "card" || m.type === "mobile_money",
  );
}

/** "How will you pay?": cash, card or mobile money, paid at the counter. */
export function PaymentChoice({
  methods,
  value,
  onChange,
  large = false,
}: {
  methods: MenuPaymentMethod[];
  value: string | null;
  onChange: (type: string) => void;
  large?: boolean;
}) {
  const choices = counterMethods(methods);
  if (choices.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={cn("mb-1 font-medium", large ? "text-xl" : "text-sm")}>
        How will you pay at the counter?
      </legend>
      <div
        role="radiogroup"
        aria-label="How will you pay?"
        className="grid grid-cols-3 gap-2"
      >
        {choices.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={value === m.type}
            onClick={() => onChange(m.type)}
            className={cn(
              "rounded-xl border px-2 font-medium",
              large ? "min-h-20 text-xl" : "min-h-12",
              value === m.type &&
                "border-foreground bg-foreground text-background",
            )}
          >
            {m.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
