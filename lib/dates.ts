import { format, formatDistanceToNowStrict, parseISO } from "date-fns";

/** Today's date in Lagos (WAT) as yyyy-MM-dd. */
export function lagosToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
}

export function isOverdue(due: string | null | undefined, status: string): boolean {
  if (!due) return false;
  return (status === "requested" || status === "queried") && due < lagosToday();
}

export function fmtDate(d: string | null | undefined, pattern = "d MMM yyyy"): string {
  if (!d) return "—";
  try {
    return format(parseISO(d), pattern);
  } catch {
    return d;
  }
}

export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}

export function fromNow(d: string | null | undefined): string {
  if (!d) return "";
  return `${formatDistanceToNowStrict(new Date(d))} ago`;
}
