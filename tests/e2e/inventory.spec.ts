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

async function ingredient(name: string) {
  const { data, error } = await localAdmin()
    .from("ingredients")
    .select("id")
    .eq("name", name)
    .single();
  if (error) throw error;
  return data.id;
}

async function onHand(ingredientId: string) {
  const { data } = await localAdmin()
    .from("branch_stock")
    .select("quantity_on_hand")
    .eq("branch_id", SEED.branchId)
    .eq("ingredient_id", ingredientId)
    .maybeSingle();
  return Number(data?.quantity_on_hand ?? 0);
}

async function setOnHand(ingredientId: string, quantity: number) {
  const { error } = await localAdmin().from("branch_stock").upsert(
    {
      branch_id: SEED.branchId,
      ingredient_id: ingredientId,
      quantity_on_hand: quantity,
    },
    { onConflict: "branch_id,ingredient_id" },
  );
  if (error) throw error;
}

/** Fills the first line of a stock line editor. */
async function fillLine(
  scope: Page | ReturnType<Page["getByRole"]>,
  name: string,
  quantity: string,
) {
  const line = scope.getByTestId("stock-line").last();
  await line.getByLabel("Ingredient").selectOption({ label: name });
  await line.getByLabel(/^Quantity/).fill(quantity);
}

test.describe("inventory", () => {
  test.beforeEach(async () => {
    await resetTill();
    await openShifts();
  });
  test.afterAll(async () => {
    await resetTill();
  });

  test("a sale takes its recipe out of stock", async ({ page }) => {
    const water = await ingredient("Water bottle");
    await setOnHand(water, 48);

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

    await expect.poll(() => onHand(water)).toBe(47);
  });

  test("a manager records waste, receives a delivery, counts and sees low stock", async ({
    page,
  }) => {
    const water = await ingredient("Water bottle");
    await setOnHand(water, 30);

    await signIn(page, SEED.manager.email);
    await expect(page).toHaveURL(/\/manager$/);
    await open(page, "/manager/inventory");
    const row = page
      .getByTestId("stock-row")
      .filter({ hasText: "Water bottle" });
    await expect(row).toContainText("30");

    // Waste: two bottles dropped.
    await page.getByRole("button", { name: "Record waste" }).click();
    const waste = page.getByRole("dialog", { name: "Record waste" });
    await fillLine(waste, "Water bottle", "2");
    await waste.getByLabel("Reason").selectOption("Dropped");
    await waste.getByRole("button", { name: "Record waste" }).click();
    await expect(waste).toBeHidden();
    await expect.poll(() => onHand(water)).toBe(28);

    // Order 24, 20 arrive at a new price.
    await open(page, "/manager/inventory/orders/new");
    await page.getByLabel("Supplier").selectOption({
      label: "Packaging & Drinks Co",
    });
    await fillLine(page, "Water bottle", "24");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByTestId("po-status")).toHaveText("Draft");
    await page.getByRole("button", { name: "Mark as sent" }).click();
    await expect(page.getByTestId("po-status")).toHaveText("Sent");
    await page.getByRole("button", { name: "Receive delivery" }).click();
    const receive = page.getByRole("dialog", { name: "Receive delivery" });
    await receive.getByLabel(/^Arrived/).fill("20");
    await receive.getByLabel("Cost each").fill("1.60");
    await receive.getByRole("button", { name: "Receive into stock" }).click();
    await expect(page.getByTestId("po-status")).toHaveText("Received");
    await expect.poll(() => onHand(water)).toBe(48);
    const { data: cost } = await localAdmin()
      .from("ingredients")
      .select("cost_per_unit")
      .eq("id", water)
      .single();
    expect(cost?.cost_per_unit).toBe(160);

    // The shelf has 3 fewer than the system thinks; approve the count.
    await open(page, "/manager/inventory/counts");
    await page.getByLabel("Counted Water bottle (pc)").fill("45");
    await page.getByRole("button", { name: "Save count" }).click();
    const card = page.getByTestId("count-card").first();
    await expect(card).toContainText("Waiting for approval");
    await expect(card).toContainText("Water bottle: expected 48");
    await card
      .getByRole("button", { name: "Approve and adjust stock" })
      .click();
    await expect(card).toContainText("Approved");
    await expect.poll(() => onHand(water)).toBe(45);

    // Below the reorder level (24): the alert names it.
    await setOnHand(water, 10);
    await open(page, "/manager");
    await expect(page.getByTestId("low-stock-alert")).toContainText(
      "Water bottle",
    );

    // The usage report shows the waste and the count difference.
    await open(page, "/manager/inventory/reports");
    const usage = page
      .getByTestId("usage-row")
      .filter({ hasText: "Water bottle" });
    await expect(usage).toBeVisible();
    await expect(page.getByText(/^Dropped:/)).toBeVisible();

    // Every step is in the audit log.
    const { data: audit } = await localAdmin()
      .from("audit_log")
      .select("action")
      .eq("branch_id", SEED.branchId)
      .in("action", [
        "stock.waste",
        "purchase_order.received",
        "stock.count_approved",
      ]);
    expect(new Set(audit?.map((a) => a.action)).size).toBe(3);

    await setOnHand(water, 48);
  });

  test("an admin sees ingredients, recipes and each branch's stock", async ({
    page,
  }) => {
    await signIn(page, SEED.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await open(page, "/admin/ingredients");
    await expect(page.getByText("Chicken piece").first()).toBeVisible();
    await open(page, "/admin/recipes");
    await expect(page.getByText("2-piece chicken").first()).toBeVisible();
    await open(page, `/admin/stock?branch=${SEED.branchId}`);
    await expect(
      page.getByTestId("stock-row").filter({ hasText: "Meal box" }),
    ).toBeVisible();
    await open(page, `/admin/stock/reports?branch=${SEED.branchId}`);
    await expect(
      page.getByRole("heading", { name: "Theoretical vs actual usage" }),
    ).toBeVisible();
  });
});
