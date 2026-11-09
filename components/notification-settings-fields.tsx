"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  REMINDER_FREQUENCY, REMINDER_FREQUENCY_ORDER, REMINDER_TIME_SLOTS, WEEKDAYS, describeSchedule, hhmm,
} from "@/lib/checklist-constants";
import type { NotificationSettings, ReminderFrequency } from "@/lib/types";
import { cn } from "@/lib/utils";

function Schedule({
  idPrefix, frequency, weekday, times, onChange, disabled,
}: {
  idPrefix: string;
  frequency: ReminderFrequency;
  weekday: number;
  times: string[];
  onChange: (p: { frequency?: ReminderFrequency; weekday?: number; times?: string[] }) => void;
  disabled?: boolean;
}) {
  // Offer the quick slots plus any already-saved time that isn't among them.
  const extra = times.filter((t) => !REMINDER_TIME_SLOTS.includes(t));
  const slots = [...REMINDER_TIME_SLOTS, ...extra].sort();
  const timesDisabled = disabled || frequency === "off";
  const toggleTime = (t: string, on: boolean) => {
    const next = on ? [...new Set([...times, t])].sort() : times.filter((x) => x !== t);
    onChange({ times: next.length ? next : [t] }); // keep at least one time
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
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
      </div>
      <fieldset className="space-y-1.5" disabled={timesDisabled} aria-describedby={`${idPrefix}-times-help`}>
        <Label asChild><legend>Times (Lagos) — pick one or more</legend></Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reminder times">
          {slots.map((t) => {
            const on = times.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                disabled={timesDisabled}
                onClick={() => toggleTime(t, !on)}
                className={cn(
                  "rounded-[4px] border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                  on ? "border-primary/40 bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted/60",
                )}
              >
                {hhmm(t)}
              </button>
            );
          })}
        </div>
        <p id={`${idPrefix}-times-help`} className="text-xs text-muted-foreground">A reminder is sent at each selected time on the chosen days.</p>
      </fieldset>
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
            times={value.client_reminder_times}
            disabled={disabled}
            onChange={(p) => set({
              client_reminder_frequency: p.frequency ?? value.client_reminder_frequency,
              client_reminder_weekday: p.weekday ?? value.client_reminder_weekday,
              ...(p.times ? { client_reminder_times: p.times, client_reminder_time: p.times[0] } : {}),
            })}
          />
          <label className="flex items-center justify-between gap-4 pt-1">
            <span className="text-sm">Only when something is outstanding</span>
            <Switch checked={value.client_only_when_outstanding} onCheckedChange={(v) => set({ client_only_when_outstanding: v })} disabled={disabled || value.client_reminder_frequency === "off"} aria-label="Only when outstanding" />
          </label>
          <p className="text-xs text-muted-foreground">
            {describeSchedule(value.client_reminder_frequency, value.client_reminder_weekday, value.client_reminder_times)}. Each client user only sees the items they can access (locked items stay hidden). Released engagements only.
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
            times={value.team_reminder_times}
            disabled={disabled}
            onChange={(p) => set({
              team_reminder_frequency: p.frequency ?? value.team_reminder_frequency,
              team_reminder_weekday: p.weekday ?? value.team_reminder_weekday,
              ...(p.times ? { team_reminder_times: p.times, team_reminder_time: p.times[0] } : {}),
            })}
          />
          <p className="text-xs text-muted-foreground">
            {describeSchedule(value.team_reminder_frequency, value.team_reminder_weekday, value.team_reminder_times)}. Sent only when there is something to review.
          </p>
        </div>
      </fieldset>
    </div>
  );
}
