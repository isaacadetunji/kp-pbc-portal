import { expect, test } from "@playwright/test";
import { loginWithPassword } from "../helpers/auth.mts";
import { users } from "../helpers/env.mts";
import { extractLink, latestEmail } from "../helpers/mailbox.mts";

test.describe("auth", () => {
  test("staff signs in with a password and lands on the dashboard", async ({ page }) => {
    await loginWithPassword(page, users.lead);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: /Good day, Olumide/ })).toBeVisible();
  });

  test("wrong password is rejected", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(users.lead);
    await page.locator("#password").fill("not-the-password-1A");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("signed-out visitors are sent to /login with a next parameter", async ({ page }) => {
    await page.goto("/engagements");
    await expect(page).toHaveURL(/\/login\?next=%2Fengagements/);
  });

  test("magic link sign-in from the SMTP sink", async ({ page }) => {
    const since = new Date();
    await page.goto("/login");
    await page.getByRole("tab", { name: "Email me a link" }).click();
    await page.locator("#email-link").fill(users.clientCfo);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText(/a sign-in link is on its way/)).toBeVisible();

    const mail = await latestEmail(users.clientCfo, { since, subject: "sign-in link" });
    const link = extractLink(mail);
    expect(link).toContain("type=magiclink");
    await page.goto(link);
    await page.waitForURL(/\/portal/);
    await expect(page.getByRole("heading", { level: 1, name: /Welcome, Chioma/ })).toBeVisible();
  });
});
