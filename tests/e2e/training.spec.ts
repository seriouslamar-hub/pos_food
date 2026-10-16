import { expect, test } from "@playwright/test";
import {
  closeShiftsAndDay,
  enterPin,
  localAdmin,
  open,
  resetTill,
  SEED,
  setUpTill,
  signIn,
} from "./helpers";

/** Puts the seeded till back in its branch, whatever a test left behind. */
async function liveAgain() {
  const db = localAdmin();
  const { data: device } = await db
    .from("devices")
    .select("branch_id, home_branch_id")
    .eq("id", SEED.tillDeviceId)
    .single();
  if (device?.home_branch_id) {
    await db
      .from("shifts")
      .update({
        status: "approved",
        closed_at: new Date().toISOString(),
        expected_cash: 0,
        counted_cash: 0,
        variance: 0,
      })
      .eq("device_id", SEED.tillDeviceId)
      .eq("branch_id", device.branch_id)
      .eq("status", "open");
    await db
      .from("devices")
      .update({ branch_id: device.home_branch_id, home_branch_id: null })
      .eq("id", SEED.tillDeviceId);
  }
}

test.describe("training mode", () => {
  test.beforeEach(async () => {
    await liveAgain();
    await resetTill();
    // Switching needs the till's shifts closed.
    await closeShiftsAndDay();
  });
  test.afterAll(async () => {
    await liveAgain();
    await resetTill();
  });

  test("a till in training sells into the training branch, marked as practice", async ({
    browser,
  }) => {
    // A till already set up in the branch is switched into training.
    const till = await (await browser.newContext()).newPage();
    await setUpTill(till);

    const admin = await (await browser.newContext()).newPage();
    await signIn(admin, SEED.admin.email);
    await expect(admin).toHaveURL(/\/admin$/);
    await open(admin, `/admin/devices/${SEED.tillDeviceId}`);
    const panel = admin.getByTestId("training-panel");
    await panel
      .getByRole("button", { name: "Switch to training mode" })
      .click();
    await expect(panel).toContainText("Training mode on");

    const db = localAdmin();
    const { data: twin } = await db
      .from("branches")
      .select("id, name")
      .eq("training_for", SEED.branchId)
      .single();
    expect(twin!.name).toMatch(/\(training\)$/);

    // The branch's own cashier and manager use their PINs as usual.
    await till.reload();
    await expect(
      till.getByRole("heading", { name: "Enter your PIN" }),
    ).toBeVisible();
    await enterPin(till, SEED.cashier.pin);
    const openDay = till.getByRole("button", { name: "Open the business day" });
    const shiftHeading = till.getByRole("heading", { name: "Open your shift" });
    await expect(openDay.or(shiftHeading)).toBeVisible();
    if (await openDay.isVisible()) {
      await openDay.click();
      const approval = till.getByRole("dialog", { name: "Manager approval" });
      await enterPin(approval, SEED.manager.pin, "Approve");
    }
    await expect(
      till.getByRole("heading", { name: "Open your shift" }),
    ).toBeVisible();
    await till.getByRole("button", { name: /^Open shift with / }).click();
    await expect(till.getByTestId("training-banner")).toBeVisible();

    await till.getByRole("tab", { name: "Drinks" }).click();
    await till.getByRole("button", { name: /^Water,/ }).click();
    await till.getByRole("button", { name: /^Charge / }).click();
    await till
      .getByRole("dialog", { name: "Take payment" })
      .getByRole("button", { name: /^Exact / })
      .click();
    const done = till.getByRole("dialog", { name: "Sale complete" });
    await expect(done.getByTestId("receipt-training").first()).toHaveText(
      "TRAINING · NOT A RECEIPT",
    );
    const number = (await done.getByTestId("order-number").textContent())!;
    const { data: order } = await db
      .from("orders")
      .select("branch_id")
      .eq("order_number", number)
      .eq("branch_id", twin!.id)
      .maybeSingle();
    expect(order?.branch_id).toBe(twin!.id);

    // Back to live: refused while the shift is open.
    await admin.reload();
    await panel.getByRole("button", { name: "Back to live selling" }).click();
    await expect(panel).toContainText("Close the open shift");
  });
});
