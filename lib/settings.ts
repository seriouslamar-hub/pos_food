import { bpsToPercentInput, parsePercentToBps } from "./percent";

/**
 * Settings an admin can change. Each has a global default (branch_id null) and
 * an optional per-branch override in the settings table.
 */
export type SettingDefinition =
  | {
      key: string;
      label: string;
      help?: string;
      kind: "integer";
      min: number;
      max: number;
      fallback: number;
    }
  | {
      key: string;
      label: string;
      help?: string;
      kind: "percent";
      fallback: number;
    }
  | {
      key: string;
      label: string;
      help?: string;
      kind: "boolean";
      fallback: boolean;
    }
  | {
      key: string;
      label: string;
      help?: string;
      kind: "choice";
      options: { value: number; label: string }[];
      fallback: number;
    };

export const SETTINGS: SettingDefinition[] = [
  {
    key: "till.auto_lock_minutes",
    label: "Lock tills after this many idle minutes",
    help: "0 turns auto-lock off.",
    kind: "integer",
    min: 0,
    max: 120,
    fallback: 5,
  },
  {
    key: "staff.default_cashier_discount_bps",
    label: "Discount limit for new cashiers (%)",
    help: "Pre-filled when someone adds a cashier. Above their limit, cashiers need a manager's approval.",
    kind: "percent",
    fallback: 0,
  },
  {
    key: "orders.number_reset_daily",
    label: "Start order numbers again each day",
    kind: "boolean",
    fallback: true,
  },
  {
    key: "orders.pay_later_dine_in",
    label: "Dine-in orders can go to the kitchen before they're paid",
    help: "Adds a “Send to kitchen, pay later” button for dine-in orders. Unpaid orders are listed on the till until someone takes payment.",
    kind: "boolean",
    fallback: false,
  },
  {
    key: "receipt.auto_print",
    label: "Print a receipt after every sale",
    help: "When off, the cashier taps Print receipt if the customer wants one.",
    kind: "boolean",
    fallback: false,
  },
  {
    key: "print.kitchen_tickets",
    label: "Print kitchen tickets",
    help: "For branches without a kitchen screen: the till prints a ticket for the kitchen when an order is paid or sent.",
    kind: "boolean",
    fallback: false,
  },
  {
    key: "receipt.paper_width_mm",
    label: "Receipt paper width",
    kind: "choice",
    options: [
      { value: 58, label: "58 mm" },
      { value: 80, label: "80 mm" },
    ],
    fallback: 80,
  },
  {
    key: "kds.ticket_warn_minutes",
    label: "Kitchen tickets turn amber after (minutes)",
    kind: "integer",
    min: 1,
    max: 60,
    fallback: 3,
  },
  {
    key: "kds.ticket_late_minutes",
    label: "Kitchen tickets turn red after (minutes)",
    kind: "integer",
    min: 1,
    max: 120,
    fallback: 5,
  },
];

export type SettingValue = number | boolean;

/** A stored jsonb value, checked against the definition; null if unusable. */
export function readSetting(
  def: SettingDefinition,
  value: unknown,
): SettingValue | null {
  switch (def.kind) {
    case "boolean":
      return typeof value === "boolean" ? value : null;
    case "percent":
      return Number.isInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= 10000
        ? (value as number)
        : null;
    case "integer":
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    case "choice":
      return def.options.some((o) => o.value === value)
        ? (value as number)
        : null;
  }
}

/**
 * The value that applies to a branch: its own override, then the global
 * default (branch_id null), then the built-in fallback.
 */
export function effectiveSetting(
  key: string,
  rows: { key: string; branch_id: string | null; value: unknown }[] | null,
  branchId: string | null,
): SettingValue {
  const def = SETTINGS.find((s) => s.key === key);
  if (!def) throw new Error(`Unknown setting ${key}`);
  const forKey = rows?.filter((r) => r.key === key) ?? [];
  const row =
    (branchId ? forKey.find((r) => r.branch_id === branchId) : undefined) ??
    forKey.find((r) => r.branch_id === null);
  return (row ? readSetting(def, row.value) : null) ?? def.fallback;
}

/** The value shown in a form field. */
export function settingToInput(
  def: SettingDefinition,
  value: SettingValue,
): string {
  if (def.kind === "percent") return bpsToPercentInput(value as number);
  return String(value);
}

/** Parses form input; returns the value or an error message. */
export function parseSettingInput(
  def: SettingDefinition,
  input: string,
): { ok: true; value: SettingValue } | { ok: false; error: string } {
  const text = input.trim();
  switch (def.kind) {
    case "boolean":
      if (text === "true" || text === "false")
        return { ok: true, value: text === "true" };
      return { ok: false, error: "Choose yes or no." };
    case "percent": {
      try {
        const bps = parsePercentToBps(text);
        if (bps < 0 || bps > 10000)
          return { ok: false, error: "Enter a percentage from 0 to 100." };
        return { ok: true, value: bps };
      } catch {
        return { ok: false, error: "Enter a percentage, like 10 or 12.5." };
      }
    }
    case "integer": {
      if (!/^\d+$/.test(text))
        return { ok: false, error: "Enter a whole number." };
      const n = Number(text);
      if (n < def.min || n > def.max) {
        return {
          ok: false,
          error: `Enter a number from ${def.min} to ${def.max}.`,
        };
      }
      return { ok: true, value: n };
    }
    case "choice": {
      const option = def.options.find((o) => String(o.value) === text);
      return option
        ? { ok: true, value: option.value }
        : { ok: false, error: "Choose an option." };
    }
  }
}

/** Rules that involve more than one setting. Returns errors by key. */
export function crossCheckSettings(
  values: Record<string, SettingValue>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const warn = values["kds.ticket_warn_minutes"];
  const late = values["kds.ticket_late_minutes"];
  if (typeof warn === "number" && typeof late === "number" && late <= warn) {
    errors["kds.ticket_late_minutes"] = "Must be more than the amber time.";
  }
  return errors;
}
