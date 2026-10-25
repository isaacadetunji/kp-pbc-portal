"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  REMINDER_FREQUENCY, REMINDER_FREQUENCY_ORDER, REMINDER_TIMES, WEEKDAYS, describeSchedule,
} from "@/lib/checklist-constants";
import type { NotificationSettings, ReminderFrequency } from "@/lib/types";

function Schedule({
  idPrefix, frequency, weekday, time, onChange, disabled,
}: {
  idPrefix: string;
  frequency: ReminderFrequency;
  weekday: number;
  time: string;
  onChange: (p: { frequency?: ReminderFrequency; weekday?: number; time?: string }) => void;
  disabled?: boolean;
}) {
  const times = REMINDER_TIMES.includes(time) ? REMINDER_TIMES : [...REMINDER_TIMES, time].sort();
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-freq`}>Frequency</Label>
        <Select value={frequency} onValueChange={(v) => onChange({ frequency: v as ReminderFrequency })} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-freq`}><SelectValue /></SelectTrigger>
          <SelectContent>{REMINDER_FREQUENCY_ORDER.map((f) => <SelectItem key={f} value={f}>{REMINDER_FREQUENCY[f]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-day`}>Day</Label>
        <Select value={String(weekday)} onValueChange={(v) => onChange({ weekday: Number(v) })} disabled={disabled || frequency !== "weekly"}>
          <SelectTrigger id={`${idPrefix}-day`}><SelectValue /></SelectTrigger>
          <SelectContent>{WEEKDAYS.map((d) => <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-time`}>Time (Lagos)</Label>
        <Select value={time} onValueChange={(v) => onChange({ time: v })} disabled={disabled || frequency === "off"}>
          <SelectTrigger id={`${idPrefix}-time`}><SelectValue /></SelectTrigger>
          <SelectContent>{times.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** Client + team notification settings (used per engagement and for the firm-wide defaults). */
export function NotificationSettingsFields({
  value, onChange, disabled, idPrefix = "ns",
}: {
  value: NotificationSettings;
  onChange: (v: NotificationSettings) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const set = (p: Partial<NotificationSettings>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-5">
      <fieldset className="space-y-3 rounded-lg border p-4" disabled={disabled}>
        <legend className="px-1 text-sm font-semibold">Client</legend>
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Instant e-mails</span>
            <span className="block text-xs text-muted-foreground">New request list released, queries, documents from the team, comments. Several updates are grouped into one e-mail.</span>
          </span>
          <Switch checked={value.client_instant} onCheckedChange={(v) => set({ client_instant: v })} disabled={disabled} aria-label="Client instant e-mails" />
        </label>
        <div className="space-y-2">
          <div className="text-sm font-medium">Reminders for outstanding items</div>
          <Schedule
            idPrefix={`${idPrefix}-client`}
            frequency={value.client_reminder_frequency}
            weekday={value.client_reminder_weekday}
            time={value.client_reminder_time}
            disabled={disabled}
            onChange={(p) => set({
              client_reminder_frequency: p.frequency ?? value.client_reminder_frequency,
              client_reminder_weekday: p.weekday ?? value.client_reminder_weekday,
              client_reminder_time: p.time ?? value.client_reminder_time,
            })}
          />
          <label className="flex items-center justify-between gap-4 pt-1">
            <span className="text-sm">Only when something is outstanding</span>
            <Switch checked={value.client_only_when_outstanding} onCheckedChange={(v) => set({ client_only_when_outstanding: v })} disabled={disabled || value.client_reminder_frequency === "off"} aria-label="Only when outstanding" />
          </label>
          <p className="text-xs text-muted-foreground">
            {describeSchedule(value.client_reminder_frequency, value.client_reminder_weekday, value.client_reminder_time)}. Each client user only sees the items they can access (locked items stay hidden). Released engagements only.
          </p>
        </div>
      </fieldset>
      <fieldset className="space-y-3 rounded-lg border p-4" disabled={disabled}>
        <legend className="px-1 text-sm font-semibold">Engagement team</legend>
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Instant e-mails</span>
            <span className="block text-xs text-muted-foreground">Client uploads and submissions, items assigned to you, comments and @mentions.</span>
          </span>
          <Switch checked={value.team_instant} onCheckedChange={(v) => set({ team_instant: v })} disabled={disabled} aria-label="Team instant e-mails" />
        </label>
        <div className="space-y-2">
          <div className="text-sm font-medium">Reminder for client submissions awaiting review</div>
          <Schedule
            idPrefix={`${idPrefix}-team`}
            frequency={value.team_reminder_frequency}
            weekday={value.team_reminder_weekday}
            time={value.team_reminder_time}
            disabled={disabled}
            onChange={(p) => set({
              team_reminder_frequency: p.frequency ?? value.team_reminder_frequency,
              team_reminder_weekday: p.weekday ?? value.team_reminder_weekday,
              team_reminder_time: p.time ?? value.team_reminder_time,
            })}
          />
          <p className="text-xs text-muted-foreground">
            {describeSchedule(value.team_reminder_frequency, value.team_reminder_weekday, value.team_reminder_time)}. Sent only when there is something to review.
          </p>
        </div>
      </fieldset>
    </div>
  );
}
