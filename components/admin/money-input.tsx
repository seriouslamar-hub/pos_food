import { Input } from "@/components/ui/input";
import { currencySymbol } from "@/lib/money";
import { cn } from "@/lib/utils";

/** A text input for an amount, with the currency symbol in front. */
export function MoneyInput({
  currency,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type" | "inputMode"> & {
  currency: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        className,
      )}
    >
      <span className="pl-3 text-sm text-muted-foreground" aria-hidden>
        {currencySymbol(currency)}
      </span>
      <Input
        type="text"
        inputMode="decimal"
        className="border-0 shadow-none focus-visible:ring-0"
        {...props}
      />
    </div>
  );
}
