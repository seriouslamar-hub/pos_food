import { expect, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/** Ids from supabase/seed.sql. */
export const SEED = {
  branchId: "10000000-0000-4000-8000-000000000001",
  tillDeviceId: "30000000-0000-4000-8000-000000000001",
  tillName: "Front counter till",
  admin: { email: "admin@example.com", name: "Ada Admin", pin: "9000" },
  manager: { email: "manager@example.com", name: "Max Manager", pin: "9999" },
  cashier: { name: "Ama Cashier", pin: "1111" },
  cashier2: { name: "Kofi Cashier", pin: "2222" },
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

/** Clears PIN lockout, open sessions and test settings for the seeded till. */
export async function resetTill() {
  const db = localAdmin();
  await db.from("pin_attempts").delete().eq("device_id", SEED.tillDeviceId);
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

/** Signs in as the manager and turns this browser into the seeded till. */
export async function setUpTill(page: Page) {
  await signIn(page, SEED.manager.email);
  await expect(page).toHaveURL(/\/manager$/);
  await open(page, "/device/setup");
  const tillButton = page.getByRole("button", {
    name: new RegExp(`^${SEED.tillName}`),
  });
  await tillButton.click();
  await expect(tillButton).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: `Set up this browser as ${SEED.tillName}` })
    .click();
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
