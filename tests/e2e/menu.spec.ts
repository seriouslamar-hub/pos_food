import { expect, test } from "@playwright/test";
import {
  enterPin,
  localAdmin,
  open,
  resetTill,
  SEED,
  setUpTill,
  signIn,
} from "./helpers";

const RUN = Date.now().toString(36);

test.describe("menu", () => {
  test("an admin builds a new item and combo through the menu pages", async ({
    page,
  }) => {
    await signIn(page, SEED.admin.email);
    await expect(page).toHaveURL(/\/admin$/);

    // A category.
    await open(page, "/admin/menu/categories/new");
    await page.getByLabel("Name").fill(`E2E ${RUN}`);
    await page.getByRole("button", { name: "Colour #2563EB" }).click();
    await page.getByRole("button", { name: "Create category" }).click();
    await expect(page).toHaveURL(
      /\/admin\/menu\?category=.+&notice=category-saved/,
    );

    // An item in it, with a modifier group and a branch price.
    await page.getByRole("link", { name: "New item" }).click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(`E2E Burger ${RUN}`);
    await page.getByRole("textbox", { name: "Price", exact: true }).fill("25");
    await page
      .getByRole("combobox", { name: "Kitchen station" })
      .selectOption({ label: "Grill" });
    await page.getByRole("button", { name: "Create item" }).click();
    await expect(page).toHaveURL(
      /\/admin\/menu\/items\/[0-9a-f-]{36}\?notice=created/,
    );
    const burgerUrl = page.url();

    await page.getByRole("checkbox", { name: /^Extras/ }).click();
    await page.getByRole("button", { name: "Save modifier groups" }).click();
    await expect(page.getByText("Modifier groups saved.")).toBeVisible();

    const mainRow = page.getByRole("row", { name: /Main branch/ });
    await mainRow
      .getByRole("textbox", { name: "Price at Main branch" })
      .fill("27.50");
    await mainRow.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("effective-price-Main branch")).toContainText(
      "$27.50",
    );

    // A combo using it.
    await open(page, "/admin/menu");
    await page.getByRole("link", { name: `E2E ${RUN}` }).click();
    await page.getByRole("link", { name: "New combo" }).click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(`E2E Meal ${RUN}`);
    await page.getByRole("textbox", { name: "Combo price" }).fill("30");
    await page.getByRole("button", { name: "Create combo" }).click();
    await expect(page).toHaveURL(/notice=created/);

    await page.getByRole("textbox", { name: "New slot name" }).fill("Main");
    await page.getByRole("button", { name: "Add slot" }).click();
    const main = page.getByTestId("combo-slot-Main");
    await expect(main).toBeVisible();
    await main
      .getByRole("combobox", { name: "Add a choice" })
      .selectOption({ label: `E2E Burger ${RUN}` });
    await main.getByRole("button", { name: "Add", exact: true }).click();
    await main.getByRole("button", { name: "Save choices" }).click();
    await expect(main.getByText("Choices saved.")).toBeVisible();

    await page.getByRole("textbox", { name: "New slot name" }).fill("Drink");
    await page.getByRole("button", { name: "Add slot" }).click();
    const drink = page.getByTestId("combo-slot-Drink");
    await drink
      .getByRole("combobox", { name: "Add a choice" })
      .selectOption({ label: "Coke" });
    await drink.getByRole("button", { name: "Add", exact: true }).click();
    await drink
      .getByRole("combobox", { name: "Add a choice" })
      .selectOption({ label: "Fanta" });
    await drink.getByRole("button", { name: "Add", exact: true }).click();
    await drink
      .getByRole("textbox", { name: "Upcharge for Fanta" })
      .fill("1.50");
    await drink.getByRole("button", { name: "Save choices" }).click();
    await expect(drink.getByText("Choices saved.")).toBeVisible();

    await page.reload();
    const preview = page.getByTestId("till-preview");
    await expect(preview.getByText("Step 1: Main")).toBeVisible();
    await expect(preview.getByText("Step 2: Drink")).toBeVisible();
    await expect(preview.getByText("Fanta +$1.50")).toBeVisible();

    // The database has what the pages showed.
    const db = localAdmin();
    const burgerId = burgerUrl.match(/items\/([0-9a-f-]{36})/)![1];
    const { data: price } = await db
      .from("branch_menu_items")
      .select("price_override")
      .eq("branch_id", SEED.branchId)
      .eq("menu_item_id", burgerId)
      .single();
    expect(price?.price_override).toBe(2750);

    // And the changes are audited.
    await open(page, "/admin/audit?entity=menu_items");
    await expect(
      page
        .getByTestId("audit-row")
        .filter({ hasText: "Menu item added" })
        .first(),
    ).toBeVisible();
  });

  test.describe("availability", () => {
    test.afterEach(async () => {
      await localAdmin()
        .from("branch_menu_items")
        .update({ is_available: true })
        .eq("branch_id", SEED.branchId);
      await resetTill();
    });

    test("marking an item out of stock updates an open till within seconds", async ({
      page,
      browser,
    }) => {
      // The till is open on the Chicken tab.
      await resetTill();
      await setUpTill(page);
      await enterPin(page, SEED.cashier.pin);
      await page.getByRole("tab", { name: "Chicken" }).click();
      const chicken = page.getByRole("button", { name: /^2-piece chicken,/ });
      await expect(chicken).toHaveAttribute("data-available", "true");

      // A manager marks it out of stock.
      const managerContext = await browser.newContext();
      const manager = await managerContext.newPage();
      await signIn(manager, SEED.manager.email);
      await expect(manager).toHaveURL(/\/manager$/);
      await open(manager, "/manager/availability");
      await manager
        .getByRole("switch", { name: "2-piece chicken in stock" })
        .click();
      await expect(manager.getByTestId("out-of-stock-count")).toHaveText(
        "1 out of stock.",
      );

      // The till greys it out without a reload, and the meal built on it too.
      await expect(chicken).toHaveAttribute("data-available", "false", {
        timeout: 5_000,
      });
      await page.getByRole("tab", { name: "Meals" }).click();
      await expect(
        page.getByRole("button", { name: /^2-piece meal,/ }),
      ).toHaveAttribute("data-available", "false");

      // Back in stock.
      await manager
        .getByRole("switch", { name: "2-piece chicken in stock" })
        .click();
      await expect(
        page.getByRole("button", { name: /^2-piece meal,/ }),
      ).toHaveAttribute("data-available", "true", {
        timeout: 5_000,
      });
      await managerContext.close();
    });
  });
});
