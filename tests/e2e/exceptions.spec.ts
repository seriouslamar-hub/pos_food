import { expect, type Page, test } from "@playwright/test";
import {
  capturePrints,
  enterPin,
  localAdmin,
  open,
  openShifts,
  prints,
  resetTill,
  SEED,
  setBranchSetting,
  setUpTill,
  signIn,
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

async function addWater(page: Page, times = 1) {
  await page.getByRole("tab", { name: "Drinks" }).click();
  for (let i = 0; i < times; i++) {
    await page.getByRole("button", { name: /^Water,/ }).click();
  }
}

/** Pays the open payment screen with exact cash; returns the order number. */
async function payExact(page: Page) {
  await page
    .getByRole("dialog", { name: "Take payment" })
    .getByRole("button", { name: /^Exact/ })
    .click();
  const done = page.getByRole("dialog", { name: "Sale complete" });
  const number = (await done.getByTestId("order-number").textContent())!;
  return { done, number };
}

async function approveAsManager(page: Page) {
  const approval = page.getByRole("dialog", { name: "Manager approval" });
  await expect(approval).toBeVisible();
  await enterPin(approval, SEED.manager.pin, "Approve");
  await expect(approval).toBeHidden();
}

async function savedOrder(orderNumber: string) {
  const { data } = await localAdmin()
    .from("orders")
    .select("id, status, total, discount_total, discount_approved_by")
    .eq("branch_id", SEED.branchId)
    .eq("order_number", orderNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data!;
}

test.describe("discounts, price changes, refunds and voids", () => {
  test.beforeEach(async () => {
    await resetTill();
  });
  test.afterAll(async () => {
    await resetTill();
  });

  test("discounts within the cashier's limit, and above it with a manager's PIN", async ({
    page,
  }) => {
    await openTill(page);
    await addWater(page, 2);

    // 10% off two waters: within Ama's limit.
    await page
      .getByRole("button", { name: "Discount or price for Water" })
      .click();
    const options = page.getByRole("dialog", { name: "2 × Water" });
    await options.getByLabel("Percent off").fill("10");
    await options.getByRole("button", { name: "Staff meal" }).click();
    await options.getByRole("button", { name: "Apply discount" }).click();
    await expect(page.getByTestId("cart-discounts")).toContainText("−$1.00");
    // 10.00 − 1.00 + 10% tax on 9.00.
    await expect(page.getByTestId("cart-total")).toHaveText("$9.90");
    await page.getByRole("button", { name: "Charge $9.90" }).click();
    let sale = await payExact(page);
    await expect(sale.done.getByTestId("receipt")).toContainText(
      "Discount (Staff meal)−$1.00",
    );
    expect(await savedOrder(sale.number)).toMatchObject({
      discount_total: 100,
      total: 990,
      discount_approved_by: null,
    });
    await sale.done.getByRole("button", { name: "New order" }).click();

    // Half off the whole order is over the limit: the manager approves.
    await addWater(page);
    await page.getByRole("button", { name: "Discount", exact: true }).click();
    const discount = page.getByRole("dialog", { name: "Discount the order" });
    await discount.getByLabel("Percent off").fill("50");
    await discount.getByLabel("Reason").fill("Customer complaint");
    await discount.getByRole("button", { name: "Apply discount" }).click();
    await page.getByRole("button", { name: "Charge $2.75" }).click();
    await approveAsManager(page);
    sale = await payExact(page);
    expect(await savedOrder(sale.number)).toMatchObject({
      discount_total: 250,
      total: 275,
      discount_approved_by: SEED.manager.id,
    });
  });

  test("a changed price needs a manager", async ({ page }) => {
    await openTill(page);
    await addWater(page);
    await page
      .getByRole("button", { name: "Discount or price for Water" })
      .click();
    const options = page.getByRole("dialog", { name: "1 × Water" });
    await options.getByLabel("New price (USD)").fill("4");
    await options.getByRole("button", { name: "Damaged item" }).click();
    await options.getByRole("button", { name: "Change price" }).click();
    await expect(page.getByTestId("line-price-change")).toContainText(
      "$4.00 each (menu $5.00)",
    );
    await page.getByRole("button", { name: "Charge $4.40" }).click();
    await approveAsManager(page);
    const sale = await payExact(page);
    const order = await savedOrder(sale.number);
    const { data: line } = await localAdmin()
      .from("order_items")
      .select("unit_price, price_override_from, price_approved_by")
      .eq("order_id", order.id)
      .single();
    expect(line).toEqual({
      unit_price: 400,
      price_override_from: 500,
      price_approved_by: SEED.manager.id,
    });
  });

  test("a partial refund with a manager's PIN, found from Orders", async ({
    page,
  }) => {
    await openTill(page);
    await addWater(page);
    await page.getByRole("tab", { name: "Sides" }).click();
    await page.getByRole("button", { name: /^Coleslaw,/ }).click();
    await page.getByRole("button", { name: "Charge $16.50" }).click();
    const sale = await payExact(page);
    await sale.done.getByRole("button", { name: "New order" }).click();

    await page.getByRole("button", { name: "Orders", exact: true }).click();
    const lookup = page.getByRole("dialog", { name: "Find an order" });
    await lookup.getByLabel("Order number").fill(sale.number);
    await lookup.getByRole("button", { name: "Search" }).click();
    await lookup
      .getByTestId("found-order")
      .filter({ hasText: `Order ${sale.number}` })
      .first()
      .click();

    const detail = page.getByRole("dialog", { name: `Order ${sale.number}` });
    await detail.getByRole("button", { name: "Refund", exact: true }).click();
    const refund = page.getByRole("dialog", {
      name: `Refund order ${sale.number}`,
    });
    await refund.getByRole("radio", { name: "Some items" }).click();
    await refund.getByRole("checkbox", { name: "Refund 1 × Water" }).click();
    await refund.getByRole("button", { name: "Cold food" }).click();
    await refund.getByRole("button", { name: "Refund $5.50" }).click();
    await approveAsManager(page);
    await expect(detail.getByTestId("lookup-message")).toHaveText(
      "Refunded $5.50 by Cash.",
    );
    await expect
      .poll(async () => (await prints(page)).map((p) => p.kinds.join("+")))
      .toContain("refund-slip");

    const order = await savedOrder(sale.number);
    expect(order.status).toBe("partially_refunded");
    const { data: refunds } = await localAdmin()
      .from("refunds")
      .select("amount, method, reason, approved_by")
      .eq("order_id", order.id);
    expect(refunds).toEqual([
      {
        amount: 550,
        method: "cash",
        reason: "Cold food",
        approved_by: SEED.manager.id,
      },
    ]);
  });

  test("voiding what the kitchen has needs a manager", async ({ page }) => {
    await setBranchSetting("orders.pay_later_dine_in", true);
    await openTill(page);
    await addWater(page);
    await page.getByRole("radio", { name: "Dine-in" }).click();
    await page
      .getByRole("button", { name: "Send to kitchen, pay later" })
      .click();
    const number = (await page
      .getByTestId("order-notice")
      .getByTestId("order-number")
      .textContent())!;

    await page.getByRole("button", { name: "Orders", exact: true }).click();
    const lookup = page.getByRole("dialog", { name: "Find an order" });
    await lookup.getByLabel("Order number").fill(number);
    await lookup.getByRole("button", { name: "Search" }).click();
    await lookup
      .getByTestId("found-order")
      .filter({ hasText: `Order ${number}` })
      .first()
      .click();
    const detail = page.getByRole("dialog", { name: `Order ${number}` });
    await detail.getByRole("button", { name: "Void items" }).click();
    const voiding = page.getByRole("dialog", {
      name: `Void items on order ${number}`,
    });
    await expect(voiding).toContainText("a manager approves the void");
    await voiding.getByRole("checkbox", { name: "Void 1 × Water" }).click();
    await voiding.getByRole("button", { name: "Wrong item" }).click();
    await voiding.getByRole("button", { name: "Void 1 item" }).click();
    await approveAsManager(page);
    await expect(detail.getByTestId("lookup-message")).toHaveText(
      "1 item voided. The order is voided.",
    );
    expect((await savedOrder(number)).status).toBe("voided");
  });

  test("the manager sees exceptions and each order's history", async ({
    page,
  }) => {
    await signIn(page, SEED.manager.email);
    await expect(page).toHaveURL(/\/manager$/);
    await open(page, "/manager/exceptions");
    const refunds = page
      .getByTestId("exception-row")
      .filter({ hasText: "Cold food" });
    await expect(refunds.first()).toContainText("Refund");
    await expect(refunds.first()).toContainText(SEED.manager.name);

    await refunds.first().getByRole("link").click();
    await expect(page).toHaveURL(/\/manager\/orders\//);
    await expect(
      page.getByTestId("history-entry").filter({ hasText: "Refund" }),
    ).toContainText(
      `Refund by ${SEED.cashier.name}, approved by ${SEED.manager.name} · Cold food`,
    );
  });
});
