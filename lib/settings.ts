import { defaultDenominations } from "./cash";
import {
  formatAmount,
  MoneyParseError,
  parseMoney,
  toMoneyInput,
} from "./money";
import { bpsToPercentInput, parsePercentToBps } from "./percent";

/**
 * Notes and coins a till counts, in the minor units of `currency` (a list
 * saved for one currency never applies to a branch in another). No values
 * means the built-in list for the branch's currency.
 */
export type Denominations = { currency: string; values: number[] };

/**
 * Settings an admin can change. Each has a global default (branch_id null) and
 * an optional per-branch override in the settings table. Money settings are
 * read in each branch's currency.
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
    }
  | {
      key: string;
      label: string;
      help?: string;
      kind: "money";
      fallback: number;
    }
  | {
      key: string;
      label: string;
      help?: string;
      kind: "denominations";
      fallback: Denominations;
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
    key: "offline.print_kitchen_tickets",
    label: "Print kitchen tickets for sales made offline",
    help: "The kitchen screen can't get orders while a till is offline, so the till prints them.",
    kind: "boolean",
    fallback: true,
  },
  {
    key: "offline.card_payments",
    label: "Take card and mobile money while offline",
    help: "The cashier types the reference from the terminal or phone. When off, an offline till takes cash only.",
    kind: "boolean",
    fallback: true,
  },
  {
    key: "cash.variance_alert",
    label: "Highlight cash differences above",
    help: "Shifts whose counted cash is off by more than this stand out for the manager.",
    kind: "money",
    fallback: 500,
  },
  {
    key: "cash.denominations",
    label: "Notes and coins to count",
    help: "Largest first, separated by commas. Tills count the float and the drawer with these.",
    kind: "denominations",
    fallback: { currency: "", values: [] },
  },
  {
    key: "kds.sound",
    label: "Kitchen screens beep for new tickets and voids",
    kind: "boolean",
    fallback: true,
  },
  {
    key: "pickup.ready_minutes",
    label: "Pickup board shows ready orders for (minutes)",
    help: "Or until the till marks them collected.",
    kind: "integer",
    min: 1,
    max: 60,
    fallback: 10,
  },
  {
    key: "pickup.chime",
    label: "Pickup board chimes when an order is ready",
    kind: "boolean",
    fallback: true,
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

export type SettingValue = number | boolean | Denominations;

const MAX_MONEY_SETTING = 100_000_000;
const MAX_DENOMINATIONS = 30;

function readDenominations(value: unknown): Denominations | null {
  const v = value as Partial<Denominations> | null;
  if (
    !v ||
    typeof v !== "object" ||
    typeof v.currency !== "string" ||
    !/^[A-Z]{3}$/.test(v.currency) ||
    !Array.isArray(v.values) ||
    v.values.length > MAX_DENOMINATIONS ||
    !v.values.every((n) => Number.isSafeInteger(n) && n > 0)
  ) {
    return null;
  }
  return {
    currency: v.currency,
    values: [...new Set(v.values)].sort((a, b) => b - a),
  };
}

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
    case "money":
      return Number.isSafeInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= MAX_MONEY_SETTING
        ? (value as number)
        : null;
    case "denominations":
      return readDenominations(value);
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

/**
 * The notes and coins a branch counts: its own list, else the default list
 * if it's for the same currency, else the built-in list for the currency.
 */
export function denominationsFor(
  rows: { key: string; branch_id: string | null; value: unknown }[] | null,
  branchId: string,
  currency: string,
): number[] {
  const lists = (rows ?? [])
    .filter((r) => r.key === "cash.denominations")
    .sort((a, b) =>
      a.branch_id === branchId ? -1 : b.branch_id === branchId ? 1 : 0,
    )
    .filter((r) => r.branch_id === branchId || r.branch_id === null)
    .map((r) => readDenominations(r.value))
    .filter((d) => d !== null && d.currency === currency && d.values.length);
  return lists[0]?.values ?? defaultDenominations(currency);
}

/** Amounts as typed in a form, e.g. "200, 100, 0.50". */
function amountsToInput(values: number[], currency: string): string {
  return values
    .map((v) => toMoneyInput(v, currency).replace(/\.0+$/, ""))
    .join(", ");
}

/**
 * The value shown in a form field. Money is shown in `currency`: the
 * branch's currency, or the main currency for the defaults.
 */
export function settingToInput(
  def: SettingDefinition,
  value: SettingValue,
  currency: string,
): string {
  switch (def.kind) {
    case "percent":
      return bpsToPercentInput(value as number);
    case "money":
      return toMoneyInput(value as number, currency);
    case "denominations": {
      const list = value as Denominations;
      return amountsToInput(
        list.currency === currency && list.values.length
          ? list.values
          : defaultDenominations(currency),
        currency,
      );
    }
    default:
      return String(value);
  }
}

/** A setting value for people to read, e.g. in "Use default (…)". */
export function describeSetting(
  def: SettingDefinition,
  value: SettingValue,
  currency: string,
): string {
  switch (def.kind) {
    case "boolean":
      return value ? "Yes" : "No";
    case "choice":
      return def.options.find((o) => o.value === value)?.label ?? String(value);
    case "percent":
      return `${bpsToPercentInput(value as number)}%`;
    case "money":
      return formatAmount(value as number, currency);
    case "denominations": {
      const list = value as Denominations;
      return list.currency === currency && list.values.length
        ? amountsToInput(list.values, currency)
        : `the usual ${currency} notes and coins`;
    }
    default:
      return String(value);
  }
}

/** Parses form input; returns the value or an error message. */
export function parseSettingInput(
  def: SettingDefinition,
  input: string,
  currency: string,
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
    case "money": {
      try {
        const amount = parseMoney(text, currency);
        if (amount < 0 || amount > MAX_MONEY_SETTING)
          return { ok: false, error: "Enter an amount of zero or more." };
        return { ok: true, value: amount };
      } catch (e) {
        if (!(e instanceof MoneyParseError)) throw e;
        return { ok: false, error: "Enter an amount, like 5 or 2.50." };
      }
    }
    case "denominations": {
      const parts = text.split(/[,\s]+/).filter(Boolean);
      const values: number[] = [];
      for (const part of parts) {
        try {
          const amount = parseMoney(part, currency);
          if (amount <= 0) throw new MoneyParseError(part, "not positive");
          values.push(amount);
        } catch (e) {
          if (!(e instanceof MoneyParseError)) throw e;
          return {
            ok: false,
            error: `“${part}” isn't an amount. List amounts like 200, 100, 0.50.`,
          };
        }
      }
      const unique = [...new Set(values)].sort((a, b) => b - a);
      if (unique.length === 0 || unique.length > MAX_DENOMINATIONS) {
        return {
          ok: false,
          error: `List between 1 and ${MAX_DENOMINATIONS} notes and coins.`,
        };
      }
      return { ok: true, value: { currency, values: unique } };
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
