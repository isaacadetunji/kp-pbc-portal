import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { loginWithPassword } from "../helpers/auth.mts";
import { item, items, mainEngagement, type ItemRow } from "../helpers/data.mts";
import { users } from "../helpers/env.mts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "..", "fixtures", "group-structure.pdf");

// Client uploads + submits, then the team accepts the same item: run in order.
test.describe.serial("request workflow: client submits, team accepts", () => {
  let target: ItemRow;
  let engagementId: string;

  test.beforeAll(async () => {
    const eng = await mainEngagement();
    engagementId = eng.id;
    // Any open, non-critical request works; picking it from the DB keeps the spec re-runnable without a reset.
    const open = await items(eng.id, "&status=eq.requested&is_critical=eq.false");
    if (!open.length) throw new Error("no open non-critical request left; reset the DB (tests/e2e/reset-db.sh)");
    target = open[0]!;
  });

  test("client sees the portal and the engagement, uploads to a request and submits", async ({ page }) => {
    await loginWithPassword(page, users.clientFc);
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole("heading", { level: 1, name: /Welcome, Tunde/ })).toBeVisible();
    await page.getByRole("link", { name: /Adebayo Foods Plc — Statutory audit — FY\d{4}/ }).filter({ hasNotText: "Request in progress" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/portal/${engagementId}`));
    await expect(page.getByRole("heading", { level: 1, name: "Adebayo Foods Plc" })).toBeVisible();

    await page.getByRole("textbox", { name: "Search requests" }).fill(target.title);
    await page.getByRole("button", { name: new RegExp(`^${reEscape(target.title)}`) }).first().click();
    const sheet = page.getByRole("dialog", { name: target.title });
    await expect(sheet).toBeVisible();
    await sheet.locator('input[type="file"]').setInputFiles(fixture);
    await expect(sheet.getByText("Ready to submit (1)")).toBeVisible({ timeout: 30_000 });
    await sheet.getByRole("button", { name: "Submit to engagement team" }).click();
    await expect(page.getByText("Submitted to the engagement team. Thank you!")).toBeVisible();
    await expect.poll(async () => (await item(target.id)).status).toBe("submitted");
  });

  test("team member accepts the submission", async ({ page }) => {
    await loginWithPassword(page, users.manager);
    await page.goto(`/engagements/${engagementId}?tab=requests&item=${target.id}`);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: target.title })).toBeVisible();
    await expect(sheet.getByText("group-structure.pdf").first()).toBeVisible();
    await sheet.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText("Item accepted")).toBeVisible();
    await expect.poll(async () => (await item(target.id)).status).toBe("accepted");
  });
});

function reEscape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
