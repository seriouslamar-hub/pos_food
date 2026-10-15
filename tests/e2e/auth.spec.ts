import { expect, test } from "@playwright/test";
import { SEED, setUpTill, signIn } from "./helpers";

test.describe("back-office sign-in", () => {
  test("an admin lands on /admin", async ({ page }) => {
    await signIn(page, SEED.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: `Welcome, ${SEED.admin.name}` }),
    ).toBeVisible();
  });

  test("a manager lands on /manager and is kept out of /admin", async ({
    page,
  }) => {
    await signIn(page, SEED.manager.email);
    await expect(page).toHaveURL(/\/manager$/);
    await expect(
      page.getByRole("heading", { name: `Welcome, ${SEED.manager.name}` }),
    ).toBeVisible();

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/manager$/);
  });

  test("a wrong password shows an error", async ({ page }) => {
    await signIn(page, SEED.manager.email, "not-the-password");
    await expect(
      page.getByText("That email and password don't match"),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("signing out returns to the login page", async ({ page }) => {
    await signIn(page, SEED.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  });

  test("an expired session is sent to sign in with a message", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "sb-127-auth-token",
        value: "expired-or-broken",
        url: "http://localhost:3100",
      },
    ]);
    await page.goto("/manager");
    await expect(page).toHaveURL(/\/login\?.*reason=expired/);
    await expect(page.getByText("Your session expired")).toBeVisible();
  });

  test("signed-out visitors can't open the back office", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/manager");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a till cannot reach the back office", async ({ page }) => {
    await setUpTill(page);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/till$/);
    await page.goto("/manager");
    await expect(page).toHaveURL(/\/till$/);
  });
});
