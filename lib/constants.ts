import type { AppRole, EngagementStatus, EventKind, ItemPriority, ItemStatus, SampleLineStatus, TeamRole } from "./types";

/** Badge tones (components/ui/badge.tsx). One meaning per tone across the app. */
export type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "danger" | "info" | "review" | "steel" | "ochre" | "urgent" | "brand" | "muted";

export const ITEM_STATUS: Record<ItemStatus, { label: string; clientLabel: string; variant: BadgeVariant }> = {
  requested: { label: "Requested", clientLabel: "To provide", variant: "muted" },
  submitted: { label: "Submitted", clientLabel: "Submitted", variant: "info" },
  under_review: { label: "Under review", clientLabel: "Under review", variant: "review" },
  accepted: { label: "Accepted", clientLabel: "Complete", variant: "success" },
  queried: { label: "Queried", clientLabel: "Action needed", variant: "warning" },
  not_applicable: { label: "N/A", clientLabel: "Not required", variant: "outline" },
};

export const ITEM_STATUS_ORDER: ItemStatus[] = [
  "requested", "queried", "submitted", "under_review", "accepted", "not_applicable",
];

/**
 * Status pill styling and stepper position. Labels are the DEFAULT stage names;
 * the displayed names come from app_settings 'stage_labels' (lib/stages.ts,
 * <StageLabelsProvider>). acceptance_review / accepted / declined are legacy
 * values shown as Pre-execution.
 */
export const ENGAGEMENT_STATUS: Record<EngagementStatus, { label: string; variant: BadgeVariant; step: number }> = {
  draft: { label: "Draft", variant: "muted", step: 0 },
  awaiting_approval: { label: "Approval", variant: "review", step: 1 },
  pre_engagement: { label: "Pre-execution", variant: "steel", step: 2 },
  acceptance_review: { label: "Pre-execution", variant: "steel", step: 2 },
  accepted: { label: "Pre-execution", variant: "steel", step: 2 },
  declined: { label: "Pre-execution", variant: "steel", step: 2 },
  in_progress: { label: "Execution", variant: "brand", step: 3 },
  completed: { label: "Completed", variant: "success", step: 4 },
  archived: { label: "Archived", variant: "muted", step: 5 },
};

export const PRIORITY: Record<ItemPriority, { label: string; variant: BadgeVariant }> = {
  low: { label: "Low", variant: "muted" },
  normal: { label: "Normal", variant: "outline" },
  important: { label: "Important", variant: "ochre" },
  urgent: { label: "Urgent", variant: "urgent" },
};

export const TEAM_ROLE: Record<TeamRole, string> = {
  partner: "Engagement partner",
  lead: "Team lead",
  manager: "Manager",
  member: "Team member",
};
export const TEAM_ROLE_ORDER: TeamRole[] = ["partner", "lead", "manager", "member"];

/** Hierarchy rank (mirrors public.team_rank): partner > manager > lead > member.
 *  Drives lock seniority in the UI; the database is the security boundary. */
export const TEAM_RANK: Record<TeamRole, number> = { partner: 4, manager: 3, lead: 2, member: 1 };

export const PRIORITY_ORDER: ItemPriority[] = ["low", "normal", "important", "urgent"];

/** Clients see unreleased engagements (draft / awaiting approval) as this. */
export const REQUEST_IN_PROGRESS = "Request in progress";
export const REQUEST_IN_PROGRESS_MESSAGE = "Your engagement team is preparing the request list. You'll be notified when it is released.";

export const EVENT_KIND: Record<EventKind, { label: string; dot: string; chip: string }> = {
  deadline: { label: "Deadline", dot: "bg-danger-bar", chip: "bg-danger-soft text-danger" },
  filing: { label: "Regulatory filing", dot: "bg-info-bar", chip: "bg-info-soft text-info" },
  meeting: { label: "Meeting", dot: "bg-[var(--review)]", chip: "bg-review-soft text-review" },
  milestone: { label: "Milestone", dot: "bg-success-bar", chip: "bg-success-soft text-success" },
  client_request: { label: "Client request", dot: "bg-warning-bar", chip: "bg-warning-soft text-warning" },
  other: { label: "Other", dot: "bg-neutral", chip: "bg-neutral-soft text-neutral" },
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
