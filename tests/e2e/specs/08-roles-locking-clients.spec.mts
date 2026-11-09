import { expect, test } from "@playwright/test";
import { loginWithPassword } from "../helpers/auth.mts";
import { items, mainEngagement, rest } from "../helpers/data.mts";
import { users } from "../helpers/env.mts";

interface Profile { id: string; email: string; full_name: string }
interface Folder { id: string; name: string }
interface TeamRow { user_id: string; team_role: string }

async function profile(email: string): Promise<Profile> {
  const [p] = await rest<Profile[]>(`profiles?select=id,email,full_name&email=eq.${encodeURIComponent(email)}`);
  if (!p) throw new Error(`profile ${email} not found`);
  return p;
}

const PLOCK_CODE = "PLOCK-E2E";
const PLOCK_TITLE = "Partner-only board paper (locked)";

// ---------------------------------------------------------------------------
// Section 3 — seniority-based lock controls in the item UI.
// A plain member sees no Lock control; a manager cannot unlock a partner's lock
// (nor does the control appear); the partner can.
// ---------------------------------------------------------------------------
test.describe.serial("seniority-based lock controls", () => {
  let engagementId: string;
  let plockId: string;

  test.beforeAll(async () => {
    const eng = await mainEngagement();
    engagementId = eng.id;
    const [partner, manager] = await Promise.all([profile(users.partner), profile(users.manager)]);
    const folders = await rest<Folder[]>(`engagement_folders?select=id,name&engagement_id=eq.${engagementId}&order=sort_order&limit=1`);
    const folderId = folders[0]!.id;
    await rest(`request_items?engagement_id=eq.${engagementId}&code=eq.${PLOCK_CODE}`, { method: "DELETE" });
    const [created] = await rest<{ id: string }[]>("request_items", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        engagement_id: engagementId, folder_id: folderId, code: PLOCK_CODE, title: PLOCK_TITLE,
        status: "requested", is_locked: true, locked_by: partner.id, issued_at: new Date().toISOString(),
      }),
    });
    plockId = created!.id;
    await rest("request_item_assignees", {
      method: "POST",
      body: JSON.stringify([{ request_item_id: plockId, engagement_id: engagementId, user_id: manager.id, side: "firm" }]),
    });
  });

  test.afterAll(async () => {
    await rest(`request_items?engagement_id=eq.${engagementId}&code=eq.${PLOCK_CODE}`, { method: "DELETE" });
  });

  test("a plain member sees no Lock control on an unlocked request", async ({ page }) => {
    const [open] = await items(engagementId, "&is_locked=eq.false&status=eq.requested");
    await loginWithPassword(page, users.senior); // Bayo Ogunleye, a plain member
    await page.goto(`/engagements/${engagementId}?tab=requests&item=${open!.id}`);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: open!.title })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Lock", exact: true })).toHaveCount(0);
  });

  test("a manager cannot unlock a partner's lock (no Unlock control)", async ({ page }) => {
    await loginWithPassword(page, users.manager); // assigned, so can see it
    await page.goto(`/engagements/${engagementId}?tab=requests&item=${plockId}`);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: PLOCK_TITLE })).toBeVisible();
    await expect(sheet.getByText(/Locked/).first()).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Unlock" })).toHaveCount(0);
  });

  test("the partner can unlock its own lock", async ({ page }) => {
    await loginWithPassword(page, users.partner);
    await page.goto(`/engagements/${engagementId}?tab=requests&item=${plockId}`);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: PLOCK_TITLE })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Unlock" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Section 1 — reassigning the team lead drops the old lead to a plain MEMBER,
// never auto-promoting them to manager.
// ---------------------------------------------------------------------------
test.describe.serial("team lead reassignment", () => {
  let engagementId: string;
  let lead: Profile; let manager: Profile;

  test.beforeAll(async () => {
    engagementId = (await mainEngagement()).id;
    [lead, manager] = await Promise.all([profile(users.lead), profile(users.manager)]);
  });

  test.afterAll(async () => {
    // Restore the seeded hierarchy (manager seat first to satisfy single-holder).
    await rest(`engagement_team?engagement_id=eq.${engagementId}&user_id=eq.${manager.id}`, {
      method: "PATCH", body: JSON.stringify({ team_role: "manager" }),
    });
    await rest(`engagement_team?engagement_id=eq.${engagementId}&user_id=eq.${lead.id}`, {
      method: "PATCH", body: JSON.stringify({ team_role: "lead" }),
    });
  });

  test("the previous lead becomes a member, not a manager", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    await loginWithPassword(page, users.lead);
    await page.goto(`/engagements/${engagementId}?tab=team`);
    await expect(page.locator("#lead-pick")).toBeVisible();
    // Pick the manager (Ngozi Eze) as the new team lead via the single-holder control.
    await page.locator("#lead-pick").click();
    await page.getByRole("option", { name: /Ngozi Eze/ }).click();
    // The DB demotes the former lead to a plain member.
    await expect.poll(async () => {
      const rows = await rest<TeamRow[]>(`engagement_team?select=user_id,team_role&engagement_id=eq.${engagementId}&user_id=eq.${lead.id}`);
      return rows[0]?.team_role;
    }, { timeout: 15_000 }).toBe("member");
    const newLead = await rest<TeamRow[]>(`engagement_team?select=user_id,team_role&engagement_id=eq.${engagementId}&user_id=eq.${manager.id}`);
    expect(newLead[0]?.team_role).toBe("lead");
  });
});

// ---------------------------------------------------------------------------
// Section 7 — clients: no duplicate names; a manual client merges on sync.
// ---------------------------------------------------------------------------
test.describe.serial("clients: dedupe and merge", () => {
  test("a duplicate client name is rejected", async ({ page }) => {
    await loginWithPassword(page, users.superAdmin);
    await page.goto("/admin/clients");
    await page.getByRole("button", { name: "Manual client" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Company name").fill("Adebayo Foods Plc");
    await dialog.getByRole("button", { name: "Add client" }).click();
    await expect(page.getByText(/already exists/i)).toBeVisible();
  });

  test('a manual client merges on sync and loses its "M" tag', async ({ page }) => {
    await loginWithPassword(page, users.superAdmin);
    await page.goto("/admin/clients");
    // The seeded manual "Yaba Tech Hub Ltd" shows the compact M tag before sync.
    const before = await rest<{ source: string }[]>(`clients?select=source&name=eq.Yaba%20Tech%20Hub%20Ltd`);
    expect(before.length).toBe(1);
    expect(before[0]!.source).toBe("manual");
    await page.getByRole("textbox", { name: /Search name/ }).fill("Yaba Tech");
    await expect(page.getByLabel("Manual client").first()).toBeVisible();
    // Sync from the client database: the directory has "Yaba Tech Hub Ltd" too.
    await page.getByRole("button", { name: /Sync from client database/ }).click();
    await expect(page.getByText(/Synced \d+ clients/)).toBeVisible();
    // Merged in place: still exactly one row, now synced (source = api, M gone).
    await expect.poll(async () => {
      const rows = await rest<{ source: string; external_id: string | null }[]>(`clients?select=source,external_id&name=eq.Yaba%20Tech%20Hub%20Ltd`);
      return rows.length === 1 && rows[0]!.source === "api" ? rows[0]!.external_id : null;
    }, { timeout: 15_000 }).not.toBeNull();
    await page.reload();
    await page.getByRole("textbox", { name: /Search name/ }).fill("Yaba Tech");
    await expect(page.getByText("Yaba Tech Hub Ltd")).toBeVisible();
    await expect(page.getByLabel("Manual client")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Section 4 — more than one reminder time per day persists.
// ---------------------------------------------------------------------------
test.describe("notifications: multiple reminder times", () => {
  test("a second client reminder time can be added and persists", async ({ page }) => {
    await loginWithPassword(page, users.superAdmin);
    await page.goto("/admin/settings/notifications");
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    // Add the 12:00 slot to the client reminders (first Times group on the page).
    const clientTimes = page.getByRole("group", { name: "Reminder times" }).first();
    await clientTimes.getByRole("button", { name: "12:00" }).click();
    await page.getByRole("button", { name: "Save defaults" }).click();
    await expect(page.getByText(/saved|Saved/).first()).toBeVisible();
    await expect.poll(async () => {
      const [row] = await rest<{ value: { client_reminder_times: string[] } }[]>(`app_settings?select=value&key=eq.notifications.defaults`);
      return (row?.value.client_reminder_times ?? []).length;
    }, { timeout: 15_000 }).toBeGreaterThan(1);
    // Persists across a reload (the 12:00 toggle stays pressed).
    await page.reload();
    await expect(page.getByRole("group", { name: "Reminder times" }).first().getByRole("button", { name: "12:00" })).toHaveAttribute("aria-pressed", "true");
  });
});
