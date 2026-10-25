import { expect, test, type Page } from "@playwright/test";
import { loginWithPassword } from "../helpers/auth.mts";
import { mainEngagement } from "../helpers/data.mts";
import { seedYear, users } from "../helpers/env.mts";

test.describe("engagements (team)", () => {
  test("engagement list groups by client and opens an engagement", async ({ page }) => {
    const eng = await mainEngagement();
    await loginWithPassword(page, users.manager);
    await page.goto("/engagements");
    await expect(page.getByRole("heading", { level: 1, name: "Engagements" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Adebayo Foods Plc \d+ engagements?/ })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(`Adebayo Foods Plc — .*FY${seedYear} \\(${eng.code}\\)`) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/engagements/${eng.id}`));
    await expect(page.getByRole("heading", { level: 1, name: eng.name })).toBeVisible();
  });

  test("every engagement tab renders", async ({ page }) => {
    const eng = await mainEngagement();
    await loginWithPassword(page, users.lead);
    await page.goto(`/engagements/${eng.id}`);
    const nav = page.getByRole("navigation", { name: "Engagement sections" });
    // tab label -> something that only that tab shows
    const tabs: [string, (p: Page) => Promise<void>][] = [
      ["Requests", async (p) => expect(p.getByRole("textbox", { name: "Search items" })).toBeVisible()],
      ["Dashboard", async (p) => expect(p.getByText(/critical/i).first()).toBeVisible()],
      ["Additional documents", async (p) => expect(p.getByText(`Engagement letter FY${seedYear}.pdf`).first()).toBeVisible()],
      ["Calendar", async (p) => expect(p.getByText("Audit planning meeting with the CFO").first()).toBeVisible()],
      ["Team", async (p) => expect(p.getByText("Ngozi Eze").first()).toBeVisible()],
      ["Attachments", async (p) => expect(p.getByText("Download all as ZIP")).toBeVisible()],
      ["Settings", async (p) => expect(p.getByText(/storage folder/)).toBeVisible()],
    ];
    for (const [label, check] of tabs) {
      await test.step(label, async () => {
        await nav.getByRole("link", { name: label, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`tab=${label === "Additional documents" ? "documents" : label.toLowerCase()}`));
        await check(page);
        await expect(page.getByText(/Something went wrong|Application error|couldn.t find that page/)).toHaveCount(0);
      });
    }
  });
});
