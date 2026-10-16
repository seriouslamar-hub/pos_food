import { expect, type Page, test } from "@playwright/test";
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

const RUN = Date.now().toString(36).toUpperCase();

async function promotionsOff() {
  await localAdmin()
    .from("promotions")
    .update({ is_active: false })
    .like("name", "E2E %");
}

async function ringWater(page: Page) {
  await page.getByRole("tab", { name: "Drinks" }).click();
  await page.getByRole("button", { name: /^Water,/ }).click();
}

async function payExact(page: Page) {
  await page.getByRole("button", { name: /^Charge / }).click();
  await page
    .getByRole("dialog", { name: "Take payment" })
    .getByRole("button", { name: /^Exact / })
    .click();
  const done = page.getByRole("dialog", { name: "Sale complete" });
  await expect(done).toBeVisible();
  return done;
}

test.describe("promotions and loyalty", () => {
  test.beforeEach(async () => {
    await resetTill();
    await openShifts();
    await promotionsOff();
  });
  test.afterAll(async () => {
    await promotionsOff();
    await resetTill();
  });

  test("an admin's promotion applies on the till and is worked out again by the server", async ({
    browser,
  }) => {
    const admin = await (await browser.newContext()).newPage();
    await signIn(admin, SEED.admin.email);
    await expect(admin).toHaveURL(/\/admin$/);
    await open(admin, "/admin/promotions/new");
    await admin.getByLabel("Name").fill(`E2E Half water ${RUN}`);
    await admin.getByLabel("Percent off").fill("50");
    await admin.getByRole("checkbox", { name: "Water", exact: true }).click();
    await admin
      .getByRole("checkbox", { name: "Takeaway", exact: true })
      .click();
    await admin.getByRole("button", { name: "Add promotion" }).click();
    await expect(admin).toHaveURL(/\/admin\/promotions\?notice=created/);
    await expect(
      admin
        .getByTestId("promotion-row")
        .filter({ hasText: `E2E Half water ${RUN}` }),
    ).toContainText("50% off");

    // The till loads the menu (and its promotions) when it opens.
    const till = await (await browser.newContext()).newPage();
    await setUpTill(till);
    await enterPin(till, SEED.cashier.pin);
    await ringWater(till);
    await expect(till.getByTestId("cart-promotion")).toHaveText(
      new RegExp(`E2E Half water ${RUN}.*−\\$2\\.50`),
    );
    const done = await payExact(till);
    const number = (await done.getByTestId("order-number").textContent())!;

    const { data: order } = await localAdmin()
      .from("orders")
      .select("id, subtotal, promotion_total, total")
      .eq("branch_id", SEED.branchId)
      .eq("order_number", number)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(order).toMatchObject({ subtotal: 500, promotion_total: 250 });
    const { count } = await localAdmin()
      .from("promotion_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("order_id", order!.id);
    expect(count).toBe(1);
  });

  test("a coupon and a new loyalty customer who earns, then spends, points", async ({
    page,
  }) => {
    const code = `E2E${RUN}`.slice(0, 20);
    await localAdmin()
      .from("promotions")
      .insert({
        name: `E2E Coupon ${RUN}`,
        type: "amount_off",
        value: 100,
        coupon_code: code,
        max_uses: 1,
      });
    const phone = `0244${Date.now().toString().slice(-6)}`;

    await setUpTill(page);
    await enterPin(page, SEED.cashier.pin);
    await ringWater(page);

    // A wrong code is refused; the real one is added.
    await page.getByRole("button", { name: "Coupon" }).click();
    const couponDialog = page.getByRole("dialog", { name: "Coupon" });
    await couponDialog.getByLabel("Code").fill("NOT-A-CODE");
    await couponDialog.getByRole("button", { name: "Apply coupon" }).click();
    await expect(couponDialog).toContainText("That coupon isn't valid");
    await couponDialog.getByLabel("Code").fill(code.toLowerCase());
    await couponDialog.getByRole("button", { name: "Apply coupon" }).click();
    await expect(couponDialog).toBeHidden();
    await expect(page.getByTestId("cart-promotion")).toContainText("−$1.00");

    // A new customer, saved only with consent.
    await page.getByTestId("loyalty-button").click();
    const loyalty = page.getByRole("dialog", { name: "Loyalty customer" });
    await loyalty.getByLabel("Phone number").fill(phone);
    await loyalty.getByRole("button", { name: "Find" }).click();
    await expect(loyalty).toContainText("No customer with that number yet.");
    await loyalty.getByLabel("Name (optional)").fill("Esi Test");
    await loyalty.getByRole("button", { name: "Add customer" }).click();
    await expect(loyalty).toContainText("Ask the customer first");
    await loyalty
      .getByRole("checkbox", {
        name: /agrees to us keeping their phone number/,
      })
      .click();
    await loyalty.getByRole("button", { name: "Add customer" }).click();
    await expect(loyalty.getByTestId("customer-points")).toHaveText(
      /^0 points/,
    );
    await loyalty.getByRole("button", { name: "Use this customer" }).click();
    await expect(page.getByTestId("loyalty-button")).toHaveText(
      "Esi Test · 0 pts",
    );

    // Water 5.00 - 1.00 coupon, plus tax: the customer earns a point per 1.00.
    const done = await payExact(page);
    const { data: customer } = await localAdmin()
      .from("customers")
      .select("id, points_balance, consent_at")
      .eq("phone", phone)
      .single();
    expect(customer!.consent_at).not.toBeNull();
    expect(customer!.points_balance).toBeGreaterThan(0);
    const earned = customer!.points_balance;
    await expect(done.getByTestId("receipt-points").first()).toContainText(
      `${earned} points earned`,
    );
    await done.getByRole("button", { name: "New order" }).click();

    // Next visit: find them and spend every point.
    await ringWater(page);
    await page.getByTestId("loyalty-button").click();
    await loyalty.getByLabel("Phone number").fill(phone);
    await loyalty.getByRole("button", { name: "Find" }).click();
    await expect(loyalty.getByTestId("customer-points")).toHaveText(
      new RegExp(`^${earned} points`),
    );
    await loyalty.getByRole("button", { name: "All" }).click();
    await loyalty.getByRole("button", { name: "Use this customer" }).click();
    await expect(page.getByTestId("cart-points")).toContainText(
      `Points (${earned})`,
    );
    // The coupon was used up on the first order: it isn't offered again.
    await expect(page.getByTestId("cart-promotion")).toHaveCount(0);
    await payExact(page);

    await expect
      .poll(async () => {
        const { data } = await localAdmin()
          .from("customers")
          .select("points_balance")
          .eq("id", customer!.id)
          .single();
        return data!.points_balance;
      })
      // Spent them all, then earned on what was paid.
      .toBeLessThan(earned + 6);
    const { data: txns } = await localAdmin()
      .from("loyalty_transactions")
      .select("type, points")
      .eq("customer_id", customer!.id)
      .order("created_at");
    expect(txns!.map((t) => t.type)).toEqual(["earn", "redeem", "earn"]);
    expect(txns![1].points).toBe(-earned);
  });
});
