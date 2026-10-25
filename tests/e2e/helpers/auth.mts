import { expect, type Page } from "@playwright/test";
import { demoPassword } from "./env.mts";

/**
 * Signs in through the real login form (password tab) and waits until the app has
 * left /login. Staff land on /dashboard, client users on /portal.
 */
export async function loginWithPassword(page: Page, email: string, password = demoPassword, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  // "/" redirects by role; wait for the final page
  await page.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 });
  await expect(page.locator("main").first()).toBeVisible();
}

/** Expected landing path for a role after sign-in. */
export const homeFor = (email: string) => (/@demo\.client\.test$|client/i.test(email) ? "/portal" : "/dashboard");
