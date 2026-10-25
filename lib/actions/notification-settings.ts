"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionUser } from "@/lib/auth";
import { emailBrand, getEmailProvider, renderTestEmail, runDispatch, type DispatchSummary } from "@/lib/email";
import { friendlyError } from "@/lib/utils";
import type { ActionResult } from "./result";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const freq = z.enum(["off", "daily", "weekdays", "weekly"]);
const day = z.number().int().min(1).max(7);
const settingsSchema = z.object({
  client_instant: z.boolean(),
  client_reminder_frequency: freq,
  client_reminder_weekday: day,
  client_reminder_time: time,
  client_only_when_outstanding: z.boolean(),
  team_instant: z.boolean(),
  team_reminder_frequency: freq,
  team_reminder_weekday: day,
  team_reminder_time: time,
});
export type NotificationSettingsInput = z.infer<typeof settingsSchema>;

/** Firm-wide defaults copied into new engagements (Super admin; RLS on app_settings). */
export async function saveNotificationDefaults(input: NotificationSettingsInput): Promise<ActionResult> {
  try {
    const { supabase } = await actionUser(["super_admin"]);
    const value = settingsSchema.parse(input);
    const { error } = await supabase.from("app_settings").upsert({ key: "notifications.defaults", value, updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: friendlyError(error) };
    revalidatePath("/admin/settings/notifications");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

/** Per-engagement settings: partner, team lead or manager (RLS: can_manage_engagement). */
export async function saveEngagementNotificationSettings(engagementId: string, input: NotificationSettingsInput): Promise<ActionResult> {
  try {
    const { supabase } = await actionUser(["super_admin", "admin", "staff"]);
    const id = z.string().uuid().parse(engagementId);
    const v = settingsSchema.parse(input);
    // The row is created with the engagement; insert only if it is missing.
    let { data, error } = await supabase.from("engagement_notification_settings").update(v).eq("engagement_id", id).select("engagement_id");
    if (!error && !data?.length) {
      ({ data, error } = await supabase.from("engagement_notification_settings").insert({ engagement_id: id, ...v }).select("engagement_id"));
    }
    if (error) return { ok: false, error: friendlyError(error) };
    if (!data?.length) return { ok: false, error: "Only a partner, the team lead or a manager can change these settings." };
    revalidatePath(`/engagements/${id}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function sendTestEmail(): Promise<ActionResult<{ provider: string; to: string }>> {
  try {
    const { profile } = await actionUser(["super_admin"]);
    const provider = getEmailProvider();
    const msg = renderTestEmail(await emailBrand(), profile.full_name, profile.email);
    await provider.send({ to: profile.email, ...msg });
    return { ok: true, data: { provider: provider.name, to: profile.email } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

/** Run the dispatcher now (same as the hourly job). */
export async function runDispatchNow(): Promise<ActionResult<DispatchSummary>> {
  try {
    await actionUser(["super_admin"]);
    return { ok: true, data: await runDispatch() };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
