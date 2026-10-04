# Kreston Pedabo PBC Portal

A secure web platform for Prepared-By-Client (PBC) information requests. The firm issues a structured request list per engagement, clients upload against each item from any device, and the engagement team reviews, queries and tracks completion in real time. It replaces Excel PBC trackers and email back-and-forth.

**Status: Phase 1 complete, plus 1.1 and the 1.2 engagement workspace.** See [Roadmap](#roadmap) for Phases 2 and 3.

| | |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix) |
| Backend | Supabase: Postgres, Row Level Security, Auth (password, magic link, TOTP MFA), Storage, Realtime |
| Documents | Phase 1: private Supabase Storage bucket. Phase 2: SharePoint via Microsoft Graph (same interface) |
| Client master data | Client database REST API behind an adapter (mock included) |

---

## Contents

1. [What's in Phase 1](#whats-in-phase-1) (and [1.1](#whats-in-phase-11), [1.2](#whats-in-phase-12-engagement-workspace))
2. [Architecture](#architecture)
3. [Local setup](#local-setup)
4. [Deployment](#deployment)
5. [Connecting the client database API](#connecting-the-client-database-api)
6. [Administrator guide](#administrator-guide)
7. [Engagement team guide](#engagement-team-guide)
8. [Security model](#security-model)
9. [Testing](#testing)
10. [Project structure](#project-structure)
11. [Roadmap](#roadmap)

---

## What's in Phase 1

- **Auth & roles.** Email and password, magic link, invitations and password reset. Optional TOTP MFA, which can be required per user or firm-wide. Idle session timeout. Three interfaces: Administrator, Engagement team (lead, manager, member) and Client.
- **Clients.** Synced from the client database through an adapter. The mock adapter ships with 8 sample Nigerian companies. Admins can add flagged "manual" clients.
- **Master checklist.** 78 standard items across 14 categories, mapped to engagement types (Statutory Audit, Tax, Advisory, Due Diligence). Includes a critical flag, guidance, default folder and expected file types. Admins can create, edit and deactivate items. CSV and Excel import/export. **Versioned:** every edit creates a revision. Live engagements are untouched and show a "master updated, pull changes" notice.
- **Engagement creation wizard.** Search a client → details auto-fill → choose type and period (defaults from the client's year end) → pick the lead and team → the proposed request list comes from the master checklist → create as a draft.
- **Request list (team).** Items are grouped by folder. You can search and filter by status, folder, assignee, critical or overdue. Bulk actions: assign, due date, priority, move folder, N/A, accept. You can add custom items, standard items and folders, and rename or delete folders. Issuing the list to the client notifies them.
- **Item workflow.** Requested → Submitted → Under review → Accepted, Queried or N/A. Reopen is supported. A query requires a note, which the client sees. Critical items can't be N/A; only the lead can waive them, with a mandatory reason. Every re-upload after a query creates a new file version, and earlier versions stay viewable. Full status history.
- **Client uploads.** Drag and drop, multiple files, mobile friendly. Files go straight to storage through a single-use signed upload. Type and size are validated in the browser and again in the database. Files are hashed with SHA-256. The client can add an optional note and submit.
- **Comments on every item.** Threaded, with @mentions of team members and an "internal only" toggle. Clients can never see or create internal comments. This is enforced in the database.
- **Notifications.** In-app bell with live updates for issued lists, uploads, queries, acceptances, comments and mentions.
- **Dashboards.** The engagement dashboard shows critical % prominently, % provided, % submitted, completion by folder, critical items outstanding, overdue items, items awaiting review and queried items. The client gets a simplified progress view. The staff home dashboard shows my engagements and items awaiting my review. Updates arrive live through Supabase Realtime.
- **Audit trail.** Every insert, update and delete on engagements, items, files, comments, decisions, team, client access, folders, the master checklist, users, clients and settings is written by trigger with the actor, IP and user agent. The log is append-only.
- **Acceptance gate (database layer).** The rules are already enforced in Postgres: you can't reach fieldwork without all critical items accepted or waived plus a recorded Go decision. The Acceptance Review screen is Phase 2.

## What's in Phase 1.1

- **Super Admin and Admins.** Super Admins appoint and remove Admins. At least one active Super Admin must always remain. Admins handle day-to-day work: users, clients, the checklist and settings. Both use the admin portal.
- **Staff access.** Admins add staff by email. Staff finish sign-up by setting a password from the invitation, or sign in with an emailed link. Staff see only the engagements they're assigned to.
- **Client groups.** Clients can be grouped, e.g. Adebayo Group with three entities. Groups come from the client database (`groupName`) or are set by hand under **Admin > Clients**. One client contact can be given access to several entities in the group. The client portal shows a group summary card plus each entity separately.
- **Preparer → reviewer approval.** The team builds the list from the template, edits it and sets critical items. It then goes through two steps:
  - A team member clicks **Submit for approval**, and the list becomes **Awaiting approval**.
  - The lead or a manager clicks **Approve & release to client**, or **Return with comments**.

  Clients never see Draft or Awaiting approval lists. Leads and managers can also approve a draft directly.
- **Firm documents.** On any item, the team can upload files for the client, such as a sample Excel template. They appear under "From the engagement team". Only the firm can upload them, and the client is notified.
- **Sample schedules.** Paste a sample from Excel into any item: up to 15 columns, headers taken from the first row, up to 1,000 lines per paste. Each line has:
  - A status: Outstanding, Provided, Received, Queried or N/A.
  - Its own comment thread and its own uploads.

  The client uploads per line, and the line becomes **Provided**. The team confirms it as **Received**, or **Queries** it with a note the client sees. You can filter and sort by status, make bulk changes, and use **Copy for Excel**. The request list shows "Samples x/y received".

## What's in Phase 1.2: engagement workspace

- **Vertical engagement list.** **Engagements** lists your engagements as collapsible client folders (client name and count), each engagement shown as e.g. *FY2025 · Statutory audit* with its status and progress. Staff only ever see engagements they are assigned to (enforced by RLS). Administrators get an **All engagements** switch. Staff with no assignments see "You haven't been added to an engagement yet. An administrator will assign you."
- **Engagement workspace.** Inside an engagement, the same list is a collapsible left pane (a dropdown at the top on phones) so you can jump between engagements. Tabs, in order: **Requests · Dashboard · Additional documents · Calendar · Team · Attachments · Settings** (Settings for the lead, managers and admins only).
- **Clients see engagements before release.** Client users granted on an engagement see its shell straight away: name, code, type, period, team and client-visible calendar entries, labelled **Being prepared**. Folders, requests, files, comments and sample schedules stay hidden until the list is approved and released. When an engagement is created, every client user (contact with a portal account) of that client is granted access by default; the wizard shows them ticked and you can untick any.
- **Planned dates.** Planned start, documents due and report due are set in the wizard and editable under Settings. They appear in the header and on the calendar.
- **Additional documents.** Engagement-level documents that don't belong to one request (engagement letter, timetable, board papers, management accounts). Both the team and the client (once released) can upload; both sides see everything. The side (*From the firm* / *From the client*) is derived from the uploader's role. Uploaders can delete their own documents; the lead and managers can delete any. Deletion is soft (kept for the record and visible to the team). The other side is notified.
- **Calendar.** Month view with previous/next/today and an **Upcoming** agenda. It combines engagement dates (planned start, documents due, report due, period end), request due dates (grouped per day; click to open the requests) and events the team adds: deadline, regulatory filing, meeting, milestone, client request or other, colour-coded with a legend. Each event can be hidden from the client. Clients get a read-only view of released requests' due dates and client-visible events (also while the engagement is being prepared).
- **Team.** Two sections: **Engagement team** (name, job title, role shown as Engagement lead / Manager / Member, email, phone; add, remove and change roles) and **Client team** (contacts with access: position, email, phone and portal status; invite, revoke and restore).
- **Attachments.** One page with everything the client has uploaded: request submissions (every version, latest flagged), sample-line support and client additional documents. Search, filter by folder and type, select, then **Download selected** or **Download all as ZIP**. The ZIP is laid out `{Folder}/{Request code} {Title}/v{n} {file}` (sample support under `Samples/L{line} {file}`) plus `Additional documents/{file}` and a `manifest.csv`. Clients see the same page for everything the firm has shared with them. ZIPs are capped at 500 MB.
- **Client portal.** The same tabs per engagement: Requests, a detailed **Dashboard** (per-folder bars, a "where you're behind" call-out, critical items still needed, overdue items), Additional documents, a read-only Calendar, Team and Attachments. The home page lists engagements vertically, grouped by entity, under the group summary card. Engagements being prepared show a message and only the Team and Calendar tabs.
- **Sample schedules: 50 columns, Excel/CSV upload.** The sample schedule tab is available on every request in every folder. Schedules take up to 50 columns (was 15) and 1,000 lines per paste. Besides pasting, you can **Upload Excel/CSV** (first worksheet of an `.xlsx`, or a `.csv`). The **New request** dialog has an optional **Sample schedule** section, so a request and its samples are created in one step.
- **Admin > Clients.** Click a client to open its detail panel: users (with position and portal status), engagements, **Add contact** and **New engagement** (opens the wizard with the client pre-selected).

## Branding

Kreston Pedabo logo (`public/kreston-pedabo-logo.png`) and colours from the logo: blue `#189CD8` and teal `#43BBC7`. Buttons and links use a deeper shade of the blue, `#0F77AD`, so white text on them stays readable (4.9:1 contrast). All of this is set under **Admin > Settings** and can be changed without a code change.

## Architecture

```
Browser ──► Next.js (Vercel)
  │           ├─ proxy.ts            session refresh, idle timeout, sign-in redirect
  │           ├─ Server Components   read data with the USER's session (RLS applies)
  │           ├─ Server Actions      invitations, uploads (signed targets), client sync, imports
  │           ├─ /api/files/[id]     permission-checked download (RLS read → stream from storage)
  │           ├─ /api/documents/[id] same, for additional documents
  │           └─ /api/engagements/[id]/attachments  RLS read of the rows → ZIP streamed from storage
  │
  ├──► Supabase PostgREST (anon key + user JWT) — reads, RPC workflow functions
  ├──► Supabase Storage — single-use signed upload URL only (no direct bucket access)
  └──► Supabase Realtime — live list/dashboard/notification refresh

Postgres
  ├─ RLS on every table (clients only see their engagements; never drafts, internal comments, history or audit)
  ├─ Workflow = SECURITY DEFINER functions (submit_item, review_item, waive_item, begin_upload, …)
  │   that re-check permissions; status columns are not writable by any API role
  ├─ Triggers: profiles from auth.users, status history, audit log, master revisions, notifications
  └─ Views (security_invoker): v_engagement_progress, v_folder_progress, v_master_updates
```

Key design choices:

- **The database is the security boundary.** The UI hides buttons for convenience only. Every permission is enforced by RLS or inside a workflow function, so a user calling the API directly gets the same answer as the UI.
- **Integration layers.** `lib/integrations/client-directory` (mock/REST) and `lib/storage` (Supabase now, SharePoint in Phase 2) are interfaces. Swapping implementations doesn't touch pages or the database.
- **Storage paths** follow `PBC/{Client}/{EngagementCode}/{Folder}/{ItemCode}_{FileName}_v{n}.{ext}`. Additional documents go to `PBC/{Client}/{EngagementCode}/_Additional documents/{FIRM|CLIENT}_{FileName}.{ext}`. They're computed in the database from sanitised names, so the same layout carries over to SharePoint.

The full data model is in [`docs/design-proposal.md`](docs/design-proposal.md) and [`supabase/migrations`](supabase/migrations).

## Local setup

Prerequisites: Node.js 22+, Docker, and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
supabase start                 # starts Postgres, Auth, Storage, Realtime, Studio, Inbucket
supabase db reset              # applies supabase/migrations + supabase/seed.sql
cp .env.example .env.local     # paste the API URL, anon key and service_role key printed by `supabase status`
npm run seed:demo              # demo users, client and an engagement with activity
npm run dev                    # http://localhost:3000
```

Demo accounts (password `DemoPass#2026`):

| Email | Role |
|---|---|
| super@demo.kp.test | Super Admin |
| admin@demo.kp.test | Administrator |
| lead@demo.kp.test | Engagement lead (Olumide Adeyemi) |
| manager@demo.kp.test | Manager (Ngozi Eze) |
| senior@demo.kp.test | Team member (Bayo Ogunleye) |
| cfo@demo.client.test | Client: Adebayo Group (Foods Plc, Agro Processing, Distribution). Sees the FY(this year) Foods audit as "Being prepared" |
| fc@demo.client.test | Client: Adebayo Foods Plc |

Emails sent locally (invitations, magic links) appear in Inbucket at http://localhost:54324.

## Deployment

**1. Supabase project**

1. Create a project. Choose the region closest to Lagos that your data policy allows (e.g. `eu-west-2` London). Supabase stores metadata only in Phase 1 and files too until SharePoint goes live, so confirm this against NDPA 2023 and firm IT policy.
2. Link and push the schema:
   ```bash
   supabase link --project-ref YOUR_REF
   supabase db push                       # applies migrations
   psql "$DATABASE_URL" -f supabase/seed.sql   # reference data + master checklist
   ```
3. **Auth settings.** Disable public sign-ups (invite only). Set the Site URL to your production URL and add `https://YOUR_DOMAIN/**` to redirect URLs. Set the minimum password length to 10. Enable TOTP MFA.
4. **Email templates.** Paste the three files in `supabase/templates/` into Auth > Email Templates (Invite, Magic Link, Reset Password). They link to `/auth/confirm` with a token hash, which server-side auth needs.
5. **SMTP.** Auth > SMTP: use a firm mailbox (e.g. Microsoft 365 `smtp.office365.com:587` with a licensed shared mailbox) so emails come from the firm's domain.
6. **Realtime.** The migration adds the tables to the `supabase_realtime` publication. Confirm it under Database > Replication.
7. **Storage.** The migration creates the private `pbc-files` bucket. Set the bucket's file size limit to match the portal setting.

**2. Next.js app (Vercel recommended; any Node 22 host works)**

1. Import the repository and set every variable from `.env.example` (production values).
2. Set `NEXT_PUBLIC_SITE_URL` to the production URL.
3. Deploy. The app is fully dynamic, so no build-time data is needed.
4. Create the first administrator. Invite yourself via the Supabase dashboard (Auth > Users > Invite), then run:
   ```sql
   update public.profiles set app_role = 'super_admin' where email = 'you@krestonpedabo.com';
   ```
   After that, add users from **Users & access** in the portal.

**Backups.** Enable Point-in-Time Recovery on the Supabase project for production. The audit log and file metadata live in Postgres.

## Connecting the client database API

1. Set `CLIENT_DIRECTORY_MODE=rest`, `CLIENT_API_BASE_URL` and `CLIENT_API_KEY`. Adjust `CLIENT_API_AUTH_HEADER` and `CLIENT_API_AUTH_SCHEME` if the API uses e.g. `x-api-key`.
2. The adapter reads a JSON array, or `{ data | items | results | clients: [...] }`, with optional `next` or `page/totalPages` pagination. It recognises common field names (`name`, `rcNumber`/`rc_number`, `tin`, `yearEnd`, `contacts[]` …). For anything else, map fields with `CLIENT_API_FIELD_MAP`, e.g. `{"externalId":"clientCode","rcNumber":"cac.rc"}`.
3. In **Admin > Clients**, click **Test connection**, then **Sync from client database**. The sync upserts by external ID and never deletes portal data.
4. If the API needs something the adapter doesn't cover (OAuth, SOAP), implement `ClientDirectory` in `lib/integrations/client-directory/` and register it in `index.ts`.

## Administrator guide

- **Users & access.** Invite firm users as Firm staff or Administrator (only a Super Admin can create or change Administrators). Toggle **MFA required** per user, or use **Settings > Require MFA for all firm users**. Deactivating a user blocks sign-in immediately. Client users are invited from an engagement, and you can deactivate them here.
- **Clients.** Sync from the client database. Expand a client to see its contacts and which ones have portal accounts. Use a **manual client** only while waiting for the client database.
- **Master checklist.** Filter by category or engagement type. **New item** / **Edit** opens the full editor; each save creates a revision. To change many items at once, **Export > Excel**, edit, then **Import**. Rows are matched by `code`, new codes are added, and nothing is deleted. Set `is_active = no` to retire an item. Critical items form the pre-engagement stage on new engagements.
- **Settings.** Firm and portal name, logo, brand colours (applied everywhere, including the sign-in page), maximum upload size, allowed file types, firm-wide MFA and integration status. Executable and script types can't be allowed.
- **Audit.** Every change is in `public.audit_log`. A viewer screen is planned for Phase 3; until then, query it in Supabase Studio:
  ```sql
  select occurred_at, actor_role, action, entity_type, before, after
  from audit_log where engagement_id = '…' order by occurred_at desc;
  ```

## Engagement team guide

1. **New engagement.** Pick the client, type, period, lead, team, default due date and the planned dates (planned start, documents due, report due). The client's portal users are ticked for access; untick anyone who shouldn't see it. Then untick master items that don't apply. The engagement is created as a **Draft**, and ticked client users see it as **Being prepared** (team and key dates only). Admins can start the wizard for a client from **Admin > Clients > (client) > New engagement**.
2. **Tailor the list.** The template is a starting point. Use **New folder** at the top to create a main section (e.g. *12 Employee Costs*). Then use **+ Add request** on any folder to add requests under it. Each request has a description for the client, a **Critical item** switch, a due date and an assignee. **Add & add another** keeps the dialog open for the same folder. **From template** adds standard master-checklist items into their usual folders. Rename or delete folders from the folder's **⋯** menu (a folder must be empty to delete it). Select items to bulk-assign, set due dates or priority, or move them between folders. Open any item to edit its guidance or delete it (only items without files can be deleted; otherwise mark them N/A).
3. **Invite more client users** from the **Team** tab (Client team). New contacts get an invitation email. Existing client users get a sign-in link.
4. **Submit for approval.** The preparer submits the list. The lead or a manager reviews it, then either **Returns it with comments** or **Approves & releases** it to the client. Only after release can the client see the list and upload. The status then moves to **Pre-engagement**.
   - Optional: attach firm documents (templates, sample lists) to items, and paste sample schedules from Excel. Do this before release so the client sees them straight away.
5. **Review.** Submitted items appear under **Awaiting review** and in the assignee's dashboard. Available actions:
   - **Start review** or **Accept.** A manager can accept unless the engagement is set to lead-only acceptance.
   - **Query.** Your note goes to the client, and their re-upload becomes the next version.
   - **Not applicable.** Available for non-critical items only.
   - **Waive.** Lead only, for critical items, with a mandatory reason.
6. **Comments.** Use **Internal only** for team discussion. @mention colleagues to notify them.
7. **Sample schedules.** On any request, open **Sample schedule** and paste from Excel or **Upload Excel/CSV** (up to 50 columns). You can also add one while creating the request: expand **Sample schedule (optional)** in the New request dialog.
8. **Calendar.** Add filings, meetings and deadlines with **Add event**. Untick **Visible to client** for internal reminders. Click an event to edit or delete it.
9. **Additional documents & Attachments.** Share engagement-level documents under **Additional documents**. Under **Attachments**, download everything the client has sent (or a selection) as one ZIP with a manifest.

## Security model

| Control | Implementation |
|---|---|
| Tenant isolation | RLS: clients read only engagements they were explicitly granted. Before release they see the shell only (`has_engagement_client_access()`: engagement, team, client-visible events); `can_view_engagement()` / `is_engagement_client()` (released only) guards every child table: folders, items, files, comments, samples, documents |
| Least privilege | `anon` has no table access. `authenticated` gets deliberate column-level grants. Status, waiver and version columns are writable only by workflow functions |
| Internal data | Internal comments, status history, acceptance decisions, the audit log and the master checklist are invisible to clients (RLS) |
| Roles can't be self-assigned | `app_role` comes from `app_metadata` (service role only) and is changed only through admin server actions |
| Files | Private bucket, no storage policies. Uploads use single-use signed URLs issued after `begin_upload()` validates type, size and permission. Completion is confirmed server-side (object exists, size matches). Downloads pass through `/api/files/[id]` after an RLS check, and storage URLs are never exposed |
| MFA & sessions | TOTP enforcement per user or firm-wide (AAL2 required when a factor exists). Idle timeout in `proxy.ts`. Absolute session lifetime set in Supabase |
| Audit | Trigger-based and append-only (update/delete raise), with actor, role, before/after, IP and user agent |
| Headers | HSTS, `X-Frame-Options: DENY`, `nosniff`, strict referrer and permissions policy (`next.config.ts`) |

## Testing

```bash
npm run typecheck        # TypeScript
npm run build            # production build
npm run db:test          # migrations + seed + 161 RLS/workflow assertions on a throwaway Postgres 16
```

`supabase/tests/rls_workflow_test.sql` acts as every role and checks, among other things:

- A client can't see drafts, other clients' data, internal comments, history or the audit log.
- Direct status updates are rejected.
- File type and size limits are enforced.
- Versioning works.
- Lead-only acceptance and waiver rules hold.
- The Go/No-Go gate works.
- Master checklist revisions don't touch live engagements.
- The audit log is immutable.
- A client sees an unreleased engagement's shell, team and client-visible events, but zero folders or items; a revoked client sees nothing.
- Clients can't create, change or delete calendar events; staff outside the team can't see or add them.
- Additional documents: both sides upload (clients only after release), the side is set by the database, the uploader or a manager deletes, outsiders see nothing.
- Sample schedules accept 50 columns and reject 51.

Before handover, the app was also exercised end-to-end in a browser against PostgREST and GoTrue with RLS: scripted Playwright flows covering admin, lead and mobile client journeys, including the engagement workspace (vertical list, every tab, calendar events, document upload, ZIP downloads, "Being prepared" for clients, a 30-column sample schedule created with a new request).

## Project structure

```
app/
  (internal)/            staff interface: dashboard, engagements, admin/*, account, notifications
  portal/                client interface
  login, auth/*, mfa     authentication
  api/files/[id]         permission-checked downloads
  api/documents/[id]     additional-document downloads
  api/engagements/[id]/attachments   ZIP of one side's uploads + manifest.csv
  api/admin/checklist    CSV/XLSX export
components/
  ui/                    shadcn/ui primitives
  engagement/            engagement list/pane, request list, dashboard, documents, calendar, team, attachments, settings, realtime refresh
  items/                 item detail sheet, uploader, comment thread, item form, sample schedule + Excel/CSV input
  portal/                client request list
lib/
  actions/               server actions (uploads, invitations, admin, checklist import)
  integrations/client-directory/   ClientDirectory interface + mock + REST adapter + sync
  storage/               StorageProvider interface + Supabase provider (+ SharePoint stub)
  supabase/              browser, server and admin clients
supabase/
  migrations/            schema, RLS, workflow functions, audit, views
  seed.sql               engagement types, categories, master checklist
  templates/             auth email templates
  tests/                 local Postgres test harness
scripts/seed-demo.mts    demo users and engagement
docs/design-proposal.md  confirmed schema and assumptions
```

## Roadmap

**Phase 2**

- **SharePoint storage.** `SharePointStorageProvider` using Microsoft Graph: app-only auth, `Sites.Selected`, resumable upload sessions and automatic folder creation. The Azure app registration guide ships with it. The upload UI already supports Graph upload sessions.
- **Acceptance Review screen.** Critical %, outstanding items, and Go/No-Go with a required note. The database functions and rules already exist: `record_acceptance_decision`, `transition_engagement`.
- **Email notifications** via Resend or Graph mail, with editable templates (`email_templates`), plus scheduled reminders and a weekly digest (`reminder_rules`, Supabase cron + Edge Function).

**Phase 3**

- Firm-wide dashboard with filters (client, lead, type, status, days in pre-engagement).
- Excel and PDF export of the engagement request list and status.
- Audit log viewer.
- File versioning polish: side-by-side versions. (Bulk ZIP download shipped in 1.2.)
