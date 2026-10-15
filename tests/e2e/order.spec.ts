import { expect, test } from "@playwright/test";
import { enterPin, localAdmin, resetTill, SEED, setUpTill } from "./helpers";

test.describe("till order screen", () => {
  test.beforeEach(async ({ page }) => {
    await resetTill();
    await setUpTill(page);
    await enterPin(page, SEED.cashier.pin);
    await expect(page.getByTestId("till-staff-name")).toHaveText(
      SEED.cashier.name,
    );
  });

  test.afterAll(async () => {
    await resetTill();
  });

  test("a 2-piece meal with a swapped side and upsized drink, in under 15 seconds", async ({
    page,
  }) => {
    const started = Date.now();

    await page.getByRole("tab", { name: "Meals" }).click();
    await page.getByRole("button", { name: /^2-piece meal,/ }).click();
    const sheet = page.getByRole("dialog", { name: "2-piece meal" });
    await sheet.getByRole("button", { name: "Next: Side" }).click();
    await sheet.getByRole("button", { name: /^Coleslaw/ }).click();
    // Coleslaw has no options, so the sheet moves on to the drink.
    await sheet
      .getByRole("region", { name: "Coke: Drink size" })
      .getByRole("button", { name: /^Large/ })
      .click();
    await sheet.getByRole("button", { name: /^Add to order/ }).click();

    const line = page.getByTestId("cart-line");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText("1 × 2-piece meal");
    await expect(line).toContainText(
      "2-piece chicken (Original), Coleslaw, Coke (Large)",
    );
    expect(Date.now() - started).toBeLessThan(15_000);

    // 60.00 + 3.00 for the large drink, plus 10% sales tax (seed data).
    await expect(page.getByTestId("cart-total")).toHaveText("$69.30");
    await page.getByRole("button", { name: "Charge $69.30" }).click();

    const payment = page.getByRole("dialog", { name: "Take payment" });
    await expect(payment.getByTestId("payment-total")).toHaveText("$69.30");
    await payment.getByRole("button", { name: "Exact $69.30" }).click();

    const done = page.getByRole("dialog", { name: "Sale complete" });
    await expect(done).toBeVisible();
    await expect(done.getByTestId("change-due")).toHaveCount(0);
    await expect(page.getByTestId("cart-line")).toHaveCount(0);

    const number = await done.getByTestId("order-number").textContent();
    const db = localAdmin();
    const { data: order } = await db
      .from("orders")
      .select("id, total, subtotal, tax_total, status")
      .eq("branch_id", SEED.branchId)
      .eq("order_number", number!)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(order).toMatchObject({
      subtotal: 6300,
      tax_total: 630,
      total: 6930,
      status: "paid",
    });
    const { data: lines } = await db
      .from("order_items")
      .select("name_snapshot, combo_slot_name, unit_price, status")
      .eq("order_id", order!.id)
      .order("sort_order");
    expect(lines).toEqual([
      {
        name_snapshot: "2-piece meal",
        combo_slot_name: null,
        unit_price: 6300,
        status: "sent",
      },
      {
        name_snapshot: "2-piece chicken",
        combo_slot_name: "Chicken",
        unit_price: 0,
        status: "sent",
      },
      {
        name_snapshot: "Coleslaw",
        combo_slot_name: "Side",
        unit_price: 0,
        status: "sent",
      },
      {
        name_snapshot: "Coke",
        combo_slot_name: "Drink",
        unit_price: 0,
        status: "sent",
      },
    ]);
  });

  test("lines can be edited, merged and removed", async ({ page }) => {
    await page.getByRole("tab", { name: "Drinks" }).click();
    await page.getByRole("button", { name: /^Water,/ }).click();
    await page.getByRole("button", { name: /^Water,/ }).click();
    const line = page.getByTestId("cart-line");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText("2 × Water");

    // Edit: add a note, which makes it a different line from a plain water.
    await line.getByRole("button", { name: /2 × Water/ }).click();
    const sheet = page.getByRole("dialog", { name: "Water" });
    await sheet
      .getByRole("textbox", { name: "Notes for the kitchen" })
      .fill("no ice");
    await sheet.getByRole("button", { name: /^Update/ }).click();
    await expect(line).toContainText("“no ice”");

    await page.getByRole("button", { name: "One less Water" }).click();
    await page.getByRole("button", { name: "One less Water" }).click();
    await expect(page.getByTestId("cart-line")).toHaveCount(0);
  });

  test("an order can be held and recalled", async ({ page }) => {
    await page.getByRole("tab", { name: "Sides" }).click();
    await page.getByRole("button", { name: /^Fries,/ }).click();
    await page
      .getByRole("dialog", { name: "Fries" })
      .getByRole("button", { name: /^Add to order/ })
      .click();
    await expect(page.getByTestId("cart-line")).toHaveCount(1);

    await page.getByRole("button", { name: "Hold", exact: true }).click();
    const hold = page.getByRole("dialog", { name: "Hold this order" });
    await hold.getByRole("textbox", { name: "Label" }).fill("Blue shirt");
    await hold.getByRole("button", { name: "Hold order" }).click();
    await expect(page.getByTestId("cart-line")).toHaveCount(0);

    await page.getByRole("button", { name: "Recall (1)" }).click();
    await page
      .getByRole("dialog", { name: "Held orders" })
      .getByRole("button", { name: /^Blue shirt/ })
      .click();
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
    await expect(page.getByTestId("cart-line")).toContainText("1 × Fries");
    await expect(
      page.getByRole("button", { name: "Recall", exact: true }),
    ).toBeVisible();
  });

  test("delivery orders need the customer's details", async ({ page }) => {
    await page.getByRole("tab", { name: "Drinks" }).click();
    await page.getByRole("button", { name: /^Water,/ }).click();
    await page.getByRole("radio", { name: "Delivery" }).click();
    const charge = page.getByRole("button", { name: /^Charge/ });
    await expect(charge).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Customer phone" })
      .fill("0244000000");
    await page
      .getByRole("textbox", { name: "Delivery address" })
      .fill("12 Ring Road");
    await expect(charge).toBeEnabled();
    await charge.click();
    await page
      .getByRole("dialog", { name: "Take payment" })
      .getByRole("button", { name: /^Exact/ })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Sale complete" }),
    ).toBeVisible();
  });
});
