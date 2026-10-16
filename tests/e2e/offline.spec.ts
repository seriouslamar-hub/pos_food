import { expect, type Page, test } from "@playwright/test";
import {
  capturePrints,
  enterPin,
  localAdmin,
  openShifts,
  prints,
  resetTill,
  SEED,
  setUpTill,
} from "./helpers";

/** Sets up the till and signs in online once, so it keeps PINs and the menu. */
async function openTillOnline(page: Page) {
  await openShifts();
  await capturePrints(page);
  const bundle = page.waitForResponse(/rpc\/get_offline_bundle/);
  await setUpTill(page);
  await bundle;
  await enterPin(page, SEED.cashier.pin);
  await expect(page.getByRole("tab", { name: "Drinks" })).toBeVisible();
}

/** Sells one water for exact cash; returns the order number. */
async function sellWater(page: Page) {
  await page.getByRole("tab", { name: "Drinks" }).click();
  await page.getByRole("button", { name: /^Water,/ }).click();
  await page.getByRole("button", { name: "Charge $5.50" }).click();
  await page
    .getByRole("dialog", { name: "Take payment" })
    .getByRole("button", { name: "Exact $5.50" })
    .click();
  const done = page.getByRole("dialog", { name: "Sale complete" });
  const number = (await done.getByTestId("order-number").textContent())!;
  await done.getByRole("button", { name: "New order" }).click();
  return number;
}

async function savedOrders(numbers: string[]) {
  const { data } = await localAdmin()
    .from("orders")
    .select("order_number, status, is_offline, total, payments(amount)")
    .eq("branch_id", SEED.branchId)
    .in("order_number", numbers)
    .order("order_number");
  return data ?? [];
}

test.describe("offline mode", () => {
  test.beforeEach(async () => {
    await resetTill();
  });
  test.afterAll(async () => {
    await resetTill();
  });

  test("five sales offline reach the server once when the connection is back", async ({
    page,
  }) => {
    await openTillOnline(page);
    await page.context().setOffline(true);
    await expect(page.getByTestId("sync-badge")).toHaveText(/^Offline/);

    const numbers: string[] = [];
    for (let i = 0; i < 5; i++) numbers.push(await sellWater(page));
    expect(numbers.every((n) => /^T1-\d{3}$/.test(n))).toBe(true);
    expect(new Set(numbers).size).toBe(5);
    // Each order and its payment wait to be sent.
    await expect(page.getByTestId("sync-badge")).toHaveText(
      "Offline · 10 to send",
    );
    // The kitchen screen can't get them, so kitchen tickets print.
    await expect
      .poll(
        async () =>
          (await prints(page)).filter((p) => p.kinds.includes("kitchen-ticket"))
            .length,
      )
      .toBe(5);

    // Closing the shift waits until everything is sent.
    await page.getByRole("button", { name: "Cash", exact: true }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Cash" })
        .getByRole("button", { name: "Close my shift" }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");

    await page.context().setOffline(false);
    await expect(page.getByTestId("sync-badge")).toHaveCount(0, {
      timeout: 30_000,
    });

    const orders = await savedOrders(numbers);
    expect(orders).toHaveLength(5);
    for (const order of orders) {
      expect(order).toMatchObject({
        status: "paid",
        is_offline: true,
        total: 550,
      });
      expect(order.payments).toEqual([{ amount: 550 }]);
    }
  });

  test("an offline sign-in, and a connection lost mid-sync, never duplicate", async ({
    page,
  }) => {
    await openTillOnline(page);
    await page.getByRole("button", { name: "Switch user" }).click();

    // Signed in with the PIN checked on the till.
    await page.context().setOffline(true);
    await enterPin(page, SEED.cashier.pin);
    await expect(page.getByTestId("till-staff-name")).toHaveText(
      SEED.cashier.name,
    );
    const numbers = [await sellWater(page), await sellWater(page)];

    // The first answer from each RPC gets lost on the way back, after the
    // server has saved it; the till sends it again.
    const lost = new Set<string>();
    await page.route(/rpc\/(submit_order|record_payments)/, async (route) => {
      const fn = route.request().url().split("/").pop()!;
      if (!lost.has(fn)) {
        lost.add(fn);
        await route.fetch();
        await route.abort("internetdisconnected");
        return;
      }
      await route.continue();
    });
    await page.context().setOffline(false);
    await expect(page.getByTestId("sync-badge")).toHaveCount(0, {
      timeout: 60_000,
    });
    expect([...lost].sort()).toEqual(["record_payments", "submit_order"]);

    const orders = await savedOrders(numbers);
    expect(orders).toHaveLength(2);
    for (const order of orders)
      expect(order.payments).toEqual([{ amount: 550 }]);
    const { count } = await localAdmin()
      .from("pos_sessions")
      .select("id", { count: "exact", head: true })
      .eq("device_id", SEED.tillDeviceId)
      .eq("is_offline", true)
      .gte("started_at", new Date(Date.now() - 5 * 60_000).toISOString());
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
