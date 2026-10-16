import { addDays, isIsoDate } from "./datetime";
import { formatAmount } from "./money";

export type CsvCell = string | number | boolean | null | undefined;

/**
 * CSV that Excel opens correctly: a byte-order mark so it reads UTF-8,
 * CRLF line ends, and quotes around anything with a comma, quote or line
 * break. Cells that start with = + - @ are prefixed with ' so a
 * spreadsheet never runs them as formulas (numbers are left alone).
 */
export function toCsv(rows: CsvCell[][], withBom = true): string {
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return (withBom ? "﻿" : "") + body + "\r\n";
}

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Minor units as a plain decimal for spreadsheets: 1250 → "12.50". */
export function csvAmount(minor: number, digits = 2): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  if (digits === 0) return `${sign}${abs}`;
  const unit = 10 ** digits;
  return `${sign}${Math.floor(abs / unit)}.${String(abs % unit).padStart(digits, "0")}`;
}

/** Inclusive date windows of at most `days` days covering from–to. */
export function dateWindows(
  from: string,
  to: string,
  days = 31,
): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let start = from;
  while (start <= to) {
    const end = addDays(start, days - 1);
    out.push({ from: start, to: end < to ? end : to });
    start = addDays(end, 1);
  }
  return out;
}

/** Change against a comparison, as a whole percent (null when there's nothing to compare). */
export function percentChange(now: number, before: number): number | null {
  if (before === 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/** 125 → "2m 05s"; 3700 → "1h 01m". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "–";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600)
    return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** 0 → "00:00", 13 → "13:00". */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export const CHANNEL_LABELS: Record<string, string> = {
  counter: "Counter",
  kiosk: "Kiosk",
  online: "Online",
  drive_thru: "Drive-thru",
};

export const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: "Dine in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

export type RangePreset = {
  key: string;
  label: string;
  from: string;
  to: string;
};

/** Quick date ranges, relative to the branch's today. */
export function rangePresets(today: string): RangePreset[] {
  const monthStart = `${today.slice(0, 8)}01`;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  return [
    { key: "today", label: "Today", from: today, to: today },
    {
      key: "yesterday",
      label: "Yesterday",
      from: addDays(today, -1),
      to: addDays(today, -1),
    },
    { key: "7d", label: "Last 7 days", from: addDays(today, -6), to: today },
    { key: "30d", label: "Last 30 days", from: addDays(today, -29), to: today },
    { key: "month", label: "This month", from: monthStart, to: today },
    { key: "year", label: "This year", from: yearStart, to: today },
  ];
}

/** The from–to in the URL, or the last 7 days; never more than a year. */
export function reportRange(
  params: Record<string, string | string[] | undefined>,
  today: string,
  defaultDays = 7,
): { from: string; to: string } {
  const to = isIsoDate(params.to) ? params.to : today;
  let from = isIsoDate(params.from)
    ? params.from
    : addDays(to, -(defaultDays - 1));
  if (from > to) from = to;
  if (from < addDays(to, -366)) from = addDays(to, -366);
  return { from, to };
}

/**
 * The branch argument for report_* calls: null means every branch. The
 * generated types don't know SQL nulls are allowed here.
 */
export function branchArg(branchId: string | null): string {
  return branchId as string;
}

/** Money for a report that may mix currencies (then each amount is plain). */
export function reportMoney(currency: string | null) {
  return (minor: number) =>
    currency ? formatAmount(minor, currency) : csvAmount(minor);
}

// ---------------------------------------------------------------------------
// Shapes returned by the report_* functions
// ---------------------------------------------------------------------------

export type DurationStats = {
  count: number;
  average: number | null;
  median: number | null;
  p90: number | null;
} | null;

export type SalesReport = {
  from: string;
  to: string;
  currency_code: string | null;
  branches: {
    id: string;
    name: string;
    currency_code: string;
    timezone: string;
  }[];
  summary: {
    orders: number;
    gross_sales: number;
    discounts: number;
    tax: number;
    net_sales: number;
    average_order: number;
    items_sold: number;
    refunds: { count: number; amount: number };
    voids: { count: number; amount: number };
    days: number;
  };
  daily: { date: string; orders: number; net_sales: number; refunds: number }[];
  by_branch: {
    branch_id: string;
    name: string;
    currency_code: string;
    orders: number;
    net_sales: number;
    average_order: number;
    refunds: number;
    discounts: number;
  }[];
  hourly: { hour: number; orders: number; net_sales: number }[];
  channels: { channel: string; orders: number; net_sales: number }[];
  order_types: { order_type: string; orders: number; net_sales: number }[];
  payments: { method: string; name: string; count: number; amount: number }[];
  products: {
    name: string;
    quantity: number;
    amount: number;
    orders: number;
  }[];
  cashiers: {
    staff_id: string;
    name: string;
    orders: number;
    net_sales: number;
    average_order: number;
    discounts: number;
    voids_count: number;
    voids_amount: number;
    refunds_count: number;
    refunds_amount: number;
  }[];
  speed: {
    orders: number;
    to_ready: DurationStats;
    to_collected: DurationStats;
    total: DurationStats;
    by_hour: { hour: number; orders: number; average_seconds: number }[];
  };
};

type Totals = { orders: number; net_sales: number; average_order: number };

export type DashboardReport = {
  currency_code: string | null;
  business_date: string;
  day_open: boolean;
  today: Totals;
  last_week_so_far: Totals;
  last_week_day: Totals;
  hourly: { hour: number; today: number; last_week: number }[];
  open_orders: {
    count: number;
    by_status: Record<string, number>;
    recent: {
      id: string;
      order_number: string;
      status: string;
      order_type: string;
      channel: string;
      total: number;
      created_at: string;
      branch_id: string;
    }[];
  };
};

export type TaxReport = {
  total: number;
  taxes: {
    name: string;
    rate_bps: number;
    inclusive: boolean;
    taxable: number;
    amount: number;
  }[];
  daily: {
    date: string;
    branch_id: string;
    name: string;
    rate_bps: number;
    inclusive: boolean;
    taxable: number;
    amount: number;
  }[];
};

export type DiscountReport = {
  total: number;
  orders: number;
  price_overrides: { count: number; amount: number };
  by_reason: { reason: string; orders: number; amount: number }[];
  by_staff: {
    staff_id: string;
    name: string;
    orders: number;
    amount: number;
    price_overrides: number;
  }[];
};

export const EXPORT_KINDS = {
  sales: {
    label: "Sales",
    header: [
      "Business date",
      "Branch",
      "Order",
      "Time",
      "Channel",
      "Order type",
      "Status",
      "Cashier",
      "Subtotal",
      "Discount",
      "Tax",
      "Total",
      "Refunded",
      "Currency",
      "Taken offline",
    ],
    amounts: [8, 9, 10, 11, 12],
  },
  payments: {
    label: "Payments",
    header: [
      "Business date",
      "Branch",
      "Order",
      "Time",
      "Kind",
      "Method",
      "Amount",
      "Tendered",
      "Change",
      "Reference",
      "Staff",
      "Currency",
    ],
    amounts: [6, 7, 8],
  },
  tax: {
    label: "Tax",
    header: [
      "Business date",
      "Branch",
      "Tax",
      "Rate %",
      "Included in price",
      "Taxable amount",
      "Tax",
      "Currency",
    ],
    amounts: [5, 6],
  },
} as const;

export type ExportKind = keyof typeof EXPORT_KINDS;

export function isExportKind(value: unknown): value is ExportKind {
  return typeof value === "string" && value in EXPORT_KINDS;
}

/** One exported row as CSV cells: amounts as decimals, rates as percents. */
export function exportRow(
  kind: ExportKind,
  row: CsvCell[],
  digitsFor: (currency: string) => number,
): CsvCell[] {
  const spec = EXPORT_KINDS[kind];
  const currency = String(row[spec.header.indexOf("Currency" as never)] ?? "");
  const digits = digitsFor(currency);
  return row.map((cell, i) => {
    if (
      (spec.amounts as readonly number[]).includes(i) &&
      typeof cell === "number"
    )
      return csvAmount(cell, digits);
    if (kind === "tax" && i === 3 && typeof cell === "number")
      return (cell / 100).toFixed(2);
    if (typeof cell === "boolean") return cell ? "Yes" : "No";
    return cell;
  });
}
