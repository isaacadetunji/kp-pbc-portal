import type { Metadata } from "next";
import { emailConfig } from "@/lib/email";
import { getNotificationDefaults, requireSettingsAccess } from "@/lib/settings";
import { NotificationsSettingsForm } from "./notifications-form";

export const metadata: Metadata = { title: "Settings · Notifications" };

export default async function NotificationSettingsPage() {
  const { profile } = await requireSettingsAccess();
  const defaults = await getNotificationDefaults();
  const cfg = emailConfig();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          E-mail notifications and reminders. These are the firm-wide defaults copied into each new engagement; a partner, the team lead or a manager can change them in the engagement&apos;s Settings tab. In-app notifications are always on.
        </p>
      </div>
      <NotificationsSettingsForm
        defaults={defaults}
        email={{
          provider: cfg.provider,
          from: cfg.from,
          resendConfigured: Boolean(cfg.resendKey),
          smtpSink: Boolean(cfg.smtpUrl),
          cronConfigured: cfg.cronConfigured,
          me: profile.email,
        }}
      />
    </div>
  );
}
