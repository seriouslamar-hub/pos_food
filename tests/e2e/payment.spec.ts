import { expect, type Page } from "@playwright/test";
import { test } from "@playwright/test";
import {
  capturePrints,
  enterPin,
  localAdmin,
  openShifts,
  prints,
  resetTill,
  SEED,
  setBranchSetting,
  setUpTill,
} from "./helpers";

async function openTill(page: Page) {
  await openShifts();
  await capturePrints(page);
  await setUpTill(page);
  await enterPin(page, SEED.cashier.pin);
  await expect(page.getByTestId("till-staff-name")).toHaveText(
    SEED.cashier.name,
  );
}

/** Rings up waters ($5.00 + 10% tax each in the seed data). */
async function addWater(page: Page, times = 1) {
  await page.getByRole("tab", { name: "Drinks" }).click();
  for (let i = 0; i < times; i++) {
    await page.getByRole("button", { name: /^Water,/ }).click();
  }
}

async function savedOrder(orderNumber: string) {
  const { data } = await localAdmin()
    .from("orders")
    .select("id, status, total, paid_at, sent_to_kitchen_at")
    .eq("branch_id", SEED.branchId)
    .eq("order_number", orderNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data!;
}

async function paymentsFor(orderId: string) {
  const { data } = await localAdmin()
    .from("payments")
    .select("method, amount, tendered, change_given, reference")
    .eq("order_id", orderId)
    .order("created_at");
  return data;
}

test.describe("payments", () => {
  test.beforeEach(async () => {
    await resetTill();
  });
  test.afterAll(async () => {
    await resetTill();
  });

  test("cash with a quick amount gives change", async ({ page }) => {
    await openTill(page);
    await addWater(page, 2);
    await page.getByRole("button", { name: "Charge $11.00" }).click();

    const payment = page.getByRole("dialog", { name: "Take payment" });
    // Exact, then the next round amounts.
    for (const amount of ["Exact $11.00", "$15.00", "$20.00", "$50.00"]) {
      await expect(
        payment.getByRole("button", { name: amount, exact: true }),
      ).toBeVisible();
    }
    await payment.getByRole("button", { name: "$20.00", exact: true }).click();

    const done = page.getByRole("dialog", { name: "Sale complete" });
    await expect(done.getByTestId("change-due")).toHaveText("$9.00");
    await expect(done.getByTestId("receipt")).toContainText("Change$9.00");
    const order = await savedOrder(
      (await done.getByTestId("order-number").textContent())!,
    );
    expect(order).toMatchObject({ status: "paid", total: 1100 });
    expect(await paymentsFor(order.id)).toEqual([
      {
        method: "cash",
        amount: 1100,
        tendered: 2000,
        change_given: 900,
        reference: null,
      },
    ]);
    // Receipts print only when asked (receipt.auto_print is off).
    expect(await prints(page)).toEqual([]);
    await done.getByRole("button", { name: "Print receipt" }).click();
    await expect.poll(async () => (await prints(page)).length).toBe(1);
    expect((await prints(page))[0].kinds).toEqual(["receipt"]);
  });

  test("typed cash and a split with card", async ({ page }) => {
    await openTill(page);
    await addWater(page);
    await page.getByRole("button", { name: "Charge $5.50" }).click();
    const payment = page.getByRole("dialog", { name: "Take payment" });

    // Card needs the reference from the terminal.
    await payment.getByRole("radio", { name: "Card" }).click();
    for (const key of ["2", "00"]) {
      await payment.getByRole("button", { name: key, exact: true }).click();
    }
    await payment.getByRole("button", { name: "Pay $2.00 by Card" }).click();
    await expect(payment.getByTestId("payment-error")).toHaveText(
      "Card needs a reference number.",
    );
    await payment.getByRole("textbox", { name: "Reference" }).fill("AUTH-77");
    await payment.getByRole("button", { name: "Pay $2.00 by Card" }).click();
    await expect(payment.getByTestId("payment-line")).toHaveCount(1);
    await expect(payment.getByTestId("payment-due")).toHaveText("$3.50");

    // The rest in cash, typed on the keypad: 5.00 handed over.
    await payment.getByRole("radio", { name: "Cash" }).click();
    for (const key of ["5", "00"]) {
      await payment.getByRole("button", { name: key, exact: true }).click();
    }
    await expect(payment.getByTestId("payment-entered")).toHaveText("$5.00");
    await payment.getByRole("button", { name: "Take $5.00 cash" }).click();

    const done = page.getByRole("dialog", { name: "Sale complete" });
    await expect(done.getByTestId("change-due")).toHaveText("$1.50");
    const order = await savedOrder(
      (await done.getByTestId("order-number").textContent())!,
    );
    expect(await paymentsFor(order.id)).toEqual([
      {
        method: "card",
        amount: 200,
        tendered: null,
        change_given: null,
        reference: "AUTH-77",
      },
      {
        method: "cash",
        amount: 350,
        tendered: 500,
        change_given: 150,
        reference: null,
      },
    ]);
  });

  test("going back keeps the order and charges nothing", async ({ page }) => {
    await openTill(page);
    await addWater(page);
    await page.getByRole("button", { name: "Charge $5.50" }).click();
    const payment = page.getByRole("dialog", { name: "Take payment" });
    await payment.getByRole("button", { name: "Back" }).click();
    await expect(payment).toBeHidden();
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
  });

  test("receipts and kitchen tickets print by setting; reprint marks a copy", async ({
    page,
  }) => {
    await setBranchSetting("receipt.auto_print", true);
    await setBranchSetting("print.kitchen_tickets", true);
    await openTill(page);
    await addWater(page);
    await page.getByRole("button", { name: "Charge $5.50" }).click();
    await page
      .getByRole("dialog", { name: "Take payment" })
      .getByRole("button", { name: "Exact $5.50" })
      .click();
    const done = page.getByRole("dialog", { name: "Sale complete" });
    const number = (await done.getByTestId("order-number").textContent())!;

    await expect.poll(async () => (await prints(page)).length).toBe(1);
    const [first] = await prints(page);
    expect(first.kinds).toEqual(["kitchen-ticket", "receipt"]);
    expect(first.text).toContain(`#${number}`);
    expect(first.text).toContain(`Order ${number}`);
    expect(first.text).not.toContain("COPY");

    await done.getByRole("button", { name: "New order" }).click();
    await page.getByRole("button", { name: "Reprint last receipt" }).click();
    await expect.poll(async () => (await prints(page)).length).toBe(2);
    const second = (await prints(page))[1];
    expect(second.kinds).toEqual(["receipt"]);
    expect(second.text).toContain("COPY");
    expect(second.text).toContain(`Order ${number}`);
  });

  test("pay-later dine-in goes to the kitchen, then is paid from Unpaid orders", async ({
    page,
  }) => {
    await setBranchSetting("orders.pay_later_dine_in", true);
    await openTill(page);
    await addWater(page);

    // Only dine-in orders can be paid later.
    const payLater = page.getByRole("button", {
      name: "Send to kitchen, pay later",
    });
    await expect(payLater).toHaveCount(0);
    await page.getByRole("radio", { name: "Dine-in" }).click();
    await payLater.click();

    const notice = page.getByTestId("order-notice");
    await expect(notice).toContainText("is with the kitchen");
    const number = (await notice.getByTestId("order-number").textContent())!;
    let order = await savedOrder(number);
    expect(order).toMatchObject({ status: "in_kitchen", paid_at: null });
    expect(order.sent_to_kitchen_at).not.toBeNull();
    await expect(page.getByTestId("cart-line")).toHaveCount(0);

    await page.getByRole("button", { name: "Unpaid orders" }).click();
    const unpaid = page.getByRole("dialog", { name: "Unpaid orders" });
    await unpaid
      .getByTestId("unpaid-order")
      .filter({ hasText: `Order ${number}` })
      .getByRole("button", { name: "Take $5.50" })
      .click();

    const payment = page.getByRole("dialog", { name: "Take payment" });
    await expect(payment).toContainText(`Order ${number}`);
    await payment.getByRole("radio", { name: "Mobile money" }).click();
    await payment.getByRole("textbox", { name: "Reference" }).fill("MOMO-1");
    await payment
      .getByRole("button", { name: "Pay $5.50 by Mobile money" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Sale complete" }),
    ).toBeVisible();

    order = await savedOrder(number);
    expect(order.status).toBe("in_kitchen");
    expect(order.paid_at).not.toBeNull();
  });
});
