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

  test("an online order waits, unpaid, until it's paid at the counter by the customer's chosen method", async ({
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
    // No payment gateway: there's no "Pay now", only how they'll pay at the counter.
    await expect(customer.getByRole("button", { name: "Pay now" })).toHaveCount(
      0,
    );
    const place = customer.getByRole("button", {
      name: "Place order, pay when I collect",
    });
    await expect(place).toBeDisabled();
    await customer.getByRole("radio", { name: "Mobile money" }).click();
    await place.click();
    await expect(customer.getByTestId("tracked-state")).toHaveText(
      /pay when you collect/,
    );
    const orderId = customer.url().split("/").pop()!;
    const placed = await order(orderId);
    expect(placed).toMatchObject({
      channel: "online",
      paid_at: null,
      sent_to_kitchen_at: null,
      pay_at_counter: true,
    });

    // Not in the kitchen while unpaid.
    const kds = await (await browser.newContext()).newPage();
    await setUpDevice(kds, "Kitchen display");
    await expect(kds).toHaveURL(/\/kds$/);
    await expect(
      kds.getByRole("article", { name: `Order ${placed.order_number}` }),
    ).toHaveCount(0);

    // At the counter: Unpaid orders says how they'll pay, and the payment
    // screen opens on that method.
    const till = await (await browser.newContext()).newPage();
    await setUpTill(till);
    await enterPin(till, SEED.cashier.pin);
    await till.getByRole("button", { name: "Unpaid orders" }).click();
    const unpaid = till.getByRole("dialog", { name: "Unpaid orders" });
    const row = unpaid
      .getByTestId("unpaid-order")
      .filter({ hasText: `Order ${placed.order_number}` });
    await expect(row).toContainText("Online");
    await expect(row).toContainText("will pay by mobile money");
    await row.getByRole("button", { name: "Take $5.50" }).click();
    const payment = till.getByRole("dialog", { name: "Take payment" });
    await expect(
      payment.getByRole("radio", { name: "Mobile money" }),
    ).toHaveAttribute("aria-checked", "true");
    await payment.getByRole("textbox", { name: "Reference" }).fill("MOMO-77");
    await payment
      .getByRole("button", { name: "Pay $5.50 by Mobile money" })
      .click();
    await expect(
      till.getByRole("dialog", { name: "Sale complete" }),
    ).toBeVisible();

    // Paid: now it goes to the kitchen, and the customer sees it.
    await expect
      .poll(async () => (await order(orderId)).sent_to_kitchen_at)
      .not.toBeNull();
    await expect(
      kds.getByRole("article", { name: `Order ${placed.order_number}` }),
    ).toContainText("Online");
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

  test("reports show online sales by channel; pausing tells customers", async ({
    page,
  }) => {
    // The earlier test's online order, paid at the counter.
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
      page.getByRole("button", { name: "Place order, pay when I collect" }),
    ).toBeDisabled();
  });
});
