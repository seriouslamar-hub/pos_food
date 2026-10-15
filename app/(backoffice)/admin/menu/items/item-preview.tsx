import { MenuTile } from "@/components/till/menu-grid";
import { formatAmount } from "@/lib/money";

export type PreviewGroup = {
  name: string;
  rule: string;
  modifiers: { name: string; priceDelta: number }[];
};
export type PreviewSlot = {
  name: string;
  required: boolean;
  options: { name: string; upcharge: number; isDefault: boolean }[];
};

function delta(amount: number, currency: string) {
  if (amount === 0) return "";
  return ` ${amount > 0 ? "+" : "−"}${formatAmount(Math.abs(amount), currency)}`;
}

/** How the item looks on the till, and what the till asks when it's tapped. */
export function ItemPreview({
  item,
  currency,
  groups,
  slots,
}: {
  item: {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
    type: "item" | "combo";
  };
  currency: string;
  groups: PreviewGroup[];
  slots: PreviewSlot[];
}) {
  return (
    <div className="flex flex-wrap gap-6" data-testid="till-preview">
      <div className="w-56">
        <MenuTile item={item} currency={currency} sellable />
      </div>
      <div className="flex min-w-64 flex-1 flex-col gap-3 rounded-xl border p-4">
        <p className="text-sm text-muted-foreground">When a cashier taps it:</p>
        {!groups.length && !slots.length ? (
          <p className="text-sm">It goes straight into the order.</p>
        ) : null}
        {slots.map((slot, i) => (
          <div key={slot.name} className="flex flex-col gap-2">
            <p className="font-medium">
              Step {i + 1}: {slot.name}
              {!slot.required ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  (optional)
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {slot.options.map((o) => (
                <span
                  key={o.name}
                  className={`rounded-lg border px-3 py-2 text-sm ${o.isDefault ? "border-foreground font-medium" : ""}`}
                >
                  {o.name}
                  {delta(o.upcharge, currency)}
                </span>
              ))}
            </div>
          </div>
        ))}
        {groups.map((group) => (
          <div key={group.name} className="flex flex-col gap-2">
            <p className="font-medium">
              {group.name}{" "}
              <span className="font-normal text-muted-foreground">
                · {group.rule}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {group.modifiers.map((m) => (
                <span
                  key={m.name}
                  className="rounded-lg border px-3 py-2 text-sm"
                >
                  {m.name}
                  {delta(m.priceDelta, currency)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Choose 1", "Choose up to 3", "Choose 1 to 2", "Optional". */
export function groupRule(min: number, max: number): string {
  if (min === max) return `Choose ${min}`;
  if (min === 0)
    return max === 1 ? "Optional, pick 1" : `Optional, up to ${max}`;
  return `Choose ${min} to ${max}`;
}
