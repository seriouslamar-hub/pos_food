/**
 * Types and result parsing for the till RPCs (start_pos_session,
 * verify_override). Pure functions, safe to import anywhere.
 */
import { toPaperWidth, type PaperWidth } from "./printing";
import { denominationsFor, effectiveSetting } from "./settings";

export type StaffRole = "admin" | "manager" | "cashier";

export type TillStaff = {
  id: string;
  fullName: string;
  role: StaffRole;
  discountLimitBps: number;
};

export type TillSession = {
  sessionId: string;
  staff: TillStaff;
  permissions: string[];
  /**
   * Signed in with the PIN checked on the till while offline. The session is
   * registered through the outbox (an item with the session's id).
   */
  offline?: boolean;
};

export type PinFailure = {
  ok: false;
  error: "invalid_pin" | "locked_out" | "not_permitted";
  retryAfterSeconds: number;
};

export type OverrideApproval = {
  ok: true;
  overrideId: string;
  approverName: string;
  expiresAt: string;
  /**
   * Checked on the till while offline. The approval is in the outbox (an
   * item with the override's id): what it approves must follow it there.
   */
  offline?: boolean;
};

/** SQLSTATE raised when a till session has ended (see the Phase 2 migration). */
export const SESSION_ENDED_CODE = "PS401";

/** RPC errors whose messages are written for the cashier (see the migrations). */
const READABLE_CODES = new Set([
  "22023",
  "42501",
  "P0002",
  "PS403",
  "PS410",
  "PS411",
]);

/** Whether the server refused the request (as opposed to not being reached). */
export function isReadableError(error: { code?: string } | null): boolean {
  return READABLE_CODES.has(error?.code ?? "");
}

/** A till RPC error as a message for the cashier. */
export function rpcErrorMessage(error: {
  code?: string;
  message: string;
}): string {
  return isReadableError(error)
    ? error.message
    : "Couldn't reach the server. Check the connection and try again.";
}

export function isSessionEndedError(
  error: { code?: string } | null | undefined,
): boolean {
  return error?.code === SESSION_ENDED_CODE;
}

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

function asObject(value: Json | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseFailure(result: Record<string, unknown>): PinFailure {
  const error = result.error;
  return {
    ok: false,
    error:
      error === "locked_out" ||
      error === "not_permitted" ||
      error === "invalid_pin"
        ? error
        : "invalid_pin",
    retryAfterSeconds: Number(result.retry_after_seconds) || 0,
  };
}

export function parseStartSession(
  json: unknown,
): ({ ok: true } & TillSession) | PinFailure {
  const result = asObject(json);
  if (result.ok !== true) return parseFailure(result);
  const staff = asObject(result.staff);
  return {
    ok: true,
    sessionId: String(result.session_id),
    staff: {
      id: String(staff.id),
      fullName: String(staff.full_name),
      role: staff.role as StaffRole,
      discountLimitBps: Number(staff.discount_limit_bps) || 0,
    },
    permissions: Array.isArray(result.permissions)
      ? result.permissions.map(String)
      : [],
  };
}

export function parseOverride(json: unknown): OverrideApproval | PinFailure {
  const result = asObject(json);
  if (result.ok !== true) return parseFailure(result);
  return {
    ok: true,
    overrideId: String(result.override_id),
    approverName: String(asObject(result.approver).full_name),
    expiresAt: String(result.expires_at),
  };
}

export function pinFailureMessage(failure: PinFailure): string {
  switch (failure.error) {
    case "locked_out":
      return `Too many wrong PINs. Try again in ${failure.retryAfterSeconds} second${
        failure.retryAfterSeconds === 1 ? "" : "s"
      }.`;
    case "not_permitted":
      return "That PIN can't approve this. Ask a manager.";
    case "invalid_pin":
      return "Wrong PIN. Try again.";
  }
}

/** Settings the till reads when it starts. */
export const TILL_SETTING_KEYS = [
  "till.auto_lock_minutes",
  "orders.pay_later_dine_in",
  "receipt.auto_print",
  "print.kitchen_tickets",
  "receipt.paper_width_mm",
  "cash.denominations",
  "offline.print_kitchen_tickets",
  "offline.card_payments",
] as const;

export type TillSettings = {
  autoLockMinutes: number;
  payLaterDineIn: boolean;
  autoPrintReceipt: boolean;
  kitchenTickets: boolean;
  paperWidth: PaperWidth;
  /** Notes and coins to count, largest first, in minor units. */
  denominations: number[];
  /** Print a kitchen ticket for every sale made offline. */
  offlineKitchenTickets: boolean;
  /** Card and mobile money offline (with a typed reference). */
  offlineCardPayments: boolean;
};

export function tillSettings(
  rows: { key: string; branch_id: string | null; value: unknown }[] | null,
  branchId: string,
  currency: string,
): TillSettings {
  const value = (key: (typeof TILL_SETTING_KEYS)[number]) =>
    effectiveSetting(key, rows, branchId);
  return {
    autoLockMinutes: Number(value("till.auto_lock_minutes")),
    payLaterDineIn: value("orders.pay_later_dine_in") === true,
    autoPrintReceipt: value("receipt.auto_print") === true,
    kitchenTickets: value("print.kitchen_tickets") === true,
    paperWidth: toPaperWidth(value("receipt.paper_width_mm")),
    denominations: denominationsFor(rows, branchId, currency),
    offlineKitchenTickets: value("offline.print_kitchen_tickets") === true,
    offlineCardPayments: value("offline.card_payments") === true,
  };
}
