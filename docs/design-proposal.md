# Kreston Pedabo PBC Portal — Design Proposal (for confirmation before Phase 1)

Version 0.1 · 24 Sep 2026 · Prepared for Isaac Adetunji

---

## 1. Understanding of the brief

A single-firm, secure web portal that replaces Excel PBC trackers and email chasing. The firm issues a structured request list per engagement; clients upload against each item; the engagement team reviews (Accept / Query / N/A); everyone sees completion in real time.

| Area | What it must do |
|---|---|
| **Three interfaces** | Admin back office · Engagement team (Lead/Manager + Team Member) · Client portal |
| **Master checklist** | Admin library of standard items (code, guidance, category, default folder, applicable engagement types, expected file types, Critical flag). Versioned — edits never alter live engagements; engagements see a "master updated — pull changes?" notice. CSV/Excel import/export. |
| **Engagement creation** | Pick client from API-synced list → details auto-fill → choose type + period → system proposes list from master → lead customises items/folders, dates, assignees → invites client contacts. |
| **Item workflow** | Requested → Submitted → Under Review → Accepted \| Queried (back to client) \| N/A. Re-upload after query = new file version; old versions stay viewable. Full status history. |
| **Comments** | Threaded per item, @mentions, notifications, "Internal only" toggle hidden from clients. |
| **Acceptance gate** | Critical items = Pre-engagement stage. Engagement cannot enter *In Progress* until every critical item is Accepted or waived by the Lead with a mandatory reason, and a Go decision (with note, who, when) is recorded. |
| **Engagement lifecycle** | Draft → Pre-engagement → Acceptance Review → Accepted / Declined → In Progress → Completed → Archived |
| **Dashboards** | Engagement: % accepted, % submitted, critical % (prominent), by-folder bars, overdue / awaiting review / queried. Firm-wide: all engagements with filters. Excel/PDF export. |
| **Storage** | Files go to SharePoint via Microsoft Graph at `/PBC/{Client}/{EngagementCode}/{Folder}/{ItemCode}_{FileName}_v{n}`. Users never see SharePoint; downloads are served through a permission-checked app route. |
| **Integrations** | Client DB REST API behind an adapter (mock first). Email via Resend or Graph mail (configurable). |
| **Security** | Supabase RLS, RBAC on every action, full audit trail, MFA for internal users, session timeout, file type/size validation. |

**Phase 1 scope (this build):** auth & roles, clients (mock API), master checklist, engagement creation, request list, client upload (stored in a private Supabase Storage bucket behind the same storage interface SharePoint will plug into), comments, item statuses, engagement dashboard.

---

## 2. Assumptions (please confirm or correct)

1. **Single tenant.** One firm (Kreston Pedabo). No multi-firm separation needed.
2. **Staff sign-in.** Internal users: email + password with optional TOTP MFA (admin can make it mandatory). Microsoft Entra ID SSO for staff is easy to add later via Supabase's Azure provider — recommended since you are on M365.
3. **Client sign-in.** Invited contacts set a password or use a magic link. One person (email) can be a contact of several clients (e.g. a group CFO) and sees only engagements they were explicitly granted.
4. **Client API is read-only source of truth.** The app never writes back. Sync on demand + nightly. Admin can create a "manual" client (flagged) if a client is not yet in the database.
5. **Copy-on-create.** Master items are copied into the engagement at creation, carrying `master_item_id` + `master_revision`. That is what makes "master updated, pull changes" possible without touching live engagements.
6. **Engagement code format:** `{TYPE}-{YYYY}-{NNNN}` e.g. `SA-2026-0012` (SA = Statutory Audit, TX = Tax, AD = Advisory, DD = Due Diligence). Configurable per engagement type.
7. **Critical items cannot be marked N/A** — they must be Accepted or Waived (waiver needs a reason, Lead only). Waivers apply to critical items only.
8. **Completion formulas**
   - Applicable items = all items − N/A
   - **% provided** = Accepted ÷ Applicable
   - **% submitted** = (Submitted + Under Review + Accepted) ÷ Applicable (Queried items don't count — they are back with the client)
   - **Critical %** = (Accepted + Waived critical) ÷ critical items
9. **File versioning is per submission round.** Each time the client submits against an item (first time, and after every query) the files uploaded form version *n*. Files are immutable once submitted; clients can remove a file only before they submit the round.
10. **Acceptance rights.** By default Lead and Manager can Accept; Team Members can move to Under Review / Queried and comment. A per-engagement switch "Final acceptance: Lead only" restricts it further.
11. **Declined engagements** go read-only and can be archived; only an Admin can reopen.
12. **Uploads:** default max 100 MB per file (admin-configurable); allowed: PDF, XLS/XLSX/CSV, DOC/DOCX, JPG/PNG/HEIC, ZIP. Large files upload in chunks (Graph upload sessions in Phase 2).
13. **Time zone:** all due dates and reminders in WAT (Africa/Lagos).
14. **Data location.** Supabase holds metadata only (items, statuses, comments, audit). Client documents live in the firm's own SharePoint tenant from Phase 2. Supabase region: nearest available (EU, London/Frankfurt) — worth a quick check against your NDPA 2023 / Kreston IT policy.
15. **Email:** Microsoft Graph `sendMail` from a shared mailbox (e.g. `pbc@…`) as the default, since you are already on M365; Resend as the alternative.

---

## 3. Proposed database schema (Postgres / Supabase)

Conventions: `uuid` primary keys (`gen_random_uuid()`), `timestamptz` timestamps, `created_at`/`updated_at` on every mutable table, snake_case, fixed value sets as Postgres ENUMs.

### 3.1 Enums

| Enum | Values |
|---|---|
| `app_role` | `admin`, `staff`, `client` |
| `team_role` | `lead`, `manager`, `member` |
| `engagement_status` | `draft`, `pre_engagement`, `acceptance_review`, `accepted`, `declined`, `in_progress`, `completed`, `archived` |
| `item_status` | `requested`, `submitted`, `under_review`, `accepted`, `queried`, `not_applicable` |
| `item_priority` | `low`, `normal`, `high`, `urgent` |
| `acceptance_decision_type` | `go`, `no_go` |
| `storage_provider` | `supabase`, `sharepoint` |
| `client_source` | `api`, `manual` |

> "Roles" from your list is modelled as two layers: a firm-wide `app_role` on the user (admin / staff / client) and a per-engagement `team_role` (lead / manager / member). This is simpler and safer than a free-form roles table, and matches how access actually works on an engagement.

### 3.2 People & access

**`profiles`** — one row per auth user (`auth.users`)
`id (pk, = auth.users.id)`, `full_name`, `email`, `phone`, `app_role`, `job_title`, `is_active`, `mfa_required bool`, `last_seen_at`

**`clients`** — synced from the client database API
`id`, `external_id (unique)`, `source client_source`, `name`, `rc_number`, `tin`, `industry`, `nature_of_business`, `address`, `year_end_month smallint`, `year_end_day smallint`, `email`, `phone`, `is_active`, `last_synced_at`, `raw jsonb` (last API payload)

**`client_contacts`**
`id`, `client_id → clients`, `user_id → profiles (nullable until invite accepted)`, `full_name`, `email`, `phone`, `position`, `is_primary`, `external_id`
Unique `(client_id, email)`

### 3.3 Master checklist (versioned)

**`engagement_types`** — `id`, `code` (SA/TX/AD/DD), `name`, `code_prefix`, `is_active`, `sort_order`

**`master_categories`** — `id`, `code`, `name`, `description`, `sort_order`, `is_active`
Seeded: General & Permanent File, Financial Statements & TB, Revenue, Receivables, Inventory, PPE, Payables & Accruals, Cash & Bank, Borrowings, Payroll & HR, Tax, Legal & Regulatory, Related Parties, Other

**`master_checklist_items`**
`id`, `code (unique)`, `category_id`, `title`, `guidance`, `default_folder`, `expected_file_types text[]`, `is_critical`, `default_priority`, `sort_order`, `is_active`, **`revision int`** (increments on every edit), `updated_by`

**`master_item_engagement_types`** — `(master_item_id, engagement_type_id)` join

**`master_item_revisions`** — immutable history: `id`, `master_item_id`, `revision`, `snapshot jsonb`, `changed_by`, `changed_at`
→ Drives the "master updated" notice: any engagement item whose `master_revision` < master's current `revision` is flagged; the lead can pull changes item by item.

### 3.4 Engagements

**`engagements`**
`id`, `code (unique)`, `client_id`, `engagement_type_id`, `name`, `period_start`, `period_end`, `status engagement_status`, `lead_id → profiles`, `lead_only_acceptance bool`, `max_upload_mb`, `sharepoint_folder_id`, `sharepoint_path`, status timestamps (`pre_engagement_at`, `acceptance_review_at`, `decided_at`, `fieldwork_started_at`, `completed_at`, `archived_at`), `created_by`

**`engagement_team`** — `(engagement_id, user_id)` pk, `team_role`, `added_by`, `added_at`

**`engagement_client_access`** — which contacts can see which engagement
`id`, `engagement_id`, `contact_id`, `invited_by`, `invited_at`, `first_login_at`, `revoked_at`

**`engagement_folders`**
`id`, `engagement_id`, `parent_id (nullable, for sub-folders)`, `name`, `sort_order`, `sharepoint_folder_id`, `storage_path`
Unique `(engagement_id, parent_id, name)`

### 3.5 Request items, files, comments

**`request_items`**
`id`, `engagement_id`, `folder_id`, `category_id`, `master_item_id (nullable for custom)`, `master_revision`, `code`, `title`, `guidance`, `expected_file_types text[]`, `is_critical`, `priority`, `status item_status`, `assignee_id → profiles`, `due_date date`, `current_version int default 0`, `sort_order`,
waiver: `is_waived`, `waiver_reason`, `waived_by`, `waived_at`,
timing: `issued_at`, `last_submitted_at`, `accepted_at`, `accepted_by`
Constraints: waiver requires reason and `is_critical`; `is_critical` items cannot be `not_applicable`.

**`request_item_files`**
`id`, `request_item_id`, `version_no` (submission round), `file_name`, `mime_type`, `size_bytes`, `sha256`, `storage_provider`, `storage_path`, `sharepoint_drive_id`, `sharepoint_item_id`, `uploaded_by`, `uploaded_at`, `submitted_at (null = draft, still removable)`, `upload_state` (`pending` / `stored` / `failed`)

**`comments`**
`id`, `request_item_id`, `parent_id (threading)`, `author_id`, `body`, `is_internal bool`, `mentions uuid[]`, `edited_at`, `deleted_at` (soft delete — audit)

**`status_history`** — one table for items and engagements
`id`, `entity_type` (`request_item` / `engagement`), `entity_id`, `engagement_id`, `from_status`, `to_status`, `note`, `changed_by`, `changed_at`

**`acceptance_decisions`**
`id`, `engagement_id`, `decision`, `note (required)`, `critical_total`, `critical_satisfied`, `critical_pct`, `outstanding_items jsonb` (snapshot at decision time), `decided_by`, `decided_at`

### 3.6 Notifications, configuration, audit

**`notifications`** — `id`, `user_id`, `type`, `title`, `body`, `link`, `engagement_id`, `request_item_id`, `read_at`, `emailed_at`, `created_at`

**`reminder_rules`** (Phase 2) — `id`, `name`, `engagement_type_id (nullable = all)`, `days_before_due int[]`, `overdue_every_days`, `weekly_digest_weekday`, `is_active`

**`email_templates`** (Phase 2) — `key (pk)`, `subject`, `body_html`, `updated_by`

**`app_settings`** — `key (pk)`, `value jsonb`: brand colours, logo, default max upload, allowed file types, session timeout, non-secret SharePoint IDs (site/drive). Secrets stay in environment variables only.

**`audit_log`** — append-only (no update/delete granted to anyone)
`id bigint identity`, `occurred_at`, `actor_id`, `actor_role`, `action` (e.g. `item.status_changed`, `file.uploaded`, `item.waived`, `engagement.decision`), `entity_type`, `entity_id`, `engagement_id`, `before jsonb`, `after jsonb`, `ip`, `user_agent`
Written by database triggers on the key tables, so nothing bypasses it.

### 3.7 Views for dashboards

- **`v_engagement_progress`** — per engagement: total, applicable, accepted, submitted, queried, under_review, overdue, critical_total, critical_satisfied, `pct_provided`, `pct_submitted`, `pct_critical`, `days_in_pre_engagement`
- **`v_folder_progress`** — same counts per folder
- Views run with `security_invoker = on`, so RLS still applies to whoever queries them.

---

## 4. Security model (RLS summary)

Helper functions (`security definer`, stable): `is_admin()`, `is_staff()`, `is_engagement_member(eid)`, `can_accept(eid)`, `is_engagement_client(eid)`. (Superseded in part by migration 0008: see the addendum below. Engagement visibility is permission-based via `view_all_engagements` — on by default for Super admins and Admins, off for Staff; locked requests are filtered by `can_view_request_item()`.)

| Table | Admin | Staff (on team) | Client (granted contact) |
|---|---|---|---|
| clients / contacts | all | read | own client only (read) |
| master checklist | all | read | none |
| engagements | all | read; lead/manager update | read own, never `draft` |
| request_items | all | read/update | read own engagement's items (not in `draft`); **no direct update** |
| request_item_files | all | read | read/insert on own items; delete only own unsubmitted |
| comments | all | all on engagement | read where `is_internal = false`; insert with `is_internal` forced to false |
| acceptance_decisions, status_history | read | read | none |
| audit_log | read | none | none |

**State changes go through database functions, not raw updates**, so the rules hold no matter which screen or API calls them:
`submit_item()` (client), `review_item(accept | query | na)`, `waive_item(reason)`, `record_acceptance_decision(go | no_go, note)`, `transition_engagement(to_status)`.
`transition_engagement` refuses **In Progress** unless every critical item is Accepted or Waived and the latest decision is Go.

Files are never exposed by storage URL. The download route checks access in the database, then streams the file (Phase 1: Supabase private bucket; Phase 2: SharePoint via Graph).

---

## 5. Phase 1 build plan

| # | Deliverable |
|---|---|
| 1 | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui scaffold, theme tokens for brand colours |
| 2 | Supabase migrations: enums, tables, RLS, functions, triggers, views; seed (master checklist ~80 items across 14 categories, 4 engagement types, demo client, demo engagement, demo users) |
| 3 | Auth: login, magic link, invite acceptance, role-based routing, session timeout |
| 4 | `ClientDirectory` interface + `MockClientDirectory` (+ stub `RestClientDirectory` reading env vars); admin client sync screen |
| 5 | `StorageProvider` interface + `SupabaseStorageProvider` (SharePoint provider slots in Phase 2) |
| 6 | Admin: users, master checklist CRUD, CSV import/export |
| 7 | Team: engagement list, New Engagement wizard, request list editor (folders, items, bulk assign / due date / N/A), review actions |
| 8 | Client portal: single-page request list by folder, drag-and-drop multi-upload (mobile friendly), comments, progress |
| 9 | Comments with threads, internal toggle, @mentions, in-app notifications |
| 10 | Engagement dashboard (team + simplified client view) |
| 11 | `.env.example`, README (local setup, deployment, admin guide) |

---

## Addendum: Phase 1.1 (migration `20260925000005_groups_approval_samples.sql`)

| Change | Detail |
|---|---|
| `app_role` | `super_admin`, `admin`, `staff`, `client`. Only a super admin can grant or revoke admin. The last active super admin is protected. |
| `client_groups`, `clients.group_id` | Groups of entities. A contact can be linked to several entities, and the portal aggregates them per group. |
| `engagement_status.awaiting_approval` | Draft → Awaiting approval → (approved) Pre-engagement. Fields: `approval_requested_at/by`, `approved_at/by`. RPCs: `submit_list_for_approval` and `return_list_to_preparer`. `issue_request_list` is restricted to the lead or a manager. Clients can't see either pre-release status. |
| `can_edit_request_list()` | Members can edit while the list is in Draft. Once it is awaiting approval, only the lead and managers can edit. |
| `request_item_files.kind` | `client_submission`, `firm_document` (team-only upload, visible to the client) or `sample_support`. |
| `sample_schedules`, `sample_lines` | One schedule per item with 1–15 pasted columns. Each line has cells, a `sample_line_status` (outstanding, provided, received, queried, not_applicable), its own files and comments (`sample_line_id`). The client can only set a line to *provided*. The team confirms it as received or queries it (a note is required and is posted as a comment). View: `v_sample_progress`. |

---

## Addendum: Phase 1.2 engagement workspace (migration `20261003000006_workspace_docs_calendar.sql`)

| Change | Detail |
|---|---|
| Engagement shell for clients | New helper `has_engagement_client_access(eid)`: an active client user granted (not revoked) on the engagement, **whatever its status**. `can_view_engagement_shell(eid)` = team member or that. Used by the `engagements`, `engagement_team` and `profiles` (team members) SELECT policies, and to let a client read fellow client users on the engagement (`client_contacts`, `engagement_client_access`; via the SECURITY DEFINER `is_engagement_peer_contact()` to avoid policy recursion). `is_engagement_client()` (released only) still gates folders, items, files, comments, samples and documents. The portal labels draft / awaiting-approval engagements **Being prepared**. |
| Default client access | `create_engagement(…, p_planned_start, p_documents_due, p_report_due, p_client_contact_ids uuid[] default null)`. `null` grants every contact of the client with an active client portal account; an array grants exactly those (empty = nobody). The wizard sends the ticked list. |
| Planned dates | `engagements.planned_start`, `documents_due`, `report_due` (column grants for lead/manager updates). |
| `engagement_documents` | `id, engagement_id, uploaded_by, side document_side('firm','client'), file_name, mime_type, size_bytes, storage_provider, storage_path, sha256, description, upload_state, created_at, deleted_at, deleted_by`. No direct writes. `begin_document_upload()` checks team or released client, validates type/size against settings, **derives the side from the caller**, reserves `{storage_root}/_Additional documents/{FIRM|CLIENT}_{name}.{ext}`. `complete_document_upload()` (service role, after verifying the object) marks it stored and notifies the other side. `delete_engagement_document()` soft-deletes (uploader or lead/manager). RLS: team sees all (including deleted); clients see stored, non-deleted documents on released engagements. Audit trigger and realtime. Download: `/api/documents/[id]`. |
| `engagement_events` | `title, kind event_kind('deadline','filing','meeting','milestone','client_request','other'), starts_on, ends_on (≥ starts_on), notes, visible_to_client, created_by (set by trigger)`. Team members insert/update/delete; clients read `visible_to_client` events of engagements they have access to, also before release. Audit trigger and realtime. |
| Sample schedules | `sample_schedules.columns` check raised to 1–50. `create_sample_schedule()` rejects more than 50 columns (the UI keeps the first 50 and warns); `add_sample_lines()` already pads/trims cells to the schedule's columns. |
| Attachments ZIP | `/api/engagements/[id]/attachments?side=client|firm[&ids=…]` reads the permitted rows with the user's session (RLS), refuses over 500 MB (413), then streams a ZIP (fflate, stored entries, with backpressure) built from objects fetched with the service role: `{Folder}/{Code} {Title}/v{n} {file}`, `…/Samples/L{n} {file}`, `Additional documents/{file}`, `manifest.csv`. |

## Addendum: access, team roles, assignment & stages (migration `20261024000008_access_assignment_stages.sql`)

| Change | Detail |
|---|---|
| `team_role` | `+ partner` (labels: Engagement partner, Team lead, Manager, Team member). Partial unique index: one `lead` per engagement; a trigger keeps `engagements.lead_id` in sync; `set_engagement_lead(engagement, user)` (Super admin, partner, lead or manager) demotes the previous lead to manager. Team rows must be active firm users; partner rows are changed only by a partner, the lead or a Super admin |
| Visibility helpers | Per-user (service role): `user_can_view_engagement_firm`, `user_is_engagement_client`, `user_has_app_permission`, `can_user_view_request_item(p_user, p_item)`. Current user: `is_engagement_member` (team, creator, `view_all_engagements`, Super admin), `is_engagement_team` (works on it), `can_manage_engagement` (partner/lead/manager), `is_engagement_lead` (partner/lead), `can_view_request_item(p_item)` |
| Policies | `is_admin()` replaced: engagement types, settings, e-mail templates, reminder rules and the audit log → `is_super_admin()`; master checklist → `manage_checklist`; client contacts → `manage_clients` or a manager of an engagement of that client |
| `create_engagement` | Same signature; needs `create_engagements`; `p_lead_id` required; `p_team` roles `partner / manager / member`; the caller is not added |
| Codes | `app_settings.engagement_code_format` (default `{PREFIX}-{YYYY}-{SEQ4}`; tokens `{PREFIX} {YYYY} {YY} {SEQ} {SEQ3..6}`), validated by `valid_engagement_code_format()`; counters keyed by (prefix, year), year 0 / prefix `*` when the format lacks them |
| `request_item_assignees` | `(request_item_id, user_id)` PK, `engagement_id`, `side firm/client` (from the user's role), `assigned_by`, `assigned_at`. `request_items.assignee_id` migrated and dropped. Writes only via `set_request_item_assignees(item, side, users[])` and `add_request_item(..., p_is_locked, p_firm_assignee_ids, p_client_assignee_ids)` |
| Locking | `request_items.is_locked`, `created_by`; `set_request_item_lock(item, bool)`. Locked: clients only if a client assignee; firm: firm assignees, partners, lead, managers, the creator, Super admin |
| Stages | Main flow `draft → awaiting_approval → pre_engagement → in_progress → completed` (+ `archived`); `acceptance_review / accepted / declined` kept but shown as Pre-execution. `transition_engagement` enforces the critical gate (all critical items, locked included) and the completion rule (open items: partner/lead with a reason, written to the status history and audit log). `app_settings.stage_labels` + `stage_label(status)` |

## Addendum: checklist taxonomy & notifications (migration `20261024000009_checklist_notifications.sql`)

| Change | Detail |
|---|---|
| `item_priority` | `'high'` renamed `'important'`: `low, normal, important, urgent`. Function bodies casting `'high'` are rewritten by the migration |
| `file_class` enum | `permanent`, `current`; nullable `file_class` on `master_checklist_items` and `request_items`. A `BEFORE INSERT` trigger on `request_items` copies it from the master item; pulling master changes refreshes it. Part of the master revision |
| `expected_file_types` | Kept (deprecated), no longer edited or shown in the master checklist. Uploads were and are validated against the firm-wide allowed types/size only |
| `master_folders` | `id, name (unique, case-insensitive), sort_order, is_active`. Saving a master item with a new folder name adds it. `rename_master_folder()` renames and updates master items without new revisions |
| Checklist permissions | Inserts/updates on `master_categories`, `master_folders`, `master_checklist_items`, `master_item_engagement_types` require `has_app_permission('manage_checklist')`. Category `code` is not updatable |
| `app_settings` writes | Super admin only (`is_super_admin()`). New key `notifications.defaults` |
| `engagement_notification_settings` | One row per engagement (created from the defaults by trigger): `client_instant, client_reminder_frequency (off/daily/weekdays/weekly), client_reminder_weekday (ISO 1–7), client_reminder_time, client_only_when_outstanding, team_instant, team_reminder_frequency, team_reminder_weekday, team_reminder_time`. Read: team members; write: `can_manage_engagement()`. Clients have no access |
| `notifications` | `+ email_error, email_attempts, email_skipped` (with `emailed_at` from 0001). Rows existing at migration time are marked as not to be e-mailed |
| `reminder_log` | `(engagement_id, user_id, audience, local_date)` unique, `status sent/failed/skipped`: makes reminders idempotent per Lagos day |
| Service-role functions | `email_dispatch_queue()`, `mark_notifications_emailed()`, `reminder_digests_due(now)`, `record_reminder()`, `reminder_is_due()`. Visibility of every item goes through `can_user_view_request_item(user, item)` (0008), so locked items never leak into e-mails |

## Addendum: refinements

| Change | Detail |
|---|---|
| Admin default visibility | `default_role_permissions()` (migration 0007) sets Admin `view_all_engagements = true` (Staff stays `false`). Super admins and Admins see every engagement by default; a Super admin can switch it off per role in **Settings > Access**. The mirror `DEFAULT_ROLE_PERMISSIONS` in `lib/permissions.ts` matches |
| Default folders | `supabase/seed.sql` seeds both `01 Permanent File` and `Current File` among the managed `master_folders`, plus the section folders `15 Journals … 18 IT Environment`. Folders stay user-managed |
| Standard sections | Seed adds the categories/items **Tests of journals** (`JNL`), **Accounting estimates** (`EST`), **Going concern assessment** (`GCA`) and **IT environment** (`ITE`), upserted by code so existing databases update on re-seed |
| Progress colours | `lib/progress.ts`: red < 30%, blue 30–69% (info tone `--info-bar`), green ≥ 70%. One rule for every bar/figure (dashboards, folder bars, group summary, lists) and the `<ProgressLegend>` |
| Client wording | `Request in progress` (was "being prepared"), portal tab `Outstanding` (was "To do"), critical client badge `Critical` (was "Needed first") |
| Notification scheduler | `/api/cron/dispatch` is called by the Netlify scheduled function, GitHub Actions, **or** `scripts/dispatch-cron.sh` (plain server cron / MochaHost VPS, exits non-zero on failure) |
