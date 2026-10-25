import type { FileClass, NotificationSettings, ReminderFrequency } from "./types";

/** File classification of a request (master item / engagement item). */
export const FILE_CLASS: Record<FileClass, { label: string; short: string; description: string }> = {
  permanent: { label: "Permanent file", short: "Permanent", description: "Always relevant; carried from year to year" },
  current: { label: "Current file", short: "Current", description: "Needed for the current year" },
};
export const FILE_CLASS_ORDER: FileClass[] = ["permanent", "current"];

/** Priority values in the database (0009 renamed 'high' to 'important'). */
export const PRIORITY_VALUES = ["low", "normal", "important", "urgent"] as const;
export type PriorityValue = (typeof PRIORITY_VALUES)[number];
export const PRIORITY_LABEL: Record<PriorityValue, string> = {
  low: "Low",
  normal: "Normal",
  important: "Important",
  urgent: "Urgent",
};

/** Parse a priority from an import cell. Accepts labels, values and "High" (old name). */
export function parsePriority(v: string | null | undefined): PriorityValue | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return "normal";
  if (s === "high") return "important";
  return (PRIORITY_VALUES as readonly string[]).includes(s) ? (s as PriorityValue) : null;
}

export const REMINDER_FREQUENCY: Record<ReminderFrequency, string> = {
  off: "Off",
  daily: "Daily",
  weekdays: "Weekdays (Mon–Fri)",
  weekly: "Weekly",
};
export const REMINDER_FREQUENCY_ORDER: ReminderFrequency[] = ["off", "daily", "weekdays", "weekly"];

/** ISO weekdays, 1 = Monday. */
export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

/** Reminder times offered (the scheduler runs hourly). */
export const REMINDER_TIMES: string[] = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  client_instant: true,
  client_reminder_frequency: "weekly",
  client_reminder_weekday: 1,
  client_reminder_time: "17:00",
  client_only_when_outstanding: true,
  team_instant: true,
  team_reminder_frequency: "weekdays",
  team_reminder_weekday: 1,
  team_reminder_time: "09:00",
};

/** Normalise Postgres time ("17:00:00") to "17:00". */
export function hhmm(t: string | null | undefined, fallback = "09:00"): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : fallback;
}

/** Merge stored settings (possibly partial / malformed) over the defaults. */
export function normaliseNotificationSettings(v: Partial<Record<keyof NotificationSettings, unknown>> | null | undefined): NotificationSettings {
  const d = DEFAULT_NOTIFICATION_SETTINGS;
  const freq = (x: unknown, f: ReminderFrequency) => (REMINDER_FREQUENCY_ORDER.includes(x as ReminderFrequency) ? (x as ReminderFrequency) : f);
  const day = (x: unknown, f: number) => (Number.isInteger(Number(x)) && Number(x) >= 1 && Number(x) <= 7 ? Number(x) : f);
  const bool = (x: unknown, f: boolean) => (typeof x === "boolean" ? x : f);
  const s = v ?? {};
  return {
    client_instant: bool(s.client_instant, d.client_instant),
    client_reminder_frequency: freq(s.client_reminder_frequency, d.client_reminder_frequency),
    client_reminder_weekday: day(s.client_reminder_weekday, d.client_reminder_weekday),
    client_reminder_time: hhmm(s.client_reminder_time as string, d.client_reminder_time),
    client_only_when_outstanding: bool(s.client_only_when_outstanding, d.client_only_when_outstanding),
    team_instant: bool(s.team_instant, d.team_instant),
    team_reminder_frequency: freq(s.team_reminder_frequency, d.team_reminder_frequency),
    team_reminder_weekday: day(s.team_reminder_weekday, d.team_reminder_weekday),
    team_reminder_time: hhmm(s.team_reminder_time as string, d.team_reminder_time),
  };
}

export function describeSchedule(freq: ReminderFrequency, weekday: number, time: string): string {
  if (freq === "off") return "Off";
  const at = `at ${hhmm(time)} (Lagos)`;
  if (freq === "weekly") return `Every ${WEEKDAYS.find((w) => w.value === weekday)?.label ?? "Monday"} ${at}`;
  return `${REMINDER_FREQUENCY[freq]} ${at}`;
}
