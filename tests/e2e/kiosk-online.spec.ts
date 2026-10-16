import { expect, type Page, test } from "@playwright/test";
import {
  enterPin,
  signIn,
  localAdmin,
  open,
  openShifts,
  resetTill,
  SEED,
  setUpDevice,
  setUpTill,
} from "./helpers";

const KIOSK = {
  id: "30000000-0000-4000-8000-0000000000a1",
  name: "Self-order kiosk",
};

async function setOnline(values: Record<string, unknown>) {
  const db = localAdmin();
  for (const [key, value] of Object.entries(values)) {
    await db
      .from("settings")
      .delete()
      .eq("branch_id", SEED.branchId)
      .eq("key", key);
    await db.from("settings").insert({ branch_id: SEED.branchId, key, value });
  }
}

async function order(id: string) {
  const { data } = await localAdmin()
    .from("orders")
    .select(
      "order_number, channel, status, paid_at, sent_to_kitchen_at, total, pay_at_counter",
    )
    .eq("id", id)
    .single();
  return data!;
}

/** Signs in with the local test phone number and code. */
async function verifyPhone(page: Page, phone = "0240000001") {
  await page.getByLabel(/^Your mobile number/).fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Code from the text message").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByTestId("verified-phone")).toContainText(
    "+233240000001",
  );
}

test.describe("kiosk and online ordering", () => {
  test.beforeEach(async () => {
    await resetTill();
    await openShifts();
    await setOnline({
      "online.enabled": true,
      "online.paused": false,
      "online.pay_at_counter": true,
      "online.prep_minutes": 15,
    });
  });
  test.afterAll(async () => {
    await setOnline({
      "online.enabled": false,
      "online.pay_at_counter": false,
    });
    await resetTill();
  });

  test("an online order paid online goes to the kitchen; one to pay at the counter waits", async ({
    browser,
  }) => {
    const customer = await (await browser.newContext()).newPage();
    await open(customer, "/order");
    await customer
      .getByTestId("online-branch")
      .filter({ hasText: "Main branch" })
      .click();
    await customer.getByRole("tab", { name: "Drinks" }).click();
    await customer.getByRole("button", { name: /^Water,/ }).click();
    await expect(customer.getByTestId("customer-total")).toHaveText("$5.50");
    await verifyPhone(customer);

    // Pay now: the test provider stands in for the real one.
    await customer.getByRole("button", { name: "Pay now" }).click();
    await expect(customer).toHaveURL(/\/order\/test-pay\?/);
    await customer.getByRole("button", { name: "Pay $5.50" }).click();
    await expect(customer.getByTestId("tracked-state")).toHaveText(
      "Paid. The kitchen is making it.",
    );
    // Back through /order/return to the order's page.
    const paidId = decodeURIComponent(customer.url()).match(
      /track\/([0-9a-f-]{36})/,
    )![1];
    expect(await order(paidId)).toMatchObject({
      channel: "online",
      status: "paid",
      total: 550,
    });
    expect((await order(paidId)).sent_to_kitchen_at).not.toBeNull();

    // A second order, paid at the counter: unpaid, so not in the kitchen.
    await open(customer, `/order/${SEED.branchId}`);
    await customer.getByRole("tab", { name: "Drinks" }).click();
    await customer.getByRole("button", { name: /^Water,/ }).click();
    await customer.getByRole("button", { name: "Pay when I collect" }).click();
    await expect(customer.getByTestId("tracked-state")).toHaveText(
      /pay when you collect/,
    );
    const counterId = customer.url().split("/").pop()!;
    const counter = await order(counterId);
    expect(counter).toMatchObject({
      channel: "online",
      paid_at: null,
      sent_to_kitchen_at: null,
      pay_at_counter: true,
    });

    // The kitchen shows the paid one, not the unpaid one.
    const kds = await (await browser.newContext()).newPage();
    await setUpDevice(kds, "Kitchen display");
    await expect(kds).toHaveURL(/\/kds$/);
    const paidNumber = (await order(paidId)).order_number;
    await expect(
      kds.getByRole("article", { name: `Order ${paidNumber}` }),
    ).toContainText("Online");
    await expect(
      kds.getByRole("article", { name: `Order ${counter.order_number}` }),
    ).toHaveCount(0);

    // At the counter the cashier finds it under Unpaid orders and takes cash.
    const till = await (await browser.newContext()).newPage();
    await setUpTill(till);
    await enterPin(till, SEED.cashier.pin);
    await till.getByRole("button", { name: "Unpaid orders" }).click();
    const unpaid = till.getByRole("dialog", { name: "Unpaid orders" });
    const row = unpaid
      .getByTestId("unpaid-order")
      .filter({ hasText: `Order ${counter.order_number}` });
    await expect(row).toContainText("Online");
    await row.getByRole("button", { name: "Take $5.50" }).click();
    await till
      .getByRole("dialog", { name: "Take payment" })
      .getByRole("button", { name: /^Exact / })
      .click();
    await expect(
      till.getByRole("dialog", { name: "Sale complete" }),
    ).toBeVisible();
    await expect
      .poll(async () => (await order(counterId)).sent_to_kitchen_at)
      .not.toBeNull();
    await expect(
      kds.getByRole("article", { name: `Order ${counter.order_number}` }),
    ).toBeVisible();
    await expect(customer.getByTestId("tracked-state")).toHaveText(
      "Paid. The kitchen is making it.",
      {
        timeout: 15_000,
      },
    );
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
    await page.getByRole("button", { name: "Pay at the counter" }).click();
    const number = (await page
      .getByTestId("kiosk-order-number")
      .textContent())!;
    const { data: placed } = await db
      .from("orders")
      .select("channel, paid_at, sent_to_kitchen_at, pay_at_counter, total")
      .eq("branch_id", SEED.branchId)
      .eq("order_number", number)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(placed).toMatchObject({
      channel: "kiosk",
      paid_at: null,
      sent_to_kitchen_at: null,
      pay_at_counter: true,
    });
    expect(placed!.total).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: "Take away" })).toBeVisible();
  });

  test("reports show online sales by channel; pausing tells customers", async ({
    page,
  }) => {
    // The earlier tests' online orders, paid online and at the counter.
    await signIn(page, SEED.manager.email);
    await expect(page).toHaveURL(/\/manager$/);
    const { data: day } = await localAdmin()
      .from("business_days")
      .select("business_date")
      .eq("branch_id", SEED.branchId)
      .eq("status", "open")
      .single();
    await open(
      page,
      `/manager/reports/sales?from=${day!.business_date}&to=${day!.business_date}`,
    );
    const channels = page.getByRole("region", { name: "Channels" });
    await channels.getByRole("radio", { name: "table" }).click();
    await expect(
      channels.getByRole("cell", { name: "Online", exact: true }),
    ).toBeVisible();

    await setOnline({ "online.paused": true });
    await open(page, `/order/${SEED.branchId}`);
    await expect(
      page.getByText("We've paused online orders for a moment."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pay when I collect" }),
    ).toBeDisabled();
  });
});
