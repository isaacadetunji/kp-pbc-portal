import { expect, test } from "@playwright/test";
import { loginWithPassword } from "../helpers/auth.mts";
import { users } from "../helpers/env.mts";

test.describe("admin (super admin)", () => {
  const pages: [string, string][] = [
    ["/admin/users", "Users & access"],
    ["/admin/clients", "Clients"],
    ["/admin/checklist", "Master checklist"],
    ["/admin/settings", "Settings"],
  ];

  test("admin pages render", async ({ page }) => {
    await loginWithPassword(page, users.superAdmin);
    for (const [path, heading] of pages) {
      await test.step(path, async () => {
        const res = await page.goto(path);
        expect(res?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
        await expect(page.getByText(/Something went wrong|couldn.t find that page/)).toHaveCount(0);
      });
    }
    await page.goto("/admin/users");
    await expect(page.getByText(users.lead).first()).toBeVisible();
    await page.goto("/admin/clients");
    await expect(page.getByText("Adebayo Foods Plc").first()).toBeVisible();
  });

  test("client users cannot open admin pages", async ({ page }) => {
    await loginWithPassword(page, users.clientFc);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { level: 1, name: "Users & access" })).toHaveCount(0);
  });
});
