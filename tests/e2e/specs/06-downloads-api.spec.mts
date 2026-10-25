import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { loginWithPassword } from "../helpers/auth.mts";
import { mainEngagement, rest } from "../helpers/data.mts";
import { users } from "../helpers/env.mts";

test.describe("downloads and API", () => {
  test("attachments 'Download all as ZIP' returns a ZIP (starts with PK)", async ({ page }) => {
    const eng = await mainEngagement();
    await loginWithPassword(page, users.manager);
    await page.goto(`/engagements/${eng.id}?tab=attachments`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByText("Download all as ZIP").click()]);
    const file = await download.path();
    const head = fs.readFileSync(file!).subarray(0, 2).toString("latin1");
    expect(head).toBe("PK");
    expect(download.suggestedFilename()).toMatch(/\.zip$/i);
  });

  test("single file download streams the stored object", async ({ page }) => {
    const eng = await mainEngagement();
    const [file] = await rest<{ id: string; file_name: string }[]>(
      `request_item_files?select=id,file_name&engagement_id=eq.${eng.id}&mime_type=eq.application/pdf&upload_state=eq.stored&limit=1`,
    );
    expect(file, "a seeded PDF submission").toBeTruthy();
    await loginWithPassword(page, users.manager);
    const res = await page.request.get(`/api/files/${file!.id}`);
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("unauthenticated API calls get 401", async ({ request }) => {
    const eng = await mainEngagement();
    const zero = "00000000-0000-0000-0000-000000000000";
    for (const url of [
      `/api/files/${zero}`,
      `/api/documents/${zero}`,
      `/api/engagements/${eng.id}/attachments?side=client`,
      `/api/admin/checklist/export`,
    ]) {
      const res = await request.get(url, { maxRedirects: 0 });
      expect(res.status(), url).toBe(401);
    }
  });
});
