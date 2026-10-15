/**
 * Types and result parsing for the till RPCs (start_pos_session,
 * verify_override). Pure functions, safe to import anywhere.
 */

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
};

/** SQLSTATE raised when a till session has ended (see the Phase 2 migration). */
export const SESSION_ENDED_CODE = "PS401";

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

/**
 * The till's auto-lock minutes from settings rows: the branch override wins
 * over the global default. Falls back to 5 minutes; 0 or less turns it off.
 */
export function autoLockMinutes(
  rows: { branch_id: string | null; value: unknown }[] | null | undefined,
  branchId: string,
): number {
  const pick =
    rows?.find((r) => r.branch_id === branchId) ??
    rows?.find((r) => r.branch_id === null);
  const minutes = Number(pick?.value);
  return Number.isFinite(minutes) ? minutes : 5;
}
