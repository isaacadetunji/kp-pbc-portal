import { expect, test } from "@playwright/test";
import { loginWithPassword } from "../helpers/auth.mts";
import { mainEngagement } from "../helpers/data.mts";
import { users } from "../helpers/env.mts";
import { extractLink, latestEmail } from "../helpers/mailbox.mts";

test.describe("client invitations", () => {
  test("team invites a new client contact, who sets a password from the emailed link", async ({ page, browser }) => {
    const eng = await mainEngagement();
    const stamp = Date.now();
    const email = `e2e.contact.${stamp}@demo.client.test`;
    const name = `E2E Contact ${stamp}`;
    const password = `E2e-Pass-${stamp}`;
    const since = new Date();

    await loginWithPassword(page, users.lead);
    await page.goto(`/engagements/${eng.id}?tab=team`);
    await page.getByRole("button", { name: "Invite client user" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite client user" });
    await dialog.locator("#inv-name").fill(name);
    await dialog.locator("#inv-email").fill(email);
    await dialog.locator("#inv-pos").fill("Accountant");
    await dialog.getByRole("button", { name: "Grant access & send email" }).click();
    await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible();
    await expect(page.getByText(email).first()).toBeVisible();

    const mail = await latestEmail(email, { since, subject: "invited" });
    const link = extractLink(mail);
    expect(link).toContain("type=invite");

    // Follow the link in a fresh browser (no staff session)
    const ctx = await browser.newContext();
    const invitee = await ctx.newPage();
    await invitee.goto(link);
    await invitee.waitForURL(/\/auth\/set-password/);
    await invitee.locator("#pw").fill(password);
    await invitee.locator("#pw2").fill(password);
    await invitee.getByRole("button", { name: "Save password and continue" }).click();
    await invitee.waitForURL(/\/portal/);
    // A client with a single engagement is taken straight into it; either way the engagement is listed.
    await expect(invitee.getByText(new RegExp(eng.code)).first()).toBeVisible();
    await ctx.close();

    // The new password works for a normal sign-in
    const ctx2 = await browser.newContext();
    const again = await ctx2.newPage();
    await loginWithPassword(again, email, password);
    await expect(again).toHaveURL(/\/portal/);
    await ctx2.close();
  });
});
