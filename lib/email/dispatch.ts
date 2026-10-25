import "server-only";
import { publicEnv } from "@/lib/env";
import { getBrand } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailProvider, type EmailProvider } from "./provider";
import { renderInstantEmail, renderReminderEmail, type DigestItem, type EmailBrand } from "./templates";

/**
 * Notification e-mail dispatcher, run by /api/cron/dispatch (hourly).
 * All selection and permission logic is in the database (migration 0009):
 *   email_dispatch_queue()   pending notifications + whether to deliver
 *   reminder_digests_due()   reminder digests due now (locked items excluded
 *                            via can_user_view_request_item)
 * This module only groups, renders, sends and records the outcome. It uses
 * the service role and must only run on the server.
 */

interface QueueRow {
  notification_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  is_client: boolean;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  engagement_id: string | null;
  engagement_code: string | null;
  engagement_name: string | null;
  request_item_id: string | null;
  created_at: string;
  deliver: boolean;
  skip_reason: string | null;
}

interface DigestRow {
  engagement_id: string;
  engagement_code: string;
  engagement_name: string;
  client_name: string;
  audience: "client" | "team";
  user_id: string;
  email: string;
  full_name: string | null;
  local_date: string;
  item_count: number;
  items: DigestItem[];
}

export interface DispatchSummary {
  provider: string;
  instant: { considered: number; skipped: number; emails: number; notificationsSent: number; failed: number };
  reminders: { due: number; sent: number; failed: number };
  errors: string[];
}

const MAX_INSTANT_EMAILS = 150;
const MAX_REMINDERS = 300;

export async function emailBrand(): Promise<EmailBrand> {
  const b = await getBrand();
  const site = publicEnv.siteUrl.replace(/\/$/, "");
  const logo = b.logo_url ? (/^https?:\/\//i.test(b.logo_url) ? b.logo_url : `${site}${b.logo_url.startsWith("/") ? "" : "/"}${b.logo_url}`) : `${site}/kreston-pedabo-logo.png`;
  return { firmName: b.firm_name, portalName: b.portal_name, primary: b.primary, accent: b.accent, logoUrl: logo, siteUrl: site };
}

export async function runDispatch(opts: { now?: Date; provider?: EmailProvider } = {}): Promise<DispatchSummary> {
  const db = createAdminClient();
  const provider = opts.provider ?? getEmailProvider();
  const brand = await emailBrand();
  const now = opts.now ?? new Date();
  const summary: DispatchSummary = {
    provider: provider.name,
    instant: { considered: 0, skipped: 0, emails: 0, notificationsSent: 0, failed: 0 },
    reminders: { due: 0, sent: 0, failed: 0 },
    errors: [],
  };

  // ---- (a) instant e-mails -------------------------------------------------
  const { data: queue, error: qErr } = await db.rpc("email_dispatch_queue", { p_limit: 1000 });
  if (qErr) {
    summary.errors.push(`queue: ${qErr.message}`);
  } else {
    const rows = (queue ?? []) as QueueRow[];
    summary.instant.considered = rows.length;

    // Skipped rows: mark with their reason (grouped by reason)
    const byReason = new Map<string, string[]>();
    for (const r of rows.filter((x) => !x.deliver)) {
      const k = r.skip_reason ?? "skipped";
      byReason.set(k, [...(byReason.get(k) ?? []), r.notification_id]);
    }
    for (const [reason, ids] of byReason) {
      const { error } = await db.rpc("mark_notifications_emailed", { p_ids: ids, p_error: null, p_skip: reason });
      if (error) summary.errors.push(`mark skipped: ${error.message}`);
      else summary.instant.skipped += ids.length;
    }

    // One e-mail per recipient, grouping all their pending notifications
    const byUser = new Map<string, QueueRow[]>();
    for (const r of rows.filter((x) => x.deliver)) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
    let sent = 0;
    for (const [, list] of byUser) {
      if (sent >= MAX_INSTANT_EMAILS) break;
      const first = list[0]!;
      const ids = list.map((r) => r.notification_id);
      const msg = renderInstantEmail({
        brand,
        recipient: { name: first.full_name, email: first.email, isClient: first.is_client },
        notifications: list.map((r) => ({
          type: r.type, title: r.title, body: r.body, link: r.link,
          engagement_code: r.engagement_code, engagement_name: r.engagement_name, created_at: r.created_at,
        })),
      });
      try {
        await provider.send({ to: first.email, ...msg, key: `n-${ids.sort()[0]}-${ids.length}` });
        const { error } = await db.rpc("mark_notifications_emailed", { p_ids: ids, p_error: null, p_skip: null });
        if (error) summary.errors.push(`mark sent: ${error.message}`);
        summary.instant.emails++;
        summary.instant.notificationsSent += ids.length;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        summary.instant.failed++;
        summary.errors.push(`send to ${first.email}: ${message}`);
        await db.rpc("mark_notifications_emailed", { p_ids: ids, p_error: message, p_skip: null });
      }
      sent++;
    }
  }

  // ---- (b) reminder digests -------------------------------------------------
  const { data: due, error: dErr } = await db.rpc("reminder_digests_due", { p_now: now.toISOString() });
  if (dErr) {
    summary.errors.push(`reminders: ${dErr.message}`);
  } else {
    const rows = ((due ?? []) as DigestRow[]).slice(0, MAX_REMINDERS);
    summary.reminders.due = rows.length;
    for (const r of rows) {
      const msg = renderReminderEmail({
        brand,
        audience: r.audience,
        recipient: { name: r.full_name, email: r.email },
        engagement: { id: r.engagement_id, code: r.engagement_code, name: r.engagement_name, clientName: r.client_name },
        items: r.items ?? [],
        now,
      });
      const base = { p_engagement_id: r.engagement_id, p_user_id: r.user_id, p_audience: r.audience, p_local_date: r.local_date, p_item_count: r.item_count };
      try {
        await provider.send({ to: r.email, ...msg, key: `r-${r.engagement_id}-${r.user_id}-${r.audience}-${r.local_date}` });
        await db.rpc("record_reminder", { ...base, p_status: "sent", p_error: null });
        summary.reminders.sent++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        summary.reminders.failed++;
        summary.errors.push(`reminder to ${r.email}: ${message}`);
        await db.rpc("record_reminder", { ...base, p_status: "failed", p_error: message });
      }
    }
  }
  return summary;
}
