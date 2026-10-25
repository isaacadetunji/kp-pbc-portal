"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NotificationSettingsFields } from "@/components/notification-settings-fields";
import { saveEngagementNotificationSettings } from "@/lib/actions/notification-settings";
import { normaliseNotificationSettings } from "@/lib/checklist-constants";
import { createClient } from "@/lib/supabase/client";
import type { Engagement, NotificationSettings } from "@/lib/types";
import { friendlyError } from "@/lib/utils";

export function EngagementSettings({ engagement, canManage, firmMaxMb }: { engagement: Engagement; canManage: boolean; firmMaxMb: number }) {
  const router = useRouter();
  const [name, setName] = useState(engagement.name);
  const [start, setStart] = useState(engagement.period_start ?? "");
  const [end, setEnd] = useState(engagement.period_end);
  const [leadOnly, setLeadOnly] = useState(engagement.lead_only_acceptance);
  const [maxMb, setMaxMb] = useState(engagement.max_upload_mb ? String(engagement.max_upload_mb) : "");
  const [plannedStart, setPlannedStart] = useState(engagement.planned_start ?? "");
  const [docsDue, setDocsDue] = useState(engagement.documents_due ?? "");
  const [reportDue, setReportDue] = useState(engagement.report_due ?? "");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (docsDue && reportDue && reportDue < docsDue) return toast.error("The report due date can't be before the documents due date");
    setBusy(true);
    const { error } = await createClient()
      .from("engagements")
      .update({
        name: name.trim(),
        period_start: start || null,
        period_end: end,
        lead_only_acceptance: leadOnly,
        max_upload_mb: maxMb ? Math.max(1, Math.min(2048, Number(maxMb))) : null,
        planned_start: plannedStart || null,
        documents_due: docsDue || null,
        report_due: reportDue || null,
      })
      .eq("id", engagement.id);
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success("Engagement settings saved");
    router.refresh();
  }

  return (
    <div className="space-y-6">
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Engagement settings</CardTitle>
        <CardDescription>Code {engagement.code} · storage folder {engagement.storage_root}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={!canManage || busy} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="es-name">Engagement name</Label>
              <Input id="es-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="es-start">Period start</Label>
                <Input id="es-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="es-end">Period end</Label>
                <Input id="es-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Planned dates</legend>
              <p className="text-xs text-muted-foreground">Shown on the engagement calendar for the team and the client.</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="es-planned">Planned start</Label>
                  <Input id="es-planned" type="date" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="es-docs">Documents due</Label>
                  <Input id="es-docs" type="date" value={docsDue} onChange={(e) => setDocsDue(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="es-report">Report due</Label>
                  <Input id="es-report" type="date" min={docsDue || undefined} value={reportDue} onChange={(e) => setReportDue(e.target.value)} />
                </div>
              </div>
            </fieldset>
            <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <span>
                <span className="block text-sm font-medium">Final acceptance by partner / team lead only</span>
                <span className="block text-xs text-muted-foreground">When on, managers can review and query but only a partner or the team lead can accept items or mark them N/A.</span>
              </span>
              <Switch checked={leadOnly} onCheckedChange={setLeadOnly} />
            </label>
            <div className="space-y-2">
              <Label htmlFor="es-max">Maximum upload size (MB)</Label>
              <Input id="es-max" type="number" min={1} max={2048} value={maxMb} onChange={(e) => setMaxMb(e.target.value)} placeholder={`Firm default: ${firmMaxMb} MB`} />
            </div>
            {canManage ? <Button type="submit">Save settings</Button> : <p className="text-sm text-muted-foreground">Only a partner, the team lead or a manager can change these settings.</p>}
          </fieldset>
        </form>
      </CardContent>
    </Card>
    <NotificationsCard engagementId={engagement.id} canManage={canManage} />
    </div>
  );
}

/** Notifications & reminders for this engagement (team only; editable by the lead / managers). */
function NotificationsCard({ engagementId, canManage }: { engagementId: string; canManage: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState<NotificationSettings | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    createClient()
      .from("engagement_notification_settings")
      .select("*")
      .eq("engagement_id", engagementId)
      .maybeSingle()
      .then(({ data }: { data: Partial<NotificationSettings> | null }) => {
        if (!live) return;
        setMissing(!data);
        setValue(normaliseNotificationSettings(data));
      });
    return () => {
      live = false;
    };
  }, [engagementId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!value) return;
    setBusy(true);
    const res = await saveEngagementNotificationSettings(engagementId, value);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setMissing(false);
    toast.success("Notification settings saved");
    router.refresh();
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Notifications &amp; reminders</CardTitle>
        <CardDescription>
          E-mails for this engagement. In-app notifications are always on. Times are Lagos time.
          {missing ? " Showing the firm defaults; save to keep them for this engagement." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {value ? (
          <form onSubmit={save} className="space-y-5">
            <NotificationSettingsFields value={value} onChange={setValue} disabled={!canManage || busy} idPrefix="eng-ns" />
            {canManage ? (
              <Button type="submit" disabled={busy}>Save notification settings</Button>
            ) : (
              <p className="text-sm text-muted-foreground">Only a partner, the team lead or a manager can change these settings.</p>
            )}
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </CardContent>
    </Card>
  );
}
