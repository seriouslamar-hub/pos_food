import { expect, test } from "@playwright/test";
import {
  capturePrints,
  closeShiftsAndDay,
  enterPin,
  localAdmin,
  open,
  openShifts,
  prints,
  resetTill,
  SEED,
  setUpTill,
  signIn,
} from "./helpers";

test.describe("business day and shifts", () => {
  test.beforeEach(async () => {
    await resetTill();
    await closeShiftsAndDay();
  });
  test.afterAll(async () => {
    await closeShiftsAndDay();
    await resetTill();
  });

  test("a full day on the till: open, sell, drop, blind count, close", async ({
    page,
  }) => {
    await capturePrints(page);
    await setUpTill(page);
    await enterPin(page, SEED.cashier.pin);

    // The day isn't open, and a cashier needs a manager to open it.
    await expect(
      page.getByRole("heading", { name: "The business day isn't open" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open the business day" }).click();
    const approval = page.getByRole("dialog", { name: "Manager approval" });
    await enterPin(approval, SEED.manager.pin, "Approve");

    // Count a 50.00 float: 2 × 20 and 1 × 10.
    await expect(
      page.getByRole("heading", { name: "Open your shift" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "One more $20.00" }).click();
    await page.getByRole("button", { name: "One more $20.00" }).click();
    await page.getByRole("textbox", { name: "Number of $10.00" }).fill("1");
    await expect(page.getByTestId("cash-count-total")).toHaveText("$50.00");
    await page.getByRole("button", { name: "Open shift with $50.00" }).click();

    // Sell 2 waters (11.00) for 20.00 cash.
    await page.getByRole("tab", { name: "Drinks" }).click();
    await page.getByRole("button", { name: /^Water,/ }).click();
    await page.getByRole("button", { name: /^Water,/ }).click();
    await page.getByRole("button", { name: "Charge $11.00" }).click();
    await page
      .getByRole("dialog", { name: "Take payment" })
      .getByRole("button", { name: "$20.00", exact: true })
      .click();
    const done = page.getByRole("dialog", { name: "Sale complete" });
    await expect(done.getByTestId("change-due")).toHaveText("$9.00");
    await done.getByRole("button", { name: "New order" }).click();

    // Drop 10.00 to the safe.
    const cash = () =>
      page.getByRole("button", { name: "Cash", exact: true }).click();
    await cash();
    await page
      .getByRole("dialog", { name: "Cash" })
      .getByRole("button", { name: "Cash drop" })
      .click();
    const drop = page.getByRole("dialog", { name: "Cash drop" });
    await drop.getByLabel("Amount").fill("10");
    await drop.getByRole("button", { name: "Record cash drop" }).click();
    await expect(page.getByTestId("till-action-result")).toHaveText(
      "Cash drop of $10.00 recorded.",
    );

    // The X report shows the shift without the expected cash.
    await cash();
    await page
      .getByRole("dialog", { name: "Cash" })
      .getByRole("button", { name: "X report" })
      .click();
    const x = page
      .getByRole("dialog", { name: "X report" })
      .getByTestId("x-report");
    await expect(x).toContainText("Orders1");
    await expect(x).toContainText("Cash (1)$11.00");
    await expect(x).toContainText("Cash drops−$10.00");
    await expect(x).not.toContainText("Expected");
    await page
      .getByRole("dialog", { name: "X report" })
      .getByRole("button", { name: "Done" })
      .click();

    // Blind count: 50.00 + 1.00 = 51.00, which is what the drawer should
    // hold (50.00 float + 11.00 sale − 10.00 drop), but the till never says.
    await cash();
    await page
      .getByRole("dialog", { name: "Cash" })
      .getByRole("button", { name: "Close my shift" })
      .click();
    const closing = page.getByRole("dialog", { name: "Close your shift" });
    await expect(closing).not.toContainText("Expected");
    await closing.getByRole("textbox", { name: "Number of $50.00" }).fill("1");
    await closing.getByRole("button", { name: "One more $1.00" }).click();
    await closing.getByRole("button", { name: "Done counting" }).click();
    await expect(closing.getByTestId("close-shift-total")).toHaveText("$51.00");
    await closing.getByRole("button", { name: "Close shift" }).click();

    // The till locks, and the slip for the cash bag prints.
    await expect(
      page.getByText("Shift closed. You counted $51.00."),
    ).toBeVisible();
    await expect
      .poll(async () => (await prints(page)).map((p) => p.kinds.join("+")))
      .toContain("shift-close-slip");

    const db = localAdmin();
    const { data: shift } = await db
      .from("shifts")
      .select("opening_float, expected_cash, counted_cash, variance, status")
      .eq("staff_id", SEED.cashier.id)
      .order("opened_at", { ascending: false })
      .limit(1)
      .single();
    expect(shift).toEqual({
      opening_float: 5000,
      expected_cash: 5100,
      counted_cash: 5100,
      variance: 0,
      status: "pending_review",
    });

    // End of day: the manager closes the day and the Z report prints.
    await enterPin(page, SEED.manager.pin);
    await page.getByRole("button", { name: "End of day" }).click();
    const endOfDay = page.getByRole("dialog", {
      name: "Close the business day",
    });
    await expect(endOfDay.getByTestId("open-shift")).toHaveCount(0);
    await endOfDay
      .getByRole("button", { name: "Close the business day" })
      .click();
    const z = page
      .getByRole("dialog", { name: "Z report" })
      .getByTestId("z-report");
    // Today may hold earlier test runs, so check this shift's line.
    await expect(z).toContainText(
      `${SEED.cashier.name} · Till T1 · To reviewExpected $51.00 · Counted $51.00 · $0.00`,
    );
    await expect
      .poll(async () => (await prints(page)).map((p) => p.kinds.join("+")))
      .toContain("z-report");
    await page
      .getByRole("dialog", { name: "Z report" })
      .getByRole("button", { name: "Done" })
      .click();
    await expect(
      page.getByRole("heading", { name: "The business day isn't open" }),
    ).toBeVisible();

    // The stored Z report matches the day's paid orders.
    const { data: day } = await db
      .from("business_days")
      .select("business_date, status, z_report")
      .eq("branch_id", SEED.branchId)
      .order("business_date", { ascending: false })
      .limit(1)
      .single();
    expect(day?.status).toBe("closed");
    const { data: paid } = await db
      .from("orders")
      .select("total")
      .eq("branch_id", SEED.branchId)
      .eq("business_date", day!.business_date)
      .not("paid_at", "is", null)
      .neq("status", "voided");
    const report = day?.z_report as { net_sales: number; orders: number };
    expect(report.orders).toBe(paid!.length);
    expect(report.net_sales).toBe(paid!.reduce((sum, o) => sum + o.total, 0));
  });

  test("the manager opens the day, reviews a short shift and closes the day", async ({
    page,
  }) => {
    await signIn(page, SEED.manager.email);
    await expect(page).toHaveURL(/\/manager$/);
    await open(page, "/manager/day");
    await expect(page.getByTestId("day-status")).toHaveText(
      "No business day is open",
    );
    await page
      .getByRole("button", { name: "Open today's business day" })
      .click();
    await expect(page.getByTestId("day-status")).toHaveText(/^Open: /);

    // Kofi's drawer came up 10.00 short (the alert starts above 5.00).
    await openShifts([]);
    const db = localAdmin();
    const { data: day } = await db
      .from("business_days")
      .select("id")
      .eq("branch_id", SEED.branchId)
      .eq("status", "open")
      .single();
    const now = new Date().toISOString();
    await db.from("shifts").insert({
      branch_id: SEED.branchId,
      business_day_id: day!.id,
      staff_id: SEED.cashier2.id,
      device_id: SEED.tillDeviceId,
      opening_float: 5000,
      expected_cash: 5000,
      counted_cash: 4000,
      variance: -1000,
      status: "pending_review",
      closed_at: now,
    });
    await page.reload();
    // The newest shift is listed last (today may hold earlier test runs).
    const row = page
      .getByTestId("day-shift")
      .filter({ hasText: SEED.cashier2.name })
      .last();
    await expect(row.locator("[data-alert]")).toHaveText("-$10.00");

    await row
      .getByRole("button", { name: `Flag ${SEED.cashier2.name}'s shift` })
      .click();
    const flag = page.getByRole("dialog", {
      name: `Flag ${SEED.cashier2.name}'s shift`,
    });
    await flag.getByLabel("Note").fill("10.00 short, being checked");
    await flag.getByRole("button", { name: "Flag shift" }).click();
    await expect(row).toContainText("Flagged");
    await expect(row).toContainText("10.00 short, being checked");

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Close the business day" }).click();
    await expect(page.getByTestId("day-status")).toHaveText(
      "No business day is open",
    );
    await expect(page.getByRole("heading", { name: "Z report" })).toBeVisible();
  });
});
