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

/** The date a request was made to the client: issued_at when released, else created_at. */
export function requestedDate(item: { issued_at?: string | null; created_at?: string | null }): string | null {
  return item.issued_at ?? item.created_at ?? null;
}

/** "Requested 12 Oct" (empty when neither date is set). */
export function fmtRequested(item: { issued_at?: string | null; created_at?: string | null }): string {
  const d = requestedDate(item);
  return d ? `Requested ${fmtDate(d, "d MMM")}` : "";
}
