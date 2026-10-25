"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationSettingsFields } from "@/components/notification-settings-fields";
import { runDispatchNow, saveNotificationDefaults, sendTestEmail } from "@/lib/actions/notification-settings";
import type { NotificationSettings } from "@/lib/types";

export function NotificationsSettingsForm({
  defaults, email,
}: {
  defaults: NotificationSettings;
  email: { provider: "resend" | "log"; from: string; resendConfigured: boolean; smtpSink: boolean; cronConfigured: boolean; me: string };
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaults);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await saveNotificationDefaults(value);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Defaults saved. They apply to engagements created from now on.");
    router.refresh();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <CardTitle>Defaults for new engagements</CardTitle>
          <CardDescription>Times are Lagos time (WAT). The scheduler runs every hour, so reminders go out within the hour after the chosen time.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-5">
            <NotificationSettingsFields value={value} onChange={setValue} disabled={busy} idPrefix="defaults" />
            <Button type="submit" disabled={busy}>Save defaults</Button>
          </form>
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>E-mail delivery</CardTitle>
          <CardDescription>Configured with environment variables (see README).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Provider</span>
            <Badge variant={email.provider === "resend" ? "success" : "warning"}>{email.provider === "resend" ? "Resend" : "Log only (development)"}</Badge>
          </div>
          {email.provider === "resend" && !email.resendConfigured ? <p className="text-destructive">RESEND_API_KEY is missing.</p> : null}
          {email.provider === "log" ? (
            <p className="text-xs text-muted-foreground">E-mails are written to the server log{email.smtpSink ? " and delivered to the SMTP sink (SMTP_URL)" : ""}. Set EMAIL_PROVIDER=resend and RESEND_API_KEY to send real e-mails.</p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">From</span>
            <span className="truncate text-right font-mono text-xs" title={email.from}>{email.from}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Scheduler secret</span>
            <Badge variant={email.cronConfigured ? "success" : "danger"}>{email.cronConfigured ? "CRON_SECRET set" : "CRON_SECRET missing"}</Badge>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Button
              type="button" variant="outline" disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await sendTestEmail();
                setBusy(false);
                if (!res.ok) return toast.error(res.error);
                toast.success(`Test e-mail sent to ${res.data.to} (${res.data.provider})`);
              }}
            >
              <Mail /> Send me a test e-mail
            </Button>
            <Button
              type="button" variant="outline" disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await runDispatchNow();
                setBusy(false);
                if (!res.ok) return toast.error(res.error);
                const d = res.data;
                const msg = `${d.instant.emails} instant e-mail(s), ${d.reminders.sent} reminder(s) sent; ${d.instant.skipped} notification(s) skipped`;
                if (d.errors.length) toast.warning(`${msg}. ${d.errors.length} problem(s): ${d.errors[0]}`);
                else toast.success(msg);
              }}
            >
              <Play /> Run the dispatcher now
            </Button>
            <p className="text-xs text-muted-foreground">Same as the hourly job: sends pending instant e-mails and any reminders due now. Reminders are never sent twice on the same day.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
