import { expect, type Browser, type Page, test } from "@playwright/test";
import {
  enterPin,
  localAdmin,
  openShifts,
  resetTill,
  SEED,
  setBranchSetting,
  setUpDevice,
  setUpTill,
} from "./helpers";

async function screens(browser: Browser) {
  const open = async () => (await browser.newContext()).newPage();
  const [till, kds, board] = await Promise.all([open(), open(), open()]);
  await setUpDevice(kds, "Kitchen display");
  await expect(kds).toHaveURL(/\/kds$/);
  await setUpDevice(board, "Pickup board");
  await expect(board).toHaveURL(/\/pickup$/);
  await setUpTill(till);
  await enterPin(till, SEED.cashier.pin);
  await expect(till.getByTestId("till-staff-name")).toHaveText(
    SEED.cashier.name,
  );
  return { till, kds, board };
}

async function ringUp(till: Page) {
  await till.getByRole("tab", { name: "Drinks" }).click();
  await till.getByRole("button", { name: /^Water,/ }).click();
  await till.getByRole("tab", { name: "Sides" }).click();
  await till.getByRole("button", { name: /^Coleslaw,/ }).click();
}

test.describe("kitchen display and pickup board", () => {
  test.beforeEach(async () => {
    await resetTill();
    await openShifts();
  });
  test.afterAll(async () => {
    await resetTill();
  });

  test("an order goes from the till to the kitchen, the pickup board and the customer", async ({
    browser,
  }) => {
    const { till, kds, board } = await screens(browser);

    await ringUp(till);
    await till.getByRole("button", { name: "Charge $16.50" }).click();
    await till
      .getByRole("dialog", { name: "Take payment" })
      .getByRole("button", { name: "Exact $16.50" })
      .click();
    const done = till.getByRole("dialog", { name: "Sale complete" });
    const number = (await done.getByTestId("order-number").textContent())!;
    await done.getByRole("button", { name: "New order" }).click();

    // On the kitchen screen within a couple of seconds, and preparing.
    const ticket = kds.getByRole("article", { name: `Order ${number}` });
    await expect(ticket).toBeVisible({ timeout: 5_000 });
    await expect(ticket.getByTestId("kds-line")).toHaveText([
      /1 × Water/,
      /1 × Coleslaw/,
    ]);
    await expect(board.getByTestId("pickup-preparing")).toContainText(number);

    // Bump one item, then the rest.
    await ticket.getByTestId("kds-line").first().click();
    await expect(ticket.getByTestId("kds-line").first()).toHaveAttribute(
      "data-status",
      "done",
    );
    await ticket
      .getByRole("button", { name: `Done with order ${number}` })
      .click();
    await expect(ticket).toHaveCount(0);
    await expect(board.getByTestId("pickup-ready")).toContainText(number, {
      timeout: 5_000,
    });
    await expect(board.getByTestId("pickup-preparing")).not.toContainText(
      number,
    );

    // The till hands it over.
    await till.getByTestId("ready-button").click();
    const panel = till.getByRole("dialog", { name: "Kitchen orders" });
    await panel
      .getByTestId("kitchen-order")
      .filter({ hasText: `#${number}` })
      .getByRole("button", { name: "Collected" })
      .click();
    await expect(board.getByTestId("pickup-ready")).not.toContainText(number, {
      timeout: 5_000,
    });

    const { data: order } = await localAdmin()
      .from("orders")
      .select("status, sent_to_kitchen_at, ready_at, collected_at")
      .eq("branch_id", SEED.branchId)
      .eq("order_number", number)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(order?.status).toBe("collected");
    expect(Date.parse(order!.ready_at!)).toBeGreaterThanOrEqual(
      Date.parse(order!.sent_to_kitchen_at!),
    );
    expect(Date.parse(order!.collected_at!)).toBeGreaterThanOrEqual(
      Date.parse(order!.ready_at!),
    );
  });

  test("a void shows on the kitchen screen until acknowledged", async ({
    browser,
  }) => {
    await setBranchSetting("orders.pay_later_dine_in", true);
    const { till, kds } = await screens(browser);

    await ringUp(till);
    await till.getByRole("radio", { name: "Dine-in" }).click();
    await till
      .getByRole("button", { name: "Send to kitchen, pay later" })
      .click();
    const number = (await till
      .getByTestId("order-notice")
      .getByTestId("order-number")
      .textContent())!;
    const ticket = kds.getByRole("article", { name: `Order ${number}` });
    await expect(ticket).toBeVisible({ timeout: 5_000 });

    // A manager approves voiding the water.
    await till.getByRole("button", { name: "Orders", exact: true }).click();
    const lookup = till.getByRole("dialog", { name: "Find an order" });
    await lookup.getByLabel("Order number").fill(number);
    await lookup.getByRole("button", { name: "Search" }).click();
    await lookup
      .getByTestId("found-order")
      .filter({ hasText: `Order ${number}` })
      .first()
      .click();
    await till
      .getByRole("dialog", { name: `Order ${number}` })
      .getByRole("button", { name: "Void items" })
      .click();
    const voiding = till.getByRole("dialog", {
      name: `Void items on order ${number}`,
    });
    await voiding.getByRole("checkbox", { name: "Void 1 × Water" }).click();
    await voiding
      .getByRole("button", { name: "Customer changed mind" })
      .click();
    await voiding.getByRole("button", { name: "Void 1 item" }).click();
    const approval = till.getByRole("dialog", { name: "Manager approval" });
    await enterPin(approval, SEED.manager.pin, "Approve");

    const water = ticket.getByTestId("kds-line").filter({ hasText: "Water" });
    await expect(water).toHaveAttribute("data-status", "voided", {
      timeout: 5_000,
    });
    await expect(water).toContainText("VOID");

    // Done acknowledges the void along with the rest.
    await ticket
      .getByRole("button", { name: `Done with order ${number}` })
      .click();
    await expect(ticket).toHaveCount(0);
  });
});
