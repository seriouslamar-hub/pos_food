import { describe, expect, it } from "vitest";
import { dbErrorMessage } from "./action-result";
import { deviceStatus, suggestDeviceCode, timeAgo } from "./devices";
import { bpsToPercentInput, formatBps, parsePercentToBps } from "./percent";
import {
  crossCheckSettings,
  parseSettingInput,
  readSetting,
  SETTINGS,
  settingToInput,
} from "./settings";
import {
  formatSetupCode,
  generateSetupCode,
  normalizeSetupCode,
  SETUP_CODE_ALPHABET,
} from "./setup-code";
import {
  branchSchema,
  deviceSchema,
  fieldErrors,
  isCurrencyCode,
  isTimeZone,
  paymentMethodSchema,
  staffCreateSchema,
  taxSchema,
} from "./validation";

describe("percent", () => {
  it("parses percentages into basis points exactly", () => {
    expect(parsePercentToBps("10")).toBe(1000);
    expect(parsePercentToBps("12.5")).toBe(1250);
    expect(parsePercentToBps("0.01")).toBe(1);
    expect(parsePercentToBps("15%")).toBe(1500);
    expect(parsePercentToBps("100")).toBe(10000);
  });

  it("formats basis points", () => {
    expect(formatBps(1000)).toBe("10%");
    expect(formatBps(1250)).toBe("12.5%");
    expect(formatBps(1)).toBe("0.01%");
    expect(formatBps(0)).toBe("0%");
    expect(bpsToPercentInput(1250)).toBe("12.5");
  });
});

describe("setup codes", () => {
  it("generates formatted codes from the alphabet", () => {
    let i = 0;
    const code = generateSetupCode(() => i++ % SETUP_CODE_ALPHABET.length);
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(code).toBe("ABCDE-FGHJK");
  });

  it("normalises typed codes", () => {
    expect(normalizeSetupCode("abcde-fghjk")).toBe("ABCDEFGHJK");
    expect(normalizeSetupCode(" ABCDE FGHJK ")).toBe("ABCDEFGHJK");
    expect(formatSetupCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
  });

  it("rejects codes that can't be valid", () => {
    expect(normalizeSetupCode("ABCDE-FGHJ")).toBeNull();
    expect(normalizeSetupCode("ABCDE-FGHJO")).toBeNull();
    expect(normalizeSetupCode("ABCDE-FGH10")).toBeNull();
    expect(normalizeSetupCode("")).toBeNull();
  });
});

describe("settings", () => {
  const byKey = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));

  it("parses each kind of setting", () => {
    expect(parseSettingInput(byKey["till.auto_lock_minutes"], "10")).toEqual({
      ok: true,
      value: 10,
    });
    expect(parseSettingInput(byKey["till.auto_lock_minutes"], "500").ok).toBe(
      false,
    );
    expect(parseSettingInput(byKey["till.auto_lock_minutes"], "2.5").ok).toBe(
      false,
    );
    expect(
      parseSettingInput(byKey["staff.default_cashier_discount_bps"], "12.5"),
    ).toEqual({
      ok: true,
      value: 1250,
    });
    expect(
      parseSettingInput(byKey["orders.number_reset_daily"], "false"),
    ).toEqual({
      ok: true,
      value: false,
    });
    expect(parseSettingInput(byKey["receipt.paper_width_mm"], "58")).toEqual({
      ok: true,
      value: 58,
    });
    expect(parseSettingInput(byKey["receipt.paper_width_mm"], "70").ok).toBe(
      false,
    );
  });

  it("reads stored values defensively", () => {
    expect(readSetting(byKey["receipt.paper_width_mm"], 80)).toBe(80);
    expect(readSetting(byKey["receipt.paper_width_mm"], 70)).toBeNull();
    expect(readSetting(byKey["orders.number_reset_daily"], "yes")).toBeNull();
    expect(
      settingToInput(byKey["staff.default_cashier_discount_bps"], 1250),
    ).toBe("12.5");
  });

  it("checks that red comes after amber on the kitchen screen", () => {
    expect(
      crossCheckSettings({
        "kds.ticket_warn_minutes": 5,
        "kds.ticket_late_minutes": 3,
      }),
    ).toHaveProperty("kds.ticket_late_minutes");
    expect(
      crossCheckSettings({
        "kds.ticket_warn_minutes": 3,
        "kds.ticket_late_minutes": 5,
      }),
    ).toEqual({});
  });
});

describe("validation", () => {
  it("validates timezones and currencies", () => {
    expect(isTimeZone("Africa/Accra")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isCurrencyCode("GHS")).toBe(true);
    expect(isCurrencyCode("XYZ")).toBe(false);
    expect(isCurrencyCode("ghs")).toBe(false);
  });

  it("validates a branch", () => {
    const ok = branchSchema.safeParse({
      name: " Airport ",
      address: "",
      phone: "",
      timezone: "Africa/Accra",
      currencyCode: "ghs",
      receiptHeader: "",
      receiptFooter: "Thanks!",
      isActive: true,
    });
    expect(ok.success && ok.data).toMatchObject({
      name: "Airport",
      address: null,
      currencyCode: "GHS",
      receiptFooter: "Thanks!",
    });
    const bad = branchSchema.safeParse({
      name: "",
      address: "",
      phone: "",
      timezone: "Nowhere",
      currencyCode: "ZZZ",
      receiptHeader: "",
      receiptFooter: "",
      isActive: true,
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(Object.keys(fieldErrors(bad.error)).sort()).toEqual([
        "currencyCode",
        "name",
        "timezone",
      ]);
    }
  });

  it("requires a branch and an email for managers, but not an email for cashiers", () => {
    const base = {
      fullName: "Sam",
      phone: "",
      discountPercent: "10",
      isActive: true,
      pin: "",
    };
    const manager = staffCreateSchema.safeParse({
      ...base,
      role: "manager",
      branchId: "",
      email: "",
    });
    expect(manager.success).toBe(false);
    if (!manager.success) {
      expect(fieldErrors(manager.error)).toMatchObject({
        branchId: "Choose a branch",
        email: "Admins and managers need an email to sign in",
      });
    }
    const cashier = staffCreateSchema.safeParse({
      ...base,
      role: "cashier",
      branchId: "10000000-0000-4000-8000-000000000001",
      email: "",
      pin: "4321",
    });
    expect(cashier.success && cashier.data).toMatchObject({
      discountPercent: 1000,
      email: null,
      pin: "4321",
    });
    const admin = staffCreateSchema.safeParse({
      ...base,
      role: "admin",
      branchId: "",
      email: "Boss@Example.com",
    });
    expect(admin.success && admin.data).toMatchObject({
      branchId: null,
      email: "boss@example.com",
    });
  });

  it("rejects bad PINs and discount limits", () => {
    const result = staffCreateSchema.safeParse({
      fullName: "Sam",
      role: "cashier",
      branchId: "10000000-0000-4000-8000-000000000001",
      email: "",
      phone: "",
      discountPercent: "150",
      isActive: true,
      pin: "12",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(fieldErrors(result.error)).sort()).toEqual([
        "discountPercent",
        "pin",
      ]);
    }
  });

  it("normalises device codes and drops the station for non-kitchen devices", () => {
    const till = deviceSchema.safeParse({
      branchId: "10000000-0000-4000-8000-000000000001",
      name: "Counter 2",
      type: "till",
      code: "t2",
      station: "Grill",
      isActive: true,
    });
    expect(till.success && till.data).toMatchObject({
      code: "T2",
      station: null,
    });
    const kds = deviceSchema.safeParse({
      branchId: "10000000-0000-4000-8000-000000000001",
      name: "Grill screen",
      type: "kds",
      code: "K2",
      station: "Grill",
      isActive: true,
    });
    expect(kds.success && kds.data).toMatchObject({ station: "Grill" });
  });

  it("validates taxes and payment methods", () => {
    const tax = taxSchema.safeParse({
      name: "VAT",
      ratePercent: "15",
      isInclusive: true,
      taxCategory: "Standard",
      sortOrder: "",
      isActive: true,
    });
    expect(tax.success && tax.data).toMatchObject({
      ratePercent: 1500,
      taxCategory: "standard",
      sortOrder: 0,
    });
    const cash = paymentMethodSchema.safeParse({
      type: "cash",
      name: "Cash",
      isEnabled: true,
      requiresReference: true,
      sortOrder: "10",
    });
    expect(cash.success && cash.data).toMatchObject({
      requiresReference: false,
      sortOrder: 10,
    });
  });
});

describe("dbErrorMessage", () => {
  it("passes through messages written for people", () => {
    expect(
      dbErrorMessage({
        code: "42501",
        message: "Discount limit can't be higher than your own (20%)",
      }),
    ).toBe("Discount limit can't be higher than your own (20%)");
  });

  it("hides raw RLS errors", () => {
    expect(
      dbErrorMessage({
        code: "42501",
        message: 'new row violates row-level security policy for table "staff"',
      }),
    ).toBe("You don't have permission to do that.");
  });

  it("explains known unique constraints", () => {
    expect(
      dbErrorMessage({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "devices_code_unique_per_branch"',
      }),
    ).toBe("Another device in this branch already uses that code.");
  });
});

describe("devices", () => {
  it("suggests the next free code for each type", () => {
    expect(suggestDeviceCode("till", [])).toBe("T1");
    expect(suggestDeviceCode("till", ["T1", "K1", "t2"])).toBe("T3");
    expect(suggestDeviceCode("till", ["T2"])).toBe("T1");
    expect(suggestDeviceCode("kds", ["T1", "K1"])).toBe("K2");
    expect(suggestDeviceCode("pickup", [])).toBe("P1");
  });

  it("reports whether a device is online", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(deviceStatus(null, now)).toEqual({
      online: false,
      label: "Never connected",
    });
    expect(deviceStatus("2026-10-15T11:59:00Z", now)).toEqual({
      online: true,
      label: "Online",
    });
    expect(deviceStatus("2026-10-15T11:50:00Z", now)).toEqual({
      online: false,
      label: "Last seen 10 min ago",
    });
    expect(timeAgo(3 * 3600_000)).toBe("3 h ago");
    expect(timeAgo(72 * 3600_000)).toBe("3 days ago");
  });
});
