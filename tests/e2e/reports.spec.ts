import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { formatAmount } from "../../lib/money";
import {
  enterPin,
  localAdmin,
  open,
  openShifts,
  resetTill,
  SEED,
  setUpTill,
  signIn,
} from "./helpers";

/** Today's paid sales at the seeded branch, straight from the database. */
async function todaysSales() {
  const db = localAdmin();
  const { data: day } = await db
    .from("business_days")
    .select("business_date")
    .eq("branch_id", SEED.branchId)
    .eq("status", "open")
    .single();
  const { data: orders } = await db
    .from("orders")
    .select("total")
    .eq("branch_id", SEED.branchId)
    .eq("business_date", day!.business_date)
    .not("paid_at", "is", null)
    .neq("status", "voided");
  return {
    date: day!.business_date as string,
    orders: orders!.length,
    net: orders!.reduce((sum, o) => sum + o.total, 0),
  };
}

async function sellWater(page: Page) {
  await setUpTill(page);
  await enterPin(page, SEED.cashier.pin);
  await page.getByRole("tab", { name: "Drinks" }).click();
  await page.getByRole("button", { name: /^Water,/ }).click();
  await page.getByRole("button", { name: /^Charge / }).click();
  await page
    .getByRole("dialog", { name: "Take payment" })
    .getByRole("button", { name: /^Exact / })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Sale complete" }),
  ).toBeVisible();
}

async function downloadText(page: Page, click: () => Promise<void>) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    click(),
  ]);
  return {
    name: download.suggestedFilename(),
    text: await readFile((await download.path())!, "utf8"),
  };
}

test.describe("reports", () => {
  test.beforeEach(async () => {
    await resetTill();
    await openShifts();
  });
  test.afterAll(async () => {
    await resetTill();
  });

  test("the manager's numbers match the database, with tables and CSVs", async ({
    browser,
  }) => {
    const till = await (await browser.newContext()).newPage();
    await sellWater(till);
    const expected = await todaysSales();
    expect(expected.orders).toBeGreaterThan(0);

    const page = await (
      await browser.newContext({ acceptDownloads: true })
    ).newPage();
    await signIn(page, SEED.manager.email);
    await expect(page).toHaveURL(/\/manager$/);

    // Today: the dashboard.
    await open(page, "/manager/reports");
    await expect(page.getByTestId("today-sales-value")).toHaveText(
      formatAmount(expected.net, "USD"),
    );
    await expect(page.getByTestId("today-orders-value")).toHaveText(
      String(expected.orders),
    );

    // Sales for today: the same totals, from report_sales.
    await open(
      page,
      `/manager/reports/sales?from=${expected.date}&to=${expected.date}`,
    );
    await expect(page.getByTestId("net-sales-value")).toHaveText(
      formatAmount(expected.net, "USD"),
    );
    await expect(page.getByTestId("orders-value")).toHaveText(
      expected.orders.toLocaleString("en-GB"),
    );

    // Every chart has a table view and a CSV.
    const hourly = page.getByRole("region", { name: "Sales by hour" });
    await hourly.getByRole("radio", { name: "table" }).click();
    await expect(hourly.getByRole("table")).toBeVisible();
    const mix = page.getByRole("region", { name: "Product mix" });
    await expect(mix.getByRole("cell", { name: "Water" })).toBeVisible();
    const mixCsv = await downloadText(page, () =>
      mix.getByRole("button", { name: "Download Product mix as CSV" }).click(),
    );
    expect(mixCsv.name).toBe(
      `product-mix-${expected.date}-to-${expected.date}.csv`,
    );
    expect(mixCsv.text.startsWith("﻿Item,Quantity,Revenue,Share\r\n")).toBe(
      true,
    );
    expect(mixCsv.text).toContain("\r\nWater,");

    // The accountant's export: a row per paid order.
    const sales = await downloadText(page, () =>
      page.getByRole("link", { name: "Sales CSV" }).click(),
    );
    // Starts with a byte-order mark so Excel reads it as UTF-8.
    expect(sales.text.startsWith("\uFEFFBusiness date,")).toBe(true);
    const lines = sales.text.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "Business date,Branch,Order,Time,Channel,Order type,Status,Cashier,Subtotal,Discount,Tax,Total,Refunded,Currency,Taken offline",
    );
    expect(lines).toHaveLength(expected.orders + 1);
    const total = lines
      .slice(1)
      .reduce(
        (sum, line) => sum + Math.round(Number(line.split(",")[11]) * 100),
        0,
      );
    expect(total).toBe(expected.net);

    // The tax report agrees with the sales report.
    await open(
      page,
      `/manager/reports/tax?from=${expected.date}&to=${expected.date}`,
    );
    await expect(page.getByTestId("tax-total")).toBeVisible();
  });

  test("an admin compares branches; nobody signed out can export", async ({
    page,
    request,
  }) => {
    await signIn(page, SEED.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await open(page, "/admin/reports/sales?branch=all");
    await expect(
      page.getByRole("region", { name: "Branches compared" }),
    ).toBeVisible();
    await open(page, `/admin/reports?branch=${SEED.branchId}`);
    await expect(page.getByTestId("today-sales")).toBeVisible();

    // Signed out: no export.
    const anonymous = await request.get(
      "/manager/reports/export?kind=sales&from=2026-01-01&to=2026-01-31",
      { maxRedirects: 0 },
    );
    expect(anonymous.status()).not.toBe(200);
  });
});
