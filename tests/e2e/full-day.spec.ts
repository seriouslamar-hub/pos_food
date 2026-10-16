import { expect, type Locator, type Page, test } from "@playwright/test";
import { formatAmount } from "../../lib/money";
import {
  capturePrints,
  closeShiftsAndDay,
  enterPin,
  localAdmin,
  open,
  resetTill,
  SEED,
  setBranchSetting,
  setUpTill,
  signIn,
} from "./helpers";

// One whole trading day, as the go-live checklist rehearses it: open the
// day, two cashiers' shifts, meals with discounts, a split payment, a void
// with a manager's PIN, a refund, an offline spell, blind counts, the
// manager's reconciliation and the Z report.

async function approve(page: Page) {
  const approval = page.getByRole("dialog", { name: "Manager approval" });
  await expect(approval).toBeVisible();
  await enterPin(approval, SEED.manager.pin, "Approve");
  await expect(approval).toBeHidden();
}

async function finishSale(page: Page) {
  const done = page.getByRole("dialog", { name: "Sale complete" });
  await expect(done).toBeVisible();
  const number = (await done.getByTestId("order-number").textContent())!;
  await done.getByRole("button", { name: "New order" }).click();
  return number;
}

async function payExactCash(page: Page) {
  await page
    .getByRole("dialog", { name: "Take payment" })
    .getByRole("button", { name: /^Exact / })
    .click();
  return finishSale(page);
}

async function water(page: Page) {
  await page.getByRole("tab", { name: "Drinks" }).click();
  await page.getByRole("button", { name: /^Water,/ }).click();
}

async function findOrder(page: Page, number: string): Promise<Locator> {
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  const lookup = page.getByRole("dialog", { name: "Find an order" });
  await lookup.getByLabel("Order number").fill(number);
  await lookup.getByRole("button", { name: "Search" }).click();
  await lookup
    .getByTestId("found-order")
    .filter({ hasText: `Order ${number}` })
    .first()
    .click();
  return page.getByRole("dialog", { name: `Order ${number}` });
}

async function openShift(page: Page, twenties: number) {
  await expect(
    page.getByRole("heading", { name: "Open your shift" }),
  ).toBeVisible();
  for (let i = 0; i < twenties; i++)
    await page.getByRole("button", { name: "One more $20.00" }).click();
  await page.getByRole("button", { name: /^Open shift with / }).click();
  await expect(page.getByRole("tab", { name: "Drinks" })).toBeVisible();
}

async function closeShift(page: Page, twenties: number) {
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Cash" })
    .getByRole("button", { name: "Close my shift" })
    .click();
  const closing = page.getByRole("dialog", { name: "Close your shift" });
  await expect(closing).not.toContainText("Expected");
  for (let i = 0; i < twenties; i++)
    await closing.getByRole("button", { name: "One more $20.00" }).click();
  await closing.getByRole("button", { name: "Done counting" }).click();
  await closing.getByRole("button", { name: "Close shift" }).click();
  await expect(page.getByText(/^Shift closed\. You counted /)).toBeVisible();
}

async function switchUser(page: Page, pin: string) {
  const lock = page.getByRole("button", { name: "Switch user" });
  if (await lock.isVisible()) await lock.click();
  await enterPin(page, pin);
}

test.describe("a full trading day", () => {
  test.beforeEach(async () => {
    await resetTill();
    await closeShiftsAndDay();
    await setBranchSetting("orders.pay_later_dine_in", true);
  });
  test.afterAll(async () => {
    await closeShiftsAndDay();
    await resetTill();
  });

  test("open, sell, exceptions, offline, close and reconcile, Z report", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    // Today's business day may be reopened from earlier runs: look only at
    // what this test adds.
    const started = new Date(Date.now() - 1000).toISOString();
    await capturePrints(page);
    const bundle = page.waitForResponse(/rpc\/get_offline_bundle/);
    await setUpTill(page);
    await bundle;

    // Ama opens the day (with the manager's PIN) and her shift: 40.00.
    await enterPin(page, SEED.cashier.pin);
    await page.getByRole("button", { name: "Open the business day" }).click();
    await approve(page);
    await openShift(page, 2);

    // A 2-piece meal (coleslaw, large drink) with 10% off the order, paid
    // 20.00 by card and the rest in cash.
    await page.getByRole("tab", { name: "Meals" }).click();
    await page.getByRole("button", { name: /^2-piece meal,/ }).click();
    const sheet = page.getByRole("dialog", { name: "2-piece meal" });
    await sheet.getByRole("button", { name: "Next: Side" }).click();
    await sheet.getByRole("button", { name: /^Coleslaw/ }).click();
    await sheet
      .getByRole("region", { name: "Coke: Drink size" })
      .getByRole("button", { name: /^Large/ })
      .click();
    await sheet.getByRole("button", { name: /^Add to order/ }).click();
    await page.getByRole("button", { name: "Discount", exact: true }).click();
    const discount = page.getByRole("dialog", { name: "Discount the order" });
    await discount.getByLabel("Percent off").fill("10");
    await discount.getByLabel("Reason").fill("Customer complaint");
    await discount.getByRole("button", { name: "Apply discount" }).click();
    // 63.00 − 6.30, plus 10% tax.
    await expect(page.getByTestId("cart-total")).toHaveText("$62.37");
    await page.getByRole("button", { name: "Charge $62.37" }).click();
    const payment = page.getByRole("dialog", { name: "Take payment" });
    await payment.getByRole("radio", { name: "Card" }).click();
    for (const key of ["2", "0", "00"])
      await payment.getByRole("button", { name: key, exact: true }).click();
    await payment.getByRole("textbox", { name: "Reference" }).fill("AUTH-1");
    await payment.getByRole("button", { name: "Pay $20.00 by Card" }).click();
    await expect(payment.getByTestId("payment-due")).toHaveText("$42.37");
    await payment.getByRole("radio", { name: "Cash" }).click();
    const meal = await payExactCash(page);

    // A dine-in water sent to the kitchen unpaid, then voided: the kitchen
    // has it, so the manager approves.
    await water(page);
    await page.getByRole("radio", { name: "Dine-in" }).click();
    await page
      .getByRole("button", { name: "Send to kitchen, pay later" })
      .click();
    const unpaid = (await page
      .getByTestId("order-notice")
      .getByTestId("order-number")
      .textContent())!;
    let detail = await findOrder(page, unpaid);
    await detail.getByRole("button", { name: "Void items" }).click();
    const voiding = page.getByRole("dialog", {
      name: `Void items on order ${unpaid}`,
    });
    await voiding.getByRole("checkbox", { name: "Void 1 × Water" }).click();
    await voiding.getByRole("button", { name: "Wrong item" }).click();
    await voiding.getByRole("button", { name: "Void 1 item" }).click();
    await approve(page);
    await expect(detail.getByTestId("lookup-message")).toHaveText(
      "1 item voided. The order is voided.",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("radio", { name: "Takeaway" }).click();

    // Water and coleslaw; the water is refunded in cash.
    await water(page);
    await page.getByRole("tab", { name: "Sides" }).click();
    await page.getByRole("button", { name: /^Coleslaw,/ }).click();
    await page.getByRole("button", { name: "Charge $16.50" }).click();
    const sides = await payExactCash(page);
    detail = await findOrder(page, sides);
    await detail.getByRole("button", { name: "Refund", exact: true }).click();
    const refund = page.getByRole("dialog", { name: `Refund order ${sides}` });
    await refund.getByRole("radio", { name: "Some items" }).click();
    await refund.getByRole("checkbox", { name: "Refund 1 × Water" }).click();
    await refund.getByRole("button", { name: "Cold food" }).click();
    await refund.getByRole("button", { name: "Refund $5.50" }).click();
    await approve(page);
    await expect(detail.getByTestId("lookup-message")).toHaveText(
      "Refunded $5.50 by Cash.",
    );
    await page.keyboard.press("Escape");

    // The internet drops for two sales; they go once it's back.
    await page.context().setOffline(true);
    await expect(page.getByTestId("sync-badge")).toHaveText(/^Offline/);
    const offline: string[] = [];
    for (let i = 0; i < 2; i++) {
      await water(page);
      await page.getByRole("button", { name: "Charge $5.50" }).click();
      offline.push(await payExactCash(page));
    }
    expect(offline.every((n) => /^T1-\d{3}$/.test(n))).toBe(true);
    await page.context().setOffline(false);
    await expect(page.getByTestId("sync-badge")).toHaveCount(0, {
      timeout: 30_000,
    });

    // Kofi's shift on the same till: 20.00 float, one water.
    await switchUser(page, SEED.cashier2.pin);
    await openShift(page, 1);
    await water(page);
    await page.getByRole("button", { name: "Charge $5.50" }).click();
    await payExactCash(page);

    // Blind counts. Kofi's drawer should hold 25.50 and he counts 20.00.
    await closeShift(page, 1);
    // Ama's: 40.00 + 42.37 + 16.50 − 5.50 + 11.00 = 104.37; she counts 100.00.
    await enterPin(page, SEED.cashier.pin);
    await closeShift(page, 5);

    const db = localAdmin();
    const { data: day } = await db
      .from("business_days")
      .select("id, business_date")
      .eq("branch_id", SEED.branchId)
      .eq("status", "open")
      .single();
    const { data: shifts } = await db
      .from("shifts")
      .select("staff_id, expected_cash, counted_cash, variance, status")
      .eq("business_day_id", day!.id)
      .gte("opened_at", started)
      .order("opened_at");
    expect(shifts).toEqual([
      {
        staff_id: SEED.cashier.id,
        expected_cash: 10437,
        counted_cash: 10000,
        variance: -437,
        status: "pending_review",
      },
      {
        staff_id: SEED.cashier2.id,
        expected_cash: 2550,
        counted_cash: 2000,
        variance: -550,
        status: "pending_review",
      },
    ]);

    // The manager reconciles in the back office: Ama's small difference is
    // approved, Kofi's (above the alert) flagged; then closes the day.
    const office = await (await browser.newContext()).newPage();
    await signIn(office, SEED.manager.email);
    await expect(office).toHaveURL(/\/manager$/);
    await open(office, "/manager/day");
    const ama = office
      .getByTestId("day-shift")
      .filter({ hasText: SEED.cashier.name })
      .last();
    await ama
      .getByRole("button", { name: `Approve ${SEED.cashier.name}'s shift` })
      .click();
    await expect(ama).toContainText("Approved");
    const kofi = office
      .getByTestId("day-shift")
      .filter({ hasText: SEED.cashier2.name })
      .last();
    await expect(kofi.locator("[data-alert]")).toHaveText("-$5.50");
    await kofi
      .getByRole("button", { name: `Flag ${SEED.cashier2.name}'s shift` })
      .click();
    const flag = office.getByRole("dialog", {
      name: `Flag ${SEED.cashier2.name}'s shift`,
    });
    await flag.getByLabel("Note").fill("Short, being checked");
    await flag.getByRole("button", { name: "Flag shift" }).click();
    await expect(kofi).toContainText("Flagged");
    office.once("dialog", (d) => void d.accept());
    await office
      .getByRole("button", { name: "Close the business day" })
      .click();
    await expect(office.getByTestId("day-status")).toHaveText(
      "No business day is open",
    );
    await expect(
      office.getByRole("heading", { name: "Z report" }),
    ).toBeVisible();

    // The Z report agrees with the day's orders, payments and refunds.
    const { data: closed } = await db
      .from("business_days")
      .select("status, z_report")
      .eq("id", day!.id)
      .single();
    expect(closed!.status).toBe("closed");
    const z = closed!.z_report as {
      orders: number;
      net_sales: number;
      refunds: { count: number; amount: number };
      voids: { count: number };
      payments: { method: string; amount: number }[];
      cash: { expected: number; counted: number; variance: number };
    };
    const { data: paid } = await db
      .from("orders")
      .select("order_number, total")
      .eq("branch_id", SEED.branchId)
      .eq("business_date", day!.business_date)
      .not("paid_at", "is", null)
      .neq("status", "voided");
    expect(paid!.map((o) => o.order_number)).toEqual(
      expect.arrayContaining([meal, sides, ...offline]),
    );
    expect(z.orders).toBe(paid!.length);
    expect(z.net_sales).toBe(paid!.reduce((s, o) => s + o.total, 0));
    const ours = paid!.filter((o) =>
      [meal, sides, ...offline].includes(o.order_number),
    );
    expect(ours.reduce((sum, o) => sum + o.total, 0)).toBe(
      6237 + 1650 + 550 * 2,
    );
    expect(z.refunds.count).toBeGreaterThanOrEqual(1);
    expect(z.voids.count).toBeGreaterThanOrEqual(1);
    expect(
      z.payments.find((p) => p.method === "card")?.amount,
    ).toBeGreaterThanOrEqual(2000);
    const { data: allShifts } = await db
      .from("shifts")
      .select("expected_cash, counted_cash, variance")
      .eq("business_day_id", day!.id);
    const sum = (k: "expected_cash" | "counted_cash" | "variance") =>
      allShifts!.reduce((total, sh) => total + (sh[k] ?? 0), 0);
    expect(z.cash).toMatchObject({
      expected: sum("expected_cash"),
      counted: sum("counted_cash"),
      variance: sum("variance"),
    });

    // Reports read the same totals.
    await open(
      office,
      `/manager/reports/sales?from=${day!.business_date}&to=${day!.business_date}`,
    );
    await expect(office.getByTestId("net-sales-value")).toHaveText(
      formatAmount(z.net_sales, "USD"),
    );
  });
});
