import { describe, expect, it } from "vitest";
import {
  autoLockMinutes,
  isSessionEndedError,
  parseOverride,
  parseStartSession,
  pinFailureMessage,
} from "./till";

describe("parseStartSession", () => {
  it("parses a successful sign-in", () => {
    const result = parseStartSession({
      ok: true,
      session_id: "s1",
      staff: {
        id: "u1",
        full_name: "Ama",
        role: "cashier",
        discount_limit_bps: 1000,
      },
      permissions: ["order.create", "discount.apply"],
    });
    expect(result).toEqual({
      ok: true,
      sessionId: "s1",
      staff: {
        id: "u1",
        fullName: "Ama",
        role: "cashier",
        discountLimitBps: 1000,
      },
      permissions: ["order.create", "discount.apply"],
    });
  });

  it("parses failures", () => {
    expect(
      parseStartSession({
        ok: false,
        error: "invalid_pin",
        retry_after_seconds: 0,
      }),
    ).toEqual({
      ok: false,
      error: "invalid_pin",
      retryAfterSeconds: 0,
    });
    expect(
      parseStartSession({
        ok: false,
        error: "locked_out",
        retry_after_seconds: 42,
      }),
    ).toEqual({
      ok: false,
      error: "locked_out",
      retryAfterSeconds: 42,
    });
  });

  it("treats anything unexpected as a failed PIN", () => {
    expect(parseStartSession(null)).toMatchObject({
      ok: false,
      error: "invalid_pin",
    });
    expect(parseStartSession({ ok: false, error: "weird" })).toMatchObject({
      error: "invalid_pin",
    });
  });
});

describe("parseOverride", () => {
  it("parses an approval", () => {
    expect(
      parseOverride({
        ok: true,
        override_id: "o1",
        approver: { id: "m1", full_name: "Max" },
        expires_at: "2026-10-15T12:02:00Z",
      }),
    ).toEqual({
      ok: true,
      overrideId: "o1",
      approverName: "Max",
      expiresAt: "2026-10-15T12:02:00Z",
    });
  });

  it("parses a refusal", () => {
    expect(parseOverride({ ok: false, error: "not_permitted" })).toEqual({
      ok: false,
      error: "not_permitted",
      retryAfterSeconds: 0,
    });
  });
});

describe("pinFailureMessage", () => {
  it("explains each failure", () => {
    expect(
      pinFailureMessage({
        ok: false,
        error: "invalid_pin",
        retryAfterSeconds: 0,
      }),
    ).toBe("Wrong PIN. Try again.");
    expect(
      pinFailureMessage({
        ok: false,
        error: "locked_out",
        retryAfterSeconds: 1,
      }),
    ).toBe("Too many wrong PINs. Try again in 1 second.");
    expect(
      pinFailureMessage({
        ok: false,
        error: "locked_out",
        retryAfterSeconds: 30,
      }),
    ).toBe("Too many wrong PINs. Try again in 30 seconds.");
    expect(
      pinFailureMessage({
        ok: false,
        error: "not_permitted",
        retryAfterSeconds: 0,
      }),
    ).toMatch(/can't approve/);
  });
});

describe("isSessionEndedError", () => {
  it("recognises the session-ended SQLSTATE", () => {
    expect(isSessionEndedError({ code: "PS401" })).toBe(true);
    expect(isSessionEndedError({ code: "42501" })).toBe(false);
    expect(isSessionEndedError(null)).toBe(false);
  });
});

describe("autoLockMinutes", () => {
  const branch = "b1";
  it("prefers the branch override", () => {
    expect(
      autoLockMinutes(
        [
          { branch_id: null, value: 5 },
          { branch_id: branch, value: 2 },
        ],
        branch,
      ),
    ).toBe(2);
  });
  it("falls back to the global default, then 5", () => {
    expect(autoLockMinutes([{ branch_id: null, value: 10 }], branch)).toBe(10);
    expect(autoLockMinutes([], branch)).toBe(5);
    expect(autoLockMinutes(null, branch)).toBe(5);
  });
  it("ignores other branches and bad values", () => {
    expect(autoLockMinutes([{ branch_id: "other", value: 1 }], branch)).toBe(5);
    expect(
      autoLockMinutes([{ branch_id: branch, value: "soon" }], branch),
    ).toBe(5);
  });
});
