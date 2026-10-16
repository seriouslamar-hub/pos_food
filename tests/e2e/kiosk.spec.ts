import { expect, test } from "@playwright/test";
import {
  localAdmin,
  openShifts,
  resetTill,
  SEED,
  setUpDevice,
} from "./helpers";

const KIOSK = {
  id: "30000000-0000-4000-8000-0000000000a1",
  name: "Self-order kiosk",
};

test.describe("self-order kiosk", () => {
  test.beforeEach(async () => {
    await resetTill();
    await openShifts();
  });
  test.afterAll(async () => {
    await resetTill();
  });

  test("the kiosk suggests a meal and sends an order to pay at the counter", async ({
    page,
  }) => {
    const db = localAdmin();
    const { error: deviceError } = await db.from("devices").upsert(
      {
        id: KIOSK.id,
        branch_id: SEED.branchId,
        name: KIOSK.name,
        type: "kiosk",
        // K1 is the seeded kitchen display.
        code: "K2",
        is_active: true,
      },
      { onConflict: "id" },
    );
    expect(deviceError).toBeNull();
    await setUpDevice(page, KIOSK.name);
    await expect(page).toHaveURL(/\/kiosk$/);
    await page.getByRole("button", { name: "Take away" }).click();

    // A 2-piece chicken is the main of the 2-piece meal: the kiosk offers it.
    await page.getByRole("tab", { name: "Chicken" }).click();
    await page.getByRole("button", { name: /^2-piece chicken,/ }).click();
    const sheet = page.getByRole("dialog", { name: "2-piece chicken" });
    // It has a flavour to choose (Original by default).
    await sheet.getByRole("button", { name: /^Add to order/ }).click();
    const offer = page.getByRole("dialog", { name: "Make it a meal?" });
    await expect(offer).toContainText("2-piece meal");
    await offer.getByRole("button", { name: "Yes, make it a meal" }).click();
    await expect(page.getByTestId("customer-line")).toHaveCount(1);
    await expect(page.getByTestId("customer-line")).toContainText(
      "1 × 2-piece meal",
    );

    await page.getByRole("button", { name: "Larger text" }).click();
    await page.getByRole("radio", { name: "Cash" }).click();
    await page.getByRole("button", { name: "Send my order" }).click();
    await expect(page.getByTestId("kiosk-done")).toContainText("by cash");
    const number = (await page
      .getByTestId("kiosk-order-number")
      .textContent())!;
    const { data: placed } = await db
      .from("orders")
      .select(
        "channel, paid_at, sent_to_kitchen_at, pay_at_counter, total, payment_preference",
      )
      .eq("branch_id", SEED.branchId)
      .eq("order_number", number)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(placed).toMatchObject({
      payment_preference: "cash",
      channel: "kiosk",
      paid_at: null,
      sent_to_kitchen_at: null,
      pay_at_counter: true,
    });
    expect(placed!.total).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: "Take away" })).toBeVisible();
  });
});
