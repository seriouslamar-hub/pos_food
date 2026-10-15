import { expect, test } from "@playwright/test";
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

// Unique names so the suite can run again without a database reset.
const RUN = Date.now().toString(36);

test.describe("admin back office", () => {
  test("an admin sets up a branch, a manager, a cashier and a till end to end", async ({
    page,
    browser,
  }) => {
    const branchName = `E2E Branch ${RUN}`;
    const managerEmail = `e2e-manager-${RUN}@example.com`;

    // --- Admin creates a branch -------------------------------------------
    await signIn(page, SEED.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await open(page, "/admin/branches/new");
    await page.getByLabel("Name").fill(branchName);
    await page.getByLabel("Timezone").selectOption("Africa/Accra");
    await page.getByLabel("Currency").selectOption("GHS");
    await page.getByRole("button", { name: "Create branch" }).click();
    await expect(page).toHaveURL(/\/admin\/branches\?notice=created/);
    await expect(page.getByRole("link", { name: branchName })).toBeVisible();

    // --- Admin adds a manager and gets a one-time password ------------------
    await open(page, "/admin/staff/new");
    await page.getByLabel("Full name").fill(`E2E Manager ${RUN}`);
    await page.getByLabel("Role").selectOption("manager");
    await page.getByLabel("Branch").selectOption({ label: branchName });
    await page.getByLabel("Email (to sign in)").fill(managerEmail);
    await page.getByLabel("Discount limit (%)").fill("20");
    await page.getByRole("button", { name: "Add staff member" }).click();
    const password = await page
      .getByTestId("credential-password")
      .textContent();
    expect(password).toMatch(/^[A-Za-z0-9_-]{16}$/);

    // --- The manager signs in and adds a cashier with a PIN -----------------
    const managerContext = await browser.newContext();
    const manager = await managerContext.newPage();
    await signIn(manager, managerEmail, password!);
    await expect(manager).toHaveURL(/\/manager$/);
    await open(manager, "/manager/staff/new");
    await manager.getByLabel("Full name").fill(`E2E Cashier ${RUN}`);
    await manager.getByLabel("Discount limit (%)").fill("10");
    await manager.getByLabel("Till PIN").fill("4242");
    await manager.getByRole("button", { name: "Add cashier" }).click();
    await expect(manager).toHaveURL(/\/manager\/staff\?notice=created/);
    await expect(
      manager.getByRole("link", { name: `E2E Cashier ${RUN}` }),
    ).toBeVisible();
    // Only their own branch: the seeded Main branch cashiers aren't listed or reachable.
    await expect(manager.getByText(SEED.cashier.name)).toHaveCount(0);
    await manager.goto("/manager/staff/20000000-0000-4000-8000-000000000003");
    await expect(
      manager.getByText("This page could not be found"),
    ).toBeVisible();

    // A manager can't give more discount than they have (20%).
    await open(manager, "/manager/staff/new");
    await manager.getByLabel("Full name").fill(`Generous ${RUN}`);
    await manager.getByLabel("Discount limit (%)").fill("50");
    await manager.getByRole("button", { name: "Add cashier" }).click();
    await expect(
      manager
        .getByText("Discount limit can't be higher than your own (20%)")
        .first(),
    ).toBeVisible();
    await managerContext.close();

    // --- Admin creates a till and gets a setup code ------------------------
    await open(page, "/admin/devices/new");
    await page.getByLabel("Branch").selectOption({ label: branchName });
    await page.getByLabel("Name").fill(`E2E Till ${RUN}`);
    await expect(page.getByLabel("Short code")).toHaveValue("T1");
    await page.getByRole("button", { name: "Create device" }).click();
    const setupCode = await page.getByTestId("setup-code").textContent();
    expect(setupCode).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

    // --- A fresh tablet uses the code, then the cashier signs in -----------
    const tabletContext = await browser.newContext();
    const tablet = await tabletContext.newPage();
    await open(tablet, "/device/setup");
    await tablet.getByLabel("Setup code").fill(setupCode!.toLowerCase());
    await tablet.getByRole("button", { name: "Set up this device" }).click();
    await expect(tablet).toHaveURL(/\/till$/);
    await expect(
      tablet.getByText(`${branchName} · E2E Till ${RUN} (T1)`),
    ).toBeVisible();
    await enterPin(tablet, "4242");
    await expect(tablet.getByTestId("till-staff-name")).toHaveText(
      `E2E Cashier ${RUN}`,
    );

    // The code worked once and can't be used again.
    const secondTablet = await browser.newPage();
    await open(secondTablet, "/device/setup");
    await secondTablet.getByLabel("Setup code").fill(setupCode!);
    await secondTablet
      .getByRole("button", { name: "Set up this device" })
      .click();
    await expect(secondTablet.getByText("That code isn't valid")).toBeVisible();
    await secondTablet.close();
    await tabletContext.close();

    // --- Everything is in the audit log -------------------------------------
    await open(page, "/admin/audit");
    const log = page.getByTestId("audit-row");
    for (const action of [
      "Branch created",
      "Staff added",
      "PIN set",
      "Device added",
      "Device set up",
      "Till sign-in",
    ]) {
      await expect(log.filter({ hasText: action }).first()).toBeVisible();
    }
    await expect(
      log.filter({ hasText: `name: E2E Cashier ${RUN}` }).first(),
    ).toBeVisible();

    // The device shows as online on the devices page.
    await open(page, "/admin/devices");
    await expect(
      page
        .getByRole("row", { name: new RegExp(`E2E Till ${RUN}`) })
        .getByText("Online"),
    ).toBeVisible();
  });

  test.describe("role permissions", () => {
    test.afterEach(async () => {
      await localAdmin()
        .from("role_permissions")
        .delete()
        .eq("role", "cashier")
        .eq("permission", "drawer.no_sale");
      await resetTill();
    });

    test("granting a permission changes what the till allows", async ({
      page,
      browser,
    }) => {
      await signIn(page, SEED.admin.email);
      await expect(page).toHaveURL(/\/admin$/);
      await open(page, "/admin/permissions");
      const box = page.getByRole("checkbox", {
        name: "Cashier: Open the cash drawer without a sale",
      });
      await expect(box).not.toBeChecked();
      await box.click();
      await expect(box).toBeChecked();
      await expect(box).toBeEnabled();

      const tillContext = await browser.newContext();
      const till = await tillContext.newPage();
      await resetTill();
      await openShifts();
      await setUpTill(till);
      await enterPin(till, SEED.cashier.pin);
      await till.getByRole("button", { name: "Cash", exact: true }).click();
      await till
        .getByRole("dialog", { name: "Cash" })
        .getByRole("button", { name: "No sale" })
        .click();
      const noSale = till.getByRole("dialog", { name: "No sale" });
      await noSale.getByLabel("Reason").fill("Change for a note");
      await noSale.getByRole("button", { name: "Record no sale" }).click();
      await expect(
        till.getByRole("dialog", { name: "Manager approval" }),
      ).toHaveCount(0);
      await expect(till.getByTestId("till-action-result")).toHaveText(
        /^No sale recorded\. The drawer is open\./,
      );
      await tillContext.close();

      await open(page, "/admin/audit?entity=role_permissions");
      await expect(
        page
          .getByTestId("audit-row")
          .filter({ hasText: "Permission granted" })
          .first(),
      ).toBeVisible();
    });
  });

  test("taxes, payment methods and settings can be changed", async ({
    page,
  }) => {
    await signIn(page, SEED.admin.email);
    await expect(page).toHaveURL(/\/admin$/);

    await open(page, "/admin/taxes/new");
    await page.getByLabel("Name").fill(`Levy ${RUN}`);
    await page.getByLabel("Rate (%)").fill("2.5");
    // Its own tax category, so it doesn't change prices in other tests.
    await page.getByLabel("Tax category").fill(`e2e_${RUN}`);
    await page.getByRole("button", { name: "Add tax" }).click();
    await expect(page).toHaveURL(/\/admin\/taxes\?notice=created/);
    await expect(
      page.getByRole("row", { name: new RegExp(`Levy ${RUN}`) }),
    ).toContainText("2.5%");

    await open(page, "/admin/payment-methods");
    await page.getByLabel("Name", { exact: true }).fill(`Voucher ${RUN}`);
    await page.getByLabel("Type").selectOption("other");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Payment method added.")).toBeVisible();
    await expect(page.getByLabel(`Voucher ${RUN} name`)).toBeVisible();

    await open(page, "/admin/settings");
    await page.getByLabel("Kitchen tickets turn red after (minutes)").fill("2");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(
      page.getByText("Must be more than the amber time."),
    ).toBeVisible();
    await page.getByLabel("Kitchen tickets turn red after (minutes)").fill("6");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
  });
});
