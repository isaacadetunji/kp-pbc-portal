// Domain types mirroring the Postgres schema (supabase/migrations).
export type AppRole = "super_admin" | "admin" | "staff" | "client";
export type TeamRole = "partner" | "lead" | "manager" | "member";
export type EngagementStatus =
  | "draft" | "awaiting_approval" | "pre_engagement" | "acceptance_review" | "accepted" | "declined"
  | "in_progress" | "completed" | "archived";
export type ItemStatus = "requested" | "submitted" | "under_review" | "accepted" | "queried" | "not_applicable";
/** 0009 renamed the database value "high" to "important". */
export type ItemPriority = "low" | "normal" | "important" | "urgent";
export type ReviewAction = "start_review" | "accept" | "query" | "not_applicable" | "reopen";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  app_role: AppRole;
  job_title: string | null;
  is_active: boolean;
  mfa_required: boolean;
  last_seen_at: string | null;
  created_at: string;
}

export interface Client {
  id: string;
  external_id: string | null;
  source: "api" | "manual";
  name: string;
  rc_number: string | null;
  tin: string | null;
  industry: string | null;
  nature_of_business: string | null;
  address: string | null;
  year_end_month: number | null;
  year_end_day: number | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  group_id: string | null;
}

export interface ClientGroup {
  id: string;
  name: string;
}

export interface ClientContact {
  id: string;
  client_id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  position: string | null;
  is_primary: boolean;
}

export interface EngagementType {
  id: string;
  code: string;
  name: string;
  code_prefix: string;
  is_active: boolean;
  sort_order: number;
}

export interface MasterCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface MasterItem {
  id: string;
  code: string;
  category_id: string;
  title: string;
  guidance: string | null;
  default_folder: string;
  expected_file_types: string[];
  is_critical: boolean;
  default_priority: ItemPriority;
  sort_order: number;
  is_active: boolean;
  revision: number;
  updated_at: string;
  master_item_engagement_types?: { engagement_type_id: string }[];
}

export interface Engagement {
  id: string;
  created_by: string | null;
  code: string;
  client_id: string;
  engagement_type_id: string;
  name: string;
  period_start: string | null;
  period_end: string;
  status: EngagementStatus;
  lead_id: string;
  approval_requested_at: string | null;
  approval_requested_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  lead_only_acceptance: boolean;
  max_upload_mb: number | null;
  storage_root: string | null;
  pre_engagement_at: string | null;
  fieldwork_started_at: string | null;
  planned_start: string | null;
  documents_due: string | null;
  report_due: string | null;
  created_at: string;
  updated_at: string;
}

export interface Folder {
  id: string;
  engagement_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
}

export interface RequestItem {
  id: string;
  engagement_id: string;
  folder_id: string;
  category_id: string | null;
  master_item_id: string | null;
  master_revision: number | null;
  code: string;
  title: string;
  guidance: string | null;
  expected_file_types: string[];
  is_critical: boolean;
  priority: ItemPriority;
  status: ItemStatus;
  due_date: string | null;
  current_version: number;
  sort_order: number;
  is_waived: boolean;
  waiver_reason: string | null;
  waived_at: string | null;
  issued_at: string | null;
  last_submitted_at: string | null;
  accepted_at: string | null;
  updated_at: string;
  /** Locked: only assignees (plus partners, the lead, managers and the creator) can see it. */
  is_locked: boolean;
  /** Who added the item individually (null for items from the master checklist). */
  created_by: string | null;
  /** Permanent / current file (column added by 0009). */
  file_class?: "permanent" | "current" | null;
}

export type AssigneeSide = "firm" | "client";

export interface ItemAssignee {
  request_item_id: string;
  user_id: string;
  side: AssigneeSide;
  assigned_by: string | null;
  assigned_at: string;
}

export interface ItemFile {
  id: string;
  request_item_id: string;
  version_no: number;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  sha256: string | null;
  upload_state: "pending" | "stored" | "failed";
  uploaded_by: string;
  uploaded_at: string;
  submitted_at: string | null;
  kind: FileKind;
  sample_line_id: string | null;
}

export type FileKind = "client_submission" | "firm_document" | "sample_support";
export type SampleLineStatus = "outstanding" | "provided" | "received" | "queried" | "not_applicable";

export interface SampleSchedule {
  id: string;
  request_item_id: string;
  engagement_id: string;
  title: string;
  instructions: string | null;
  columns: string[];
  created_at: string;
}

export interface SampleLine {
  id: string;
  schedule_id: string;
  request_item_id: string;
  line_no: number;
  cells: string[];
  status: SampleLineStatus;
  status_note: string | null;
  status_at: string | null;
}

export interface SampleProgress {
  schedule_id: string;
  request_item_id: string;
  total_lines: number;
  outstanding_lines: number;
  provided_lines: number;
  received_lines: number;
  queried_lines: number;
  na_lines: number;
}

export interface Comment {
  id: string;
  request_item_id: string;
  engagement_id: string;
  parent_id: string | null;
  author_id: string;
  body: string;
  is_internal: boolean;
  mentions: string[];
  sample_line_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface StatusHistory {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  changed_by: string | null;
  changed_at: string;
}

export interface EngagementProgress {
  engagement_id: string;
  total_items: number;
  applicable_items: number;
  accepted_items: number;
  submitted_items: number;
  awaiting_review_items: number;
  queried_items: number;
  requested_items: number;
  na_items: number;
  overdue_items: number;
  critical_total: number;
  critical_satisfied: number;
  critical_submitted: number;
  pct_provided: number;
  pct_submitted: number;
  pct_critical: number | null;
  days_in_pre_engagement: number | null;
}

export interface FolderProgress {
  engagement_id: string;
  folder_id: string;
  folder_name: string;
  sort_order: number;
  total_items: number;
  applicable_items: number;
  accepted_items: number;
  submitted_items: number;
  queried_items: number;
  overdue_items: number;
  pct_provided: number;
  pct_submitted: number;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export type DocumentSide = "firm" | "client";

export interface EngagementDocument {
  id: string;
  engagement_id: string;
  uploaded_by: string;
  side: DocumentSide;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  storage_path: string;
  sha256: string | null;
  description: string | null;
  upload_state: "pending" | "stored" | "failed";
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export type EventKind = "deadline" | "filing" | "meeting" | "milestone" | "client_request" | "other";

export interface EngagementEvent {
  id: string;
  engagement_id: string;
  title: string;
  kind: EventKind;
  starts_on: string;
  ends_on: string | null;
  notes: string | null;
  visible_to_client: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Minimal person record for display */
export interface Person {
  id: string;
  full_name: string;
  email: string;
  app_role?: AppRole;
  phone?: string | null;
  job_title?: string | null;
}

// ---------------------------------------------------------------------------
// 0009: checklist taxonomy, file classes, notification settings (Agent B)
// ---------------------------------------------------------------------------
export type FileClass = "permanent" | "current";

export interface MasterFolder {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export type ReminderFrequency = "off" | "daily" | "weekdays" | "weekly";

/** Per-engagement notification settings; times are Africa/Lagos, weekdays ISO (1 = Monday). */
export interface NotificationSettings {
  client_instant: boolean;
  client_reminder_frequency: ReminderFrequency;
  client_reminder_weekday: number;
  client_reminder_time: string;
  client_only_when_outstanding: boolean;
  team_instant: boolean;
  team_reminder_frequency: ReminderFrequency;
  team_reminder_weekday: number;
  team_reminder_time: string;
}

export interface EngagementNotificationSettings extends NotificationSettings {
  engagement_id: string;
  updated_by: string | null;
  updated_at: string;
}

/** Master items as read with the 0009 columns. */
export type MasterItemWithClass = MasterItem & { file_class: FileClass | null };
