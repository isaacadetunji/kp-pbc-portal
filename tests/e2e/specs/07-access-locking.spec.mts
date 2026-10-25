import { expect, test } from "@playwright/test";
import { loginWithPassword } from "../helpers/auth.mts";
import { mainEngagement, rest } from "../helpers/data.mts";
import { users } from "../helpers/env.mts";

interface Profile { id: string; email: string; full_name: string }
interface Folder { id: string; name: string }

const LOCK_CODE = "LOCK-E2E";
const LOCK_TITLE = "Confidential forensic workings (locked)";

async function profile(email: string): Promise<Profile> {
  const [p] = await rest<Profile[]>(`profiles?select=id,email,full_name&email=eq.${encodeURIComponent(email)}`);
  if (!p) throw new Error(`profile ${email} not found`);
  return p;
}

// ---------------------------------------------------------------------------
// Admin (non-super) only sees the areas the permission matrix allows.
// Defaults: manage_checklist on; manage_users / manage_clients off; Settings is
// Super-admin only. (See migration 0007 + Settings > Access.)
// ---------------------------------------------------------------------------
test.describe("role permissions: a plain admin", () => {
  test("can open Master checklist but not Users, Clients or Settings", async ({ page }) => {
    await loginWithPassword(page, users.admin);

    await test.step("Master checklist renders", async () => {
      const res = await page.goto("/admin/checklist");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Master checklist", exact: true })).toBeVisible();
    });

    await test.step("the sidebar hides Users, Clients and Settings", async () => {
      const nav = page.getByRole("navigation");
      await expect(nav.getByRole("link", { name: "Master checklist" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Users & access" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Clients", exact: true })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
    });

    await test.step("Users & access redirects away (no manage_users)", async () => {
      await page.goto("/admin/users");
      await page.waitForURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { level: 1, name: "Users & access" })).toHaveCount(0);
    });

    await test.step("Clients redirects away (no manage_clients)", async () => {
      await page.goto("/admin/clients");
      await page.waitForURL(/\/dashboard$/);
    });

    await test.step("Settings is 404 (Super admin only)", async () => {
      await page.goto("/admin/settings");
      await expect(page.getByRole("heading", { level: 1, name: "Settings", exact: true })).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Client portal wording: "Request in progress", "Outstanding", "Critical".
// ---------------------------------------------------------------------------
test.describe("client portal wording", () => {
  test('shows "Request in progress", the "Outstanding" tab and "Critical"', async ({ page }) => {
    await loginWithPassword(page, users.clientCfo);
    await expect(page).toHaveURL(/\/portal$/);

    // The next-year draft engagement is shown to the client as "Request in progress".
    await expect(page.getByText("Request in progress").first()).toBeVisible();

    // Open the released statutory audit and check the portal tab + critical wording.
    await page.getByRole("link", { name: /Statutory audit — FY\d{4}/ }).filter({ hasNotText: "Request in progress" }).first().click();
    await expect(page).toHaveURL(/\/portal\/[0-9a-f-]+/);
    await expect(page.getByRole("tab", { name: /Outstanding/ })).toBeVisible();
    // No "To do" (old label) anywhere.
    await expect(page.getByRole("tab", { name: "To do" })).toHaveCount(0);
    // The "All" view lists every item, so any non-waived critical item shows the
    // "Critical" badge (req 6: never "Needed first").
    await page.getByRole("tab", { name: /^All/ }).click();
    await expect(page.getByText("Critical", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Needed first")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// A locked request is hidden from an unassigned teammate and visible to its
// assignees (multi-assignee). Setup goes in through the service role (test
// only); visibility is verified through the real UI session (RLS).
// ---------------------------------------------------------------------------
test.describe.serial("locked request visibility", () => {
  let engagementId: string;

  test.beforeAll(async () => {
    const eng = await mainEngagement();
    engagementId = eng.id;
    const [manager, lead] = await Promise.all([profile(users.manager), profile(users.lead)]);
    const folders = await rest<Folder[]>(`engagement_folders?select=id,name&engagement_id=eq.${engagementId}&order=sort_order&limit=1`);
    const folderId = folders[0]?.id;
    if (!folderId) throw new Error("no folder on the seeded engagement");

    // Clean any previous run, then insert a locked item assigned to manager + lead (firm side).
    await rest(`request_items?engagement_id=eq.${engagementId}&code=eq.${LOCK_CODE}`, { method: "DELETE" });
    const [created] = await rest<{ id: string }[]>("request_items", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        engagement_id: engagementId, folder_id: folderId, code: LOCK_CODE,
        title: LOCK_TITLE, status: "requested", is_locked: true, issued_at: new Date().toISOString(),
      }),
    });
    const itemId = created!.id;
    await rest("request_item_assignees", {
      method: "POST",
      body: JSON.stringify([
        { request_item_id: itemId, engagement_id: engagementId, user_id: manager.id, side: "firm" },
        { request_item_id: itemId, engagement_id: engagementId, user_id: lead.id, side: "firm" },
      ]),
    });
  });

  test.afterAll(async () => {
    await rest(`request_items?engagement_id=eq.${engagementId}&code=eq.${LOCK_CODE}`, { method: "DELETE" });
  });

  test("an unassigned team member cannot see the locked request", async ({ page }) => {
    await loginWithPassword(page, users.senior); // Bayo Ogunleye, a plain member, not assigned
    await page.goto(`/engagements/${engagementId}?tab=requests`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("textbox", { name: "Search items" }).fill(LOCK_TITLE);
    await expect(page.getByText(LOCK_TITLE)).toHaveCount(0);
  });

  test("an assigned manager sees the locked request with both assignees", async ({ page }) => {
    await loginWithPassword(page, users.manager); // assigned + a manager
    await page.goto(`/engagements/${engagementId}?tab=requests`);
    await page.getByRole("textbox", { name: "Search items" }).fill(LOCK_TITLE);
    await expect(page.getByText(LOCK_TITLE).first()).toBeVisible();
    // Two firm assignees recorded on the one item (multi-assignee).
    const [row] = await rest<{ id: string }[]>(`request_items?select=id&engagement_id=eq.${engagementId}&code=eq.${LOCK_CODE}`);
    const assignees = await rest<unknown[]>(`request_item_assignees?select=user_id&request_item_id=eq.${row!.id}`);
    expect(assignees.length).toBe(2);
  });
});
