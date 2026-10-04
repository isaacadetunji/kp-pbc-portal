-- =============================================================================
-- Kreston Pedabo PBC Portal — 0001 Core schema
-- Enums, tables, constraints and indexes.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('super_admin', 'admin', 'staff', 'client');
create type public.team_role as enum ('lead', 'manager', 'member');
create type public.engagement_status as enum (
  'draft', 'awaiting_approval', 'pre_engagement', 'acceptance_review', 'accepted', 'declined',
  'in_progress', 'completed', 'archived'
);
create type public.item_status as enum (
  'requested', 'submitted', 'under_review', 'accepted', 'queried', 'not_applicable'
);
create type public.item_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.acceptance_decision_type as enum ('go', 'no_go');
create type public.storage_provider as enum ('supabase', 'sharepoint');
create type public.client_source as enum ('api', 'manual');
create type public.upload_state as enum ('pending', 'stored', 'failed');
create type public.history_entity as enum ('request_item', 'engagement');

-- -----------------------------------------------------------------------------
-- Generic updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- People
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text not null default '',
  email         extensions.citext not null unique,
  phone         text,
  app_role      public.app_role not null default 'client',
  job_title     text,
  is_active     boolean not null default true,
  mfa_required  boolean not null default false,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

create table public.clients (
  id                  uuid primary key default gen_random_uuid(),
  external_id         text unique,
  source              public.client_source not null default 'api',
  name                text not null,
  rc_number           text,
  tin                 text,
  industry            text,
  nature_of_business  text,
  address             text,
  year_end_month      smallint check (year_end_month between 1 and 12),
  year_end_day        smallint check (year_end_day between 1 and 31),
  email               text,
  phone               text,
  is_active           boolean not null default true,
  last_synced_at      timestamptz,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index clients_name_idx on public.clients using btree (lower(name));
create trigger clients_updated_at before update on public.clients
  for each row execute function public.tg_set_updated_at();

create table public.client_contacts (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  user_id      uuid references public.profiles (id) on delete set null,
  external_id  text,
  full_name    text not null,
  email        extensions.citext not null,
  phone        text,
  position     text,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_id, email)
);
create index client_contacts_user_idx on public.client_contacts (user_id);
create index client_contacts_email_idx on public.client_contacts (email);
create trigger client_contacts_updated_at before update on public.client_contacts
  for each row execute function public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Master checklist
-- -----------------------------------------------------------------------------
create table public.engagement_types (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,          -- SA, TX, AD, DD
  name         text not null,
  code_prefix  text not null,                 -- used in engagement codes
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

create table public.master_categories (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  description  text,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger master_categories_updated_at before update on public.master_categories
  for each row execute function public.tg_set_updated_at();

create table public.master_checklist_items (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  category_id          uuid not null references public.master_categories (id),
  title                text not null,
  guidance             text,
  default_folder       text not null,
  expected_file_types  text[] not null default '{}',
  is_critical          boolean not null default false,
  default_priority     public.item_priority not null default 'normal',
  sort_order           int not null default 0,
  is_active            boolean not null default true,
  revision             int not null default 1,
  updated_by           uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index master_items_category_idx on public.master_checklist_items (category_id, sort_order);

create table public.master_item_engagement_types (
  master_item_id      uuid not null references public.master_checklist_items (id) on delete cascade,
  engagement_type_id  uuid not null references public.engagement_types (id) on delete cascade,
  primary key (master_item_id, engagement_type_id)
);

create table public.master_item_revisions (
  id              uuid primary key default gen_random_uuid(),
  master_item_id  uuid not null references public.master_checklist_items (id) on delete cascade,
  revision        int not null,
  snapshot        jsonb not null,
  changed_by      uuid references public.profiles (id),
  changed_at      timestamptz not null default now(),
  unique (master_item_id, revision)
);

-- -----------------------------------------------------------------------------
-- Engagements
-- -----------------------------------------------------------------------------
create table public.engagements (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  client_id             uuid not null references public.clients (id),
  engagement_type_id    uuid not null references public.engagement_types (id),
  name                  text not null,
  period_start          date,
  period_end            date not null,
  status                public.engagement_status not null default 'draft',
  lead_id               uuid not null references public.profiles (id),
  lead_only_acceptance  boolean not null default false,
  max_upload_mb         int,
  sharepoint_folder_id  text,
  storage_root          text,
  approval_requested_at timestamptz,
  approval_requested_by uuid references public.profiles (id),
  approved_at           timestamptz,
  approved_by           uuid references public.profiles (id),
  pre_engagement_at     timestamptz,
  acceptance_review_at  timestamptz,
  decided_at            timestamptz,
  fieldwork_started_at  timestamptz,
  completed_at          timestamptz,
  archived_at           timestamptz,
  created_by            uuid references public.profiles (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (period_start is null or period_start <= period_end)
);
create index engagements_client_idx on public.engagements (client_id);
create index engagements_status_idx on public.engagements (status);
create index engagements_lead_idx on public.engagements (lead_id);
create trigger engagements_updated_at before update on public.engagements
  for each row execute function public.tg_set_updated_at();

create table public.engagement_team (
  engagement_id  uuid not null references public.engagements (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  team_role      public.team_role not null default 'member',
  added_by       uuid references public.profiles (id),
  added_at       timestamptz not null default now(),
  primary key (engagement_id, user_id)
);
create index engagement_team_user_idx on public.engagement_team (user_id);

create table public.engagement_client_access (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references public.engagements (id) on delete cascade,
  contact_id      uuid not null references public.client_contacts (id) on delete cascade,
  invited_by      uuid references public.profiles (id),
  invited_at      timestamptz not null default now(),
  first_login_at  timestamptz,
  revoked_at      timestamptz,
  unique (engagement_id, contact_id)
);

create table public.engagement_folders (
  id                    uuid primary key default gen_random_uuid(),
  engagement_id         uuid not null references public.engagements (id) on delete cascade,
  parent_id             uuid references public.engagement_folders (id) on delete cascade,
  name                  text not null,
  sort_order            int not null default 0,
  sharepoint_folder_id  text,
  storage_path          text,
  created_at            timestamptz not null default now()
);
create unique index engagement_folders_name_uq
  on public.engagement_folders (engagement_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- -----------------------------------------------------------------------------
-- Request items, files, comments, history
-- -----------------------------------------------------------------------------
create table public.request_items (
  id                   uuid primary key default gen_random_uuid(),
  engagement_id        uuid not null references public.engagements (id) on delete cascade,
  folder_id            uuid not null references public.engagement_folders (id),
  category_id          uuid references public.master_categories (id),
  master_item_id       uuid references public.master_checklist_items (id) on delete set null,
  master_revision      int,
  code                 text not null,
  title                text not null,
  guidance             text,
  expected_file_types  text[] not null default '{}',
  is_critical          boolean not null default false,
  priority             public.item_priority not null default 'normal',
  status               public.item_status not null default 'requested',
  assignee_id          uuid references public.profiles (id) on delete set null,
  due_date             date,
  current_version      int not null default 0,
  sort_order           int not null default 0,
  is_waived            boolean not null default false,
  waiver_reason        text,
  waived_by            uuid references public.profiles (id),
  waived_at            timestamptz,
  issued_at            timestamptz,
  last_submitted_at    timestamptz,
  accepted_at          timestamptz,
  accepted_by          uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (engagement_id, code),
  constraint waiver_requires_reason check (not is_waived or (coalesce(length(trim(waiver_reason)), 0) > 0)),
  constraint waiver_only_critical check (not is_waived or is_critical),
  constraint critical_not_na check (not (is_critical and status = 'not_applicable'))
);
create index request_items_engagement_idx on public.request_items (engagement_id, status);
create index request_items_folder_idx on public.request_items (folder_id, sort_order);
create index request_items_assignee_idx on public.request_items (assignee_id);
create index request_items_due_idx on public.request_items (due_date);
create trigger request_items_updated_at before update on public.request_items
  for each row execute function public.tg_set_updated_at();

create table public.request_item_files (
  id                   uuid primary key default gen_random_uuid(),
  request_item_id      uuid not null references public.request_items (id) on delete cascade,
  engagement_id        uuid not null references public.engagements (id) on delete cascade,
  version_no           int not null check (version_no >= 1),
  file_name            text not null,
  mime_type            text,
  size_bytes           bigint not null check (size_bytes >= 0),
  sha256               text,
  storage_provider     public.storage_provider not null default 'supabase',
  storage_path         text not null,
  sharepoint_drive_id  text,
  sharepoint_item_id   text,
  upload_state         public.upload_state not null default 'pending',
  uploaded_by          uuid not null references public.profiles (id),
  uploaded_at          timestamptz not null default now(),
  submitted_at         timestamptz,
  unique (storage_provider, storage_path)
);
create index request_item_files_item_idx on public.request_item_files (request_item_id, version_no);

create table public.comments (
  id               uuid primary key default gen_random_uuid(),
  request_item_id  uuid not null references public.request_items (id) on delete cascade,
  engagement_id    uuid not null references public.engagements (id) on delete cascade,
  parent_id        uuid references public.comments (id) on delete cascade,
  author_id        uuid not null references public.profiles (id),
  body             text not null check (length(trim(body)) > 0),
  is_internal      boolean not null default false,
  mentions         uuid[] not null default '{}',
  edited_at        timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index comments_item_idx on public.comments (request_item_id, created_at);

create table public.status_history (
  id             uuid primary key default gen_random_uuid(),
  entity_type    public.history_entity not null,
  entity_id      uuid not null,
  engagement_id  uuid not null references public.engagements (id) on delete cascade,
  from_status    text,
  to_status      text not null,
  note           text,
  changed_by     uuid references public.profiles (id),
  changed_at     timestamptz not null default now()
);
create index status_history_entity_idx on public.status_history (entity_type, entity_id, changed_at);

create table public.acceptance_decisions (
  id                  uuid primary key default gen_random_uuid(),
  engagement_id       uuid not null references public.engagements (id) on delete cascade,
  decision            public.acceptance_decision_type not null,
  note                text not null check (length(trim(note)) > 0),
  critical_total      int not null,
  critical_satisfied  int not null,
  critical_pct        numeric(5,2) not null,
  outstanding_items   jsonb not null default '[]',
  decided_by          uuid not null references public.profiles (id),
  decided_at          timestamptz not null default now()
);
create index acceptance_decisions_engagement_idx on public.acceptance_decisions (engagement_id, decided_at desc);

-- -----------------------------------------------------------------------------
-- Notifications, configuration, audit
-- -----------------------------------------------------------------------------
create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  type             text not null,
  title            text not null,
  body             text,
  link             text,
  engagement_id    uuid references public.engagements (id) on delete cascade,
  request_item_id  uuid references public.request_items (id) on delete cascade,
  read_at          timestamptz,
  emailed_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create table public.reminder_rules (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  engagement_type_id     uuid references public.engagement_types (id) on delete cascade,
  days_before_due        int[] not null default '{7,2}',
  overdue_every_days     int not null default 3,
  weekly_digest_weekday  smallint check (weekly_digest_weekday between 0 and 6),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now()
);

create table public.email_templates (
  key         text primary key,
  subject     text not null,
  body_html   text not null,
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz not null default now()
);

create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz not null default now()
);

create table public.audit_log (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  actor_id       uuid,
  actor_role     text,
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  engagement_id  uuid,
  before         jsonb,
  after          jsonb,
  ip             text,
  user_agent     text
);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_engagement_idx on public.audit_log (engagement_id, occurred_at desc);
create index audit_log_time_idx on public.audit_log (occurred_at desc);

-- Engagement code sequences per (prefix, year)
create table public.engagement_code_counters (
  prefix  text not null,
  year    int not null,
  last_no int not null default 0,
  primary key (prefix, year)
);
