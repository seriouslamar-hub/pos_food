import { expect, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/** Ids from supabase/seed.sql. */
export const SEED = {
  branchId: "10000000-0000-4000-8000-000000000001",
  tillDeviceId: "30000000-0000-4000-8000-000000000001",
  tillName: "Front counter till",
  admin: { email: "admin@example.com", name: "Ada Admin", pin: "9000" },
  manager: {
    id: "20000000-0000-4000-8000-000000000002",
    email: "manager@example.com",
    name: "Max Manager",
    pin: "9999",
  },
  cashier: {
    id: "20000000-0000-4000-8000-000000000003",
    name: "Ama Cashier",
    pin: "1111",
  },
  cashier2: {
    id: "20000000-0000-4000-8000-000000000004",
    name: "Kofi Cashier",
    pin: "2222",
  },
  password: "password123",
} as const;

/** Service-role client for the LOCAL database (see playwright.config.ts). */
export function localAdmin() {
  const url = process.env.E2E_SUPABASE_URL;
  const key = process.env.E2E_SUPABASE_SERVICE_KEY;
  if (!url || !key || !/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("E2E helpers only talk to the local Supabase stack");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Clears PIN lockout, rate limits, open sessions and test settings for the seeded till. */
export async function resetTill() {
  const db = localAdmin();
  await db.from("pin_attempts").delete().eq("device_id", SEED.tillDeviceId);
  // The suite sets up devices far faster than any person would.
  await db.from("rate_limits").delete().neq("key", "");
  await db
    .from("pos_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("device_id", SEED.tillDeviceId)
    .is("ended_at", null);
  await db
    .from("settings")
    .delete()
    .eq("branch_id", SEED.branchId)
    .in("key", [...TILL_TEST_SETTINGS]);
}

/** Branch settings tests may turn on; resetTill() clears them. */
const TILL_TEST_SETTINGS = [
  "till.auto_lock_minutes",
  "orders.pay_later_dine_in",
  "receipt.auto_print",
  "print.kitchen_tickets",
] as const;

/** Sets a branch setting for the seeded branch (read when the till loads). */
export async function setBranchSetting(
  key: (typeof TILL_TEST_SETTINGS)[number],
  value: unknown,
) {
  const db = localAdmin();
  await db
    .from("settings")
    .delete()
    .eq("branch_id", SEED.branchId)
    .eq("key", key);
  const { error } = await db
    .from("settings")
    .insert({ branch_id: SEED.branchId, key, value });
  if (error) throw error;
}

/**
 * Opens the seed branch's business day (UTC, like the branch) and an open
 * shift on the seed till for each staff member, so tests can sell at once.
 */
export async function openShifts(
  staffIds: string[] = [SEED.cashier.id, SEED.manager.id],
) {
  const db = localAdmin();
  const { data: open } = await db
    .from("business_days")
    .select("id")
    .eq("branch_id", SEED.branchId)
    .eq("status", "open")
    .maybeSingle();
  let dayId = open?.id;
  if (!dayId) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: closed } = await db
      .from("business_days")
      .select("id")
      .eq("branch_id", SEED.branchId)
      .eq("business_date", today)
      .maybeSingle();
    if (closed) {
      await db
        .from("business_days")
        .update({
          status: "open",
          closed_at: null,
          closed_by: null,
          z_report: null,
        })
        .eq("id", closed.id);
      dayId = closed.id;
    } else {
      const { data: created, error } = await db
        .from("business_days")
        .insert({ branch_id: SEED.branchId, business_date: today })
        .select("id")
        .single();
      if (error) throw error;
      dayId = created.id;
    }
  }
  for (const staffId of staffIds) {
    const { data: shift } = await db
      .from("shifts")
      .select("id")
      .eq("staff_id", staffId)
      .eq("device_id", SEED.tillDeviceId)
      .eq("status", "open")
      .maybeSingle();
    if (shift) continue;
    const { error } = await db.from("shifts").insert({
      branch_id: SEED.branchId,
      business_day_id: dayId,
      staff_id: staffId,
      device_id: SEED.tillDeviceId,
      opening_float: 0,
    });
    if (error) throw error;
  }
}

/** Closes every open shift and the open day, so a test starts from nothing. */
export async function closeShiftsAndDay() {
  const db = localAdmin();
  const now = new Date().toISOString();
  await db
    .from("shifts")
    .update({
      status: "approved",
      closed_at: now,
      expected_cash: 0,
      counted_cash: 0,
      variance: 0,
    })
    .eq("branch_id", SEED.branchId)
    .eq("status", "open");
  await db
    .from("business_days")
    .update({ status: "closed", closed_at: now })
    .eq("branch_id", SEED.branchId)
    .eq("status", "open");
}

export type Printed = { kinds: string[]; text: string };

/** Replaces window.print so tests can see what would have printed. */
export async function capturePrints(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: Printed[] };
    w.__prints = [];
    window.print = () => {
      const area = document.querySelector('[data-testid="print-area"]');
      w.__prints.push({
        kinds: Array.from(area?.children ?? []).map(
          (el) => el.getAttribute("data-testid") ?? "",
        ),
        text: area?.textContent ?? "",
      });
      window.dispatchEvent(new Event("afterprint"));
    };
  });
}

export function prints(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __prints: Printed[] }).__prints,
  );
}

/** Opens a page and waits until React is interactive. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await waitForHydration(page);
}

export async function waitForHydration(page: Page) {
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
}

export async function signIn(
  page: Page,
  email: string,
  password: string = SEED.password,
) {
  await open(page, "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Signs in as the manager and turns this browser into a seeded device. */
export async function setUpDevice(page: Page, deviceName: string) {
  await signIn(page, SEED.manager.email);
  await expect(page).toHaveURL(/\/manager$/);
  await open(page, "/device/setup");
  const button = page.getByRole("button", {
    name: new RegExp(`^${deviceName}`),
  });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: `Set up this browser as ${deviceName}` })
    .click();
}

/** Turns this browser into the seeded till, at its PIN screen. */
export async function setUpTill(page: Page) {
  await setUpDevice(page, SEED.tillName);
  await expect(page).toHaveURL(/\/till$/);
  await expect(
    page.getByRole("heading", { name: "Enter your PIN" }),
  ).toBeVisible();
}

/** Taps a PIN on a keypad, then its submit button. */
export async function enterPin(
  scope: Page | Locator,
  pin: string,
  submit = "Sign in",
) {
  for (const digit of pin) {
    await scope.getByRole("button", { name: digit, exact: true }).click();
  }
  await scope.getByRole("button", { name: submit }).click();
}
