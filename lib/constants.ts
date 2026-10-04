import type { AppRole, EngagementStatus, EventKind, ItemPriority, ItemStatus, SampleLineStatus, TeamRole } from "./types";

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "danger" | "info" | "muted";

export const ITEM_STATUS: Record<ItemStatus, { label: string; clientLabel: string; variant: BadgeVariant }> = {
  requested: { label: "Requested", clientLabel: "To provide", variant: "muted" },
  submitted: { label: "Submitted", clientLabel: "Submitted", variant: "info" },
  under_review: { label: "Under review", clientLabel: "Under review", variant: "info" },
  accepted: { label: "Accepted", clientLabel: "Complete", variant: "success" },
  queried: { label: "Queried", clientLabel: "Action needed", variant: "warning" },
  not_applicable: { label: "N/A", clientLabel: "Not required", variant: "outline" },
};

export const ITEM_STATUS_ORDER: ItemStatus[] = [
  "requested", "queried", "submitted", "under_review", "accepted", "not_applicable",
];

export const ENGAGEMENT_STATUS: Record<EngagementStatus, { label: string; variant: BadgeVariant; step: number }> = {
  draft: { label: "Draft", variant: "muted", step: 0 },
  awaiting_approval: { label: "Awaiting approval", variant: "info", step: 1 },
  pre_engagement: { label: "Pre-engagement", variant: "warning", step: 2 },
  acceptance_review: { label: "Acceptance review", variant: "info", step: 3 },
  accepted: { label: "Accepted", variant: "success", step: 4 },
  declined: { label: "Declined", variant: "danger", step: 4 },
  in_progress: { label: "In progress", variant: "default", step: 5 },
  completed: { label: "Completed", variant: "success", step: 6 },
  archived: { label: "Archived", variant: "outline", step: 7 },
};

export const PRIORITY: Record<ItemPriority, { label: string; variant: BadgeVariant }> = {
  low: { label: "Low", variant: "muted" },
  normal: { label: "Normal", variant: "outline" },
  high: { label: "High", variant: "warning" },
  urgent: { label: "Urgent", variant: "danger" },
};

export const TEAM_ROLE: Record<TeamRole, string> = {
  lead: "Engagement lead",
  manager: "Manager",
  member: "Member",
};

/** Clients see unreleased engagements (draft / awaiting approval) as this. */
export const BEING_PREPARED = "Being prepared";

export const EVENT_KIND: Record<EventKind, { label: string; dot: string; chip: string }> = {
  deadline: { label: "Deadline", dot: "bg-destructive", chip: "bg-danger-soft text-destructive" },
  filing: { label: "Regulatory filing", dot: "bg-violet-600", chip: "bg-violet-100 text-violet-800" },
  meeting: { label: "Meeting", dot: "bg-indigo-500", chip: "bg-indigo-50 text-indigo-800" },
  milestone: { label: "Milestone", dot: "bg-emerald-600", chip: "bg-emerald-50 text-emerald-800" },
  client_request: { label: "Client request", dot: "bg-warning", chip: "bg-warning-soft text-warning" },
  other: { label: "Other", dot: "bg-muted-foreground", chip: "bg-muted text-foreground" },
};
export const EVENT_KIND_ORDER: EventKind[] = ["deadline", "filing", "meeting", "milestone", "client_request", "other"];

/** Max columns of a sample schedule (DB constraint in migration 0006). */
export const MAX_SAMPLE_COLUMNS = 50;
export const MAX_SAMPLE_LINES = 1000;

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const DEFAULT_ALLOWED_EXTENSIONS = ["pdf", "xls", "xlsx", "xlsm", "csv", "doc", "docx", "jpg", "jpeg", "png", "heic", "zip"];

export const APP_ROLE: Record<AppRole, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  staff: "Firm staff",
  client: "Client",
};

export const isAdminRole = (r?: AppRole | null) => r === "admin" || r === "super_admin";

export const SAMPLE_STATUS: Record<SampleLineStatus, { team: string; client: string; variant: BadgeVariant }> = {
  outstanding: { team: "Outstanding", client: "Outstanding", variant: "muted" },
  provided: { team: "Provided – to check", client: "Provided", variant: "info" },
  received: { team: "Received", client: "Received", variant: "success" },
  queried: { team: "Queried", client: "Action needed", variant: "warning" },
  not_applicable: { team: "N/A", client: "Not required", variant: "outline" },
};
