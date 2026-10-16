/**
 * Business days, shifts and X/Z reports as the RPCs return them (see the
 * Phase 7 migration). Pure types and helpers, safe to import anywhere.
 */

/** submit_order and friends: the cashier has no open shift on this till. */
export const NO_SHIFT_CODE = "PS410";
/** open_shift: the branch's business day isn't open. */
export const DAY_NOT_OPEN_CODE = "PS411";

export type DaySummary = {
  id: string;
  branch_id: string;
  business_date: string;
  status: "open" | "closed";
  opened_at: string;
  opened_by_name: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
  open_shifts: number;
};

export type ShiftStatus = "open" | "pending_review" | "approved" | "flagged";

/** A shift as its cashier sees it: never the expected cash. */
export type ShiftSummary = {
  id: string;
  business_day_id: string;
  business_date: string;
  staff_id: string;
  staff_name: string;
  device_code: string;
  status: ShiftStatus;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  counted_cash: number | null;
};

export type ShiftCash = {
  opening_float: number;
  cash_sales: number;
  /** Refunds paid out in cash from this drawer. */
  cash_refunds: number;
  paid_in: number;
  paid_out: number;
  drops: number;
  no_sales: number;
  expected: number;
  counted: number | null;
  variance: number | null;
};

/** A shift as a manager sees it. */
export type ManagerShift = ShiftSummary & {
  cash: ShiftCash;
  counted_denominations: Record<string, number> | null;
  closed_by_name: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

/** X report (one shift) or Z report (a business day). */
export type SalesReport = {
  kind: "x" | "z";
  generated_at: string;
  branch: { name: string; currency_code: string; timezone: string };
  orders: number;
  gross_sales: number;
  discounts: number;
  tax: number;
  net_sales: number;
  average_order: number;
  payments: { method: string; name: string; count: number; amount: number }[];
  items_sold: number;
  items: { name: string; quantity: number; amount: number }[];
  voids: { count: number; amount: number };
  refunds: { count: number; amount: number; cash?: number };
  unpaid_orders: { count: number; amount: number };
  /** X report: the shift. The cashier's copy has no expected or counted cash. */
  shift?: ShiftSummary;
  /** Z report: the day, every shift, and the day's cash totals. */
  day?: DaySummary;
  shifts?: ManagerShift[];
  cash: Partial<ShiftCash> & { opening_float: number };
};

export type TillState = { day: DaySummary | null; shift: ShiftSummary | null };

export function parseTillState(json: unknown): TillState {
  const state = (json ?? {}) as Partial<TillState>;
  return { day: state.day ?? null, shift: state.shift ?? null };
}

export function parseReport(json: unknown): SalesReport {
  const report = json as Partial<SalesReport> | null;
  if (!report || (report.kind !== "x" && report.kind !== "z")) {
    throw new Error("The report couldn't be read");
  }
  return report as SalesReport;
}

export const SHIFT_STATUS_LABELS: Record<ShiftStatus, string> = {
  open: "Open",
  pending_review: "To review",
  approved: "Approved",
  flagged: "Flagged",
};

export type CashMovementType = "drop" | "paid_in" | "paid_out" | "no_sale";

export const CASH_MOVEMENTS: Record<
  CashMovementType,
  {
    label: string;
    /** What the cashier does, for the manager approval dialog. */
    action: string;
    /** Who can do it without a manager's approval. */
    permission: "shift.close_own" | "shift.reconcile" | "drawer.no_sale";
    reasonRequired: boolean;
    hasAmount: boolean;
  }
> = {
  drop: {
    label: "Cash drop",
    action: "Taking cash out of the drawer to the safe",
    permission: "shift.close_own",
    reasonRequired: false,
    hasAmount: true,
  },
  paid_in: {
    label: "Paid in",
    action: "Putting cash into the drawer",
    permission: "shift.reconcile",
    reasonRequired: true,
    hasAmount: true,
  },
  paid_out: {
    label: "Paid out",
    action: "Paying cash out of the drawer",
    permission: "shift.reconcile",
    reasonRequired: true,
    hasAmount: true,
  },
  no_sale: {
    label: "No sale",
    action: "Opening the drawer without a sale",
    permission: "drawer.no_sale",
    reasonRequired: true,
    hasAmount: false,
  },
};

/** Whether a counted-vs-expected difference is big enough to flag. */
export function isVarianceAlert(
  variance: number | null | undefined,
  alertAt: number,
): boolean {
  return (
    variance !== null && variance !== undefined && Math.abs(variance) > alertAt
  );
}
