import { expect, test } from "@playwright/test";
import {
  enterPin,
  localAdmin,
  open,
  resetTill,
  SEED,
  setUpTill,
  waitForHydration,
} from "./helpers";

test.describe("till", () => {
  test.beforeEach(async ({ page }) => {
    await resetTill();
    await setUpTill(page);
  });

  test.afterAll(async () => {
    await resetTill();
  });

  test("a cashier PIN opens the till", async ({ page }) => {
    await enterPin(page, SEED.cashier.pin);
    await expect(page.getByTestId("till-staff-name")).toHaveText(
      SEED.cashier.name,
    );
  });

  test("a wrong PIN shows an error", async ({ page }) => {
    await enterPin(page, "4321");
    await expect(page.getByTestId("till-pin-error")).toHaveText(
      "Wrong PIN. Try again.",
    );
    await expect(
      page.getByRole("heading", { name: "Enter your PIN" }),
    ).toBeVisible();
  });

  test("five wrong PINs lock the till", async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await enterPin(page, `000${i}`);
    }
    await expect(page.getByTestId("till-pin-error")).toContainText(
      "Too many wrong PINs",
    );
    // The keypad is disabled during the lockout, even for the right PIN.
    await expect(
      page.getByRole("button", { name: "1", exact: true }),
    ).toBeDisabled();
  });

  test("switch user returns to the lock screen", async ({ page }) => {
    await enterPin(page, SEED.cashier.pin);
    await expect(page.getByTestId("till-staff-name")).toHaveText(
      SEED.cashier.name,
    );

    await page.getByRole("button", { name: "Switch user" }).click();
    await expect(
      page.getByRole("heading", { name: "Enter your PIN" }),
    ).toBeVisible();

    await enterPin(page, SEED.manager.pin);
    await expect(page.getByTestId("till-staff-name")).toHaveText(
      SEED.manager.name,
    );
  });

  test("the till locks itself when idle", async ({ page }) => {
    // 0.05 minutes = 3 seconds, for this branch only.
    await localAdmin()
      .from("settings")
      .insert({
        branch_id: SEED.branchId,
        key: "till.auto_lock_minutes",
        value: 0.05,
      });
    await page.reload();
    await waitForHydration(page);

    await enterPin(page, SEED.cashier.pin);
    await expect(page.getByTestId("till-staff-name")).toHaveText(
      SEED.cashier.name,
    );

    await expect(
      page.getByRole("heading", { name: "Enter your PIN" }),
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("Locked after 3 seconds without activity."),
    ).toBeVisible();
  });

  test("a manager PIN approves a protected action", async ({ page }) => {
    await enterPin(page, SEED.cashier.pin);
    await page.getByRole("button", { name: "No sale (open drawer)" }).click();

    const dialog = page.getByRole("dialog", { name: "Manager approval" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Reason").fill("Customer needs change");

    // Another cashier can't approve it.
    await enterPin(dialog, SEED.cashier2.pin, "Approve");
    await expect(dialog.getByText("That PIN can't approve this")).toBeVisible();

    // The manager can.
    await enterPin(dialog, SEED.manager.pin, "Approve");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("till-action-result")).toHaveText(
      new RegExp(`^Approved by ${SEED.manager.name}`),
    );

    const { data } = await localAdmin()
      .from("audit_log")
      .select("action, reason")
      .eq("device_id", SEED.tillDeviceId)
      .in("action", ["override.approved", "override.denied"])
      .order("id", { ascending: false })
      .limit(2);
    expect(data).toEqual([
      { action: "override.approved", reason: "Customer needs change" },
      { action: "override.denied", reason: "Customer needs change" },
    ]);
  });

  test("staff with the permission don't need an approval", async ({ page }) => {
    await enterPin(page, SEED.manager.pin);
    await page.getByRole("button", { name: "No sale (open drawer)" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByTestId("till-action-result")).toHaveText(
      /^Allowed\./,
    );
  });

  test("device setup survives a browser restart", async ({ page, browser }) => {
    const saved = await page.context().storageState();
    await page.context().close();

    const restarted = await browser.newContext({ storageState: saved });
    const tab = await restarted.newPage();
    await open(tab, "/till");
    await expect(tab).toHaveURL(/\/till$/);
    await expect(
      tab.getByRole("heading", { name: "Enter your PIN" }),
    ).toBeVisible();
    await enterPin(tab, SEED.cashier.pin);
    await expect(tab.getByTestId("till-staff-name")).toHaveText(
      SEED.cashier.name,
    );
    await restarted.close();
  });
});
