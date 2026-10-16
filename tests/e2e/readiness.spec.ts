import { expect, test } from "@playwright/test";
import { SEED, signIn } from "./helpers";

test("the admin home lists what's left before opening, with links", async ({
  page,
}) => {
  await signIn(page, SEED.admin.email);
  await expect(page).toHaveURL(/\/admin$/);
  const ready = page.getByTestId("readiness");
  await expect(ready).toBeVisible();
  await expect(ready).toContainText(/\d+ of 10 done/);
  // The seeded branch has a menu, taxes, payment methods and staff with PINs.
  await expect(
    ready.getByRole("link", { name: /Your menu and prices/ }),
  ).toHaveAttribute("data-done", "true");
  await expect(
    ready.getByRole("link", { name: /Cashiers with PINs/ }),
  ).toHaveAttribute("data-done", "true");
  await expect(ready.getByRole("link", { name: /Tax rates/ })).toHaveAttribute(
    "href",
    "/admin/taxes",
  );
});
