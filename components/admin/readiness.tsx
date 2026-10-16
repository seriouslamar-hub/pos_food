import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type Check = {
  done: boolean;
  label: string;
  detail: string;
  href: string;
};

/**
 * "Getting ready to open": what a branch still needs before its first real
 * day, worked out from the database. Disappears once everything is done.
 */
export async function Readiness() {
  const supabase = await createClient();
  const [
    branches,
    taxes,
    items,
    staff,
    devices,
    methods,
    ingredients,
    stock,
    days,
    training,
  ] = await Promise.all([
    supabase
      .from("branches")
      .select("id, name, address, phone, receipt_header, receipt_footer")
      .eq("is_active", true)
      .is("training_for", null),
    supabase.from("taxes").select("tax_category").eq("is_active", true),
    supabase
      .from("menu_items")
      .select("id, tax_category")
      .eq("is_active", true),
    supabase
      .from("staff")
      .select("role, branch_id, has_pin, is_active")
      .eq("is_active", true),
    supabase
      .from("devices")
      .select("type, branch_id, auth_user_id, is_active")
      .eq("is_active", true),
    supabase.from("payment_methods").select("id").eq("is_enabled", true),
    supabase.from("ingredients").select("id").eq("is_active", true),
    supabase
      .from("branch_stock")
      .select("branch_id, quantity_on_hand")
      .gt("quantity_on_hand", 0),
    supabase.from("business_days").select("branch_id").limit(1000),
    supabase.from("branches").select("id").not("training_for", "is", null),
  ]);
  const real = branches.data ?? [];
  if (real.length === 0) return null;

  const taxed = new Set((taxes.data ?? []).map((t) => t.tax_category));
  const untaxed = new Set(
    (items.data ?? []).map((i) => i.tax_category).filter((c) => !taxed.has(c)),
  );
  const people = staff.data ?? [];
  const tills = (devices.data ?? []).filter((d) => d.type === "till");
  const stocked = new Set((stock.data ?? []).map((s) => s.branch_id));
  const opened = new Set((days.data ?? []).map((d) => d.branch_id));

  const checks: Check[] = [
    {
      done: real.every(
        (b) => b.address && b.phone && b.receipt_header && b.receipt_footer,
      ),
      label: "Branch details and receipts",
      detail: "Address, phone, and the header and footer printed on receipts.",
      href: "/admin/branches",
    },
    {
      done: (items.data ?? []).length > 0,
      label: "Your menu and prices",
      detail:
        "Your real items, meals and prices (replace or edit the sample menu).",
      href: "/admin/menu",
    },
    {
      done: taxed.size > 0 && untaxed.size === 0,
      label: "Tax rates",
      detail:
        taxed.size === 0
          ? "No taxes yet: prices are charged without tax. Add the rates your accountant confirms."
          : `Items in ${[...untaxed].join(", ")} have no tax.`,
      href: "/admin/taxes",
    },
    {
      done: (methods.data ?? []).length > 0,
      label: "Payment methods",
      detail:
        "Cash, card and mobile money: which you take, and which need a reference.",
      href: "/admin/payment-methods",
    },
    {
      done: real.every((b) =>
        people.some(
          (p) => p.branch_id === b.id && p.role === "manager" && p.has_pin,
        ),
      ),
      label: "A manager with a PIN",
      detail:
        "Managers approve voids, refunds and discounts at the till with their PIN.",
      href: "/admin/staff",
    },
    {
      done: real.every((b) =>
        people.some(
          (p) => p.branch_id === b.id && p.role === "cashier" && p.has_pin,
        ),
      ),
      label: "Cashiers with PINs",
      detail:
        "Everyone who'll use the till, each with their own 4–6 digit PIN.",
      href: "/admin/staff",
    },
    {
      done: real.every((b) =>
        tills.some((d) => d.branch_id === b.id && d.auth_user_id),
      ),
      label: "A till set up",
      detail:
        "Add the till (and kitchen screen) under Devices, then open the setup code on each tablet.",
      href: "/admin/devices",
    },
    {
      done:
        (ingredients.data ?? []).length === 0 ||
        real.every((b) => stocked.has(b.id)),
      label: "Opening stock",
      detail:
        "Count what's on the shelves (Stock → Counts) or receive your first delivery.",
      href: "/admin/stock",
    },
    {
      done: (training.data ?? []).length > 0,
      label: "Staff practised in training mode",
      detail:
        "Switch a till into training on its device page and let staff practise.",
      href: "/admin/devices",
    },
    {
      done: real.every((b) => opened.has(b.id)),
      label: "Open the first business day",
      detail:
        "On the opening morning: Business day → Open, then each cashier opens their shift.",
      href: "/admin/day",
    },
  ];
  const left = checks.filter((c) => !c.done).length;
  if (left === 0) return null;

  return (
    <section
      aria-label="Getting ready to open"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      data-testid="readiness"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Getting ready to open</h2>
        <span className="text-sm text-muted-foreground">
          {checks.length - left} of {checks.length} done
        </span>
      </div>
      <ul className="flex flex-col divide-y">
        {checks.map((c) => (
          <li key={c.label}>
            <Link
              href={c.href}
              className="flex items-start gap-3 py-2 hover:bg-muted/50"
              data-done={c.done || undefined}
            >
              {c.done ? (
                <CheckCircle2Icon
                  className="mt-0.5 size-5 shrink-0 text-foreground"
                  aria-label="Done"
                />
              ) : (
                <CircleIcon
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  aria-label="To do"
                />
              )}
              <span className="flex flex-col">
                <span
                  className={
                    c.done
                      ? "text-muted-foreground line-through"
                      : "font-medium"
                  }
                >
                  {c.label}
                </span>
                {c.done ? null : (
                  <span className="text-sm text-muted-foreground">
                    {c.detail}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
