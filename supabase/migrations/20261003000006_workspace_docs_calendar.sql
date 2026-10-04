-- =============================================================================
-- Kreston Pedabo PBC Portal — 0006 Engagement workspace
--   * Clients see the engagement "shell" (name, code, period, status, team,
--     client-visible calendar) as soon as they are granted access, while the
--     list is still being prepared. Request content stays release-gated.
--   * Planned dates on engagements; default client access on creation
--   * Additional documents (both sides) with a mirrored upload flow
--   * Engagement calendar events
--   * Sample schedules: up to 50 columns
-- =============================================================================

set client_min_messages = warning;

-- -----------------------------------------------------------------------------
-- 1. Client access regardless of engagement status
-- -----------------------------------------------------------------------------
-- The user is an active contact granted (and not revoked) on the engagement,
-- whatever its status. Used for the engagement shell only; everything inside
-- the request list keeps using is_engagement_client() (released only).
create or replace function public.has_engagement_client_access(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.engagement_client_access a
    join public.client_contacts c on c.id = a.contact_id
    join public.profiles p on p.id = c.user_id and p.is_active and p.app_role = 'client'
    where a.engagement_id = p_engagement_id
      and a.revoked_at is null
      and c.user_id = auth.uid()
  )
$$;

-- Team member, or client with access (any status): may see the shell.
create or replace function public.can_view_engagement_shell(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_engagement_member(p_engagement_id) or public.has_engagement_client_access(p_engagement_id)
$$;

-- A client contact is visible to a client user who shares an engagement with it
-- (the "Client team" on that engagement).
create or replace function public.is_engagement_peer_contact(p_contact_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.engagement_client_access a
    where a.contact_id = p_contact_id and a.revoked_at is null
      and public.has_engagement_client_access(a.engagement_id)
  )
$$;

drop policy if exists engagements_select on public.engagements;
create policy engagements_select on public.engagements
  for select to authenticated using (public.can_view_engagement_shell(id));

drop policy if exists team_select on public.engagement_team;
create policy team_select on public.engagement_team
  for select to authenticated using (public.can_view_engagement_shell(engagement_id));

drop policy if exists profiles_select_client_context on public.profiles;
create policy profiles_select_client_context on public.profiles
  for select to authenticated using (
    exists (
      select 1 from public.engagement_team t
      where t.user_id = profiles.id and public.has_engagement_client_access(t.engagement_id)
    )
  );

drop policy if exists client_access_select_peers on public.engagement_client_access;
create policy client_access_select_peers on public.engagement_client_access
  for select to authenticated using (revoked_at is null and public.has_engagement_client_access(engagement_id));

drop policy if exists contacts_select_peers on public.client_contacts;
create policy contacts_select_peers on public.client_contacts
  for select to authenticated using (public.is_engagement_peer_contact(id));

-- -----------------------------------------------------------------------------
-- 2. Planned dates
-- -----------------------------------------------------------------------------
alter table public.engagements
  add column if not exists planned_start  date,
  add column if not exists documents_due  date,
  add column if not exists report_due     date;

grant update (planned_start, documents_due, report_due) on public.engagements to authenticated;

-- -----------------------------------------------------------------------------
-- 3. create_engagement: planned dates + default client access
--    p_client_contact_ids: null = every contact of the client that has a portal
--    account (the default); an array = exactly those contacts (may be empty).
-- -----------------------------------------------------------------------------
drop function if exists public.create_engagement(uuid, uuid, text, date, date, uuid, uuid[], date, jsonb);

create or replace function public.create_engagement(
  p_client_id uuid,
  p_engagement_type_id uuid,
  p_name text,
  p_period_start date,
  p_period_end date,
  p_lead_id uuid,
  p_master_item_ids uuid[],
  p_default_due_date date default null,
  p_team jsonb default '[]'::jsonb,
  p_planned_start date default null,
  p_documents_due date default null,
  p_report_due date default null,
  p_client_contact_ids uuid[] default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_eng_id uuid;
  v_code text;
  v_prefix text;
  v_client_name text;
  v_root text;
  r record;
  v_sort int := 0;
begin
  if not public.is_staff() then
    raise exception 'Only firm staff can create engagements' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_lead_id and app_role in ('super_admin','admin','staff') and is_active) then
    raise exception 'Engagement lead must be an active staff member';
  end if;
  select code_prefix into v_prefix from public.engagement_types where id = p_engagement_type_id and is_active;
  if v_prefix is null then raise exception 'Unknown engagement type'; end if;
  select name into v_client_name from public.clients where id = p_client_id and is_active;
  if v_client_name is null then raise exception 'Unknown or inactive client'; end if;
  if p_documents_due is not null and p_report_due is not null and p_report_due < p_documents_due then
    raise exception 'The report due date cannot be before the documents due date';
  end if;

  perform set_config('app.workflow', 'on', true);
  perform set_config('app.status_note', 'Engagement created', true);

  v_code := public.next_engagement_code(v_prefix, extract(year from p_period_end)::int);
  v_root := 'PBC/' || public.path_segment(v_client_name) || '/' || v_code;

  insert into public.engagements (code, client_id, engagement_type_id, name, period_start, period_end,
                                  lead_id, created_by, storage_root, planned_start, documents_due, report_due)
  values (v_code, p_client_id, p_engagement_type_id, coalesce(nullif(trim(p_name), ''), v_client_name || ' ' || v_code),
          p_period_start, p_period_end, p_lead_id, auth.uid(), v_root, p_planned_start, p_documents_due, p_report_due)
  returning id into v_eng_id;

  insert into public.engagement_team (engagement_id, user_id, team_role, added_by)
  values (v_eng_id, p_lead_id, 'lead', auth.uid());

  insert into public.engagement_team (engagement_id, user_id, team_role, added_by)
  select v_eng_id, (m ->> 'user_id')::uuid, coalesce(nullif(m ->> 'team_role', ''), 'member')::public.team_role, auth.uid()
  from jsonb_array_elements(coalesce(p_team, '[]'::jsonb)) m
  join public.profiles p on p.id = (m ->> 'user_id')::uuid and p.app_role in ('super_admin','admin','staff') and p.is_active
  where (m ->> 'user_id')::uuid <> p_lead_id and coalesce(m ->> 'team_role', 'member') <> 'lead'
  on conflict do nothing;

  -- Client access: contacts of THIS client with an active client portal account
  insert into public.engagement_client_access (engagement_id, contact_id, invited_by)
  select v_eng_id, c.id, auth.uid()
  from public.client_contacts c
  join public.profiles p on p.id = c.user_id and p.is_active and p.app_role = 'client'
  where c.client_id = p_client_id
    and (p_client_contact_ids is null or c.id = any(p_client_contact_ids))
  on conflict do nothing;

  for r in
    select mi.default_folder, min(mc.sort_order * 1000 + mi.sort_order) as ord
    from public.master_checklist_items mi
    join public.master_categories mc on mc.id = mi.category_id
    where mi.id = any(coalesce(p_master_item_ids, '{}')) and mi.is_active
    group by mi.default_folder
    order by ord
  loop
    v_sort := v_sort + 10;
    insert into public.engagement_folders (engagement_id, name, sort_order, storage_path)
    values (v_eng_id, r.default_folder, v_sort, v_root || '/' || public.path_segment(r.default_folder));
  end loop;

  insert into public.request_items (engagement_id, folder_id, category_id, master_item_id, master_revision,
                                    code, title, guidance, expected_file_types, is_critical, priority,
                                    due_date, sort_order)
  select v_eng_id, f.id, mi.category_id, mi.id, mi.revision, mi.code, mi.title, mi.guidance,
         mi.expected_file_types, mi.is_critical,
         case when mi.is_critical and mi.default_priority in ('low','normal') then 'high'::public.item_priority
              else mi.default_priority end,
         p_default_due_date, mc.sort_order * 1000 + mi.sort_order
  from public.master_checklist_items mi
  join public.master_categories mc on mc.id = mi.category_id
  join public.engagement_folders f on f.engagement_id = v_eng_id and lower(f.name) = lower(mi.default_folder) and f.parent_id is null
  where mi.id = any(coalesce(p_master_item_ids, '{}')) and mi.is_active;

  return v_eng_id;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Additional documents
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.document_side as enum ('firm', 'client');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.event_kind as enum ('deadline', 'filing', 'meeting', 'milestone', 'client_request', 'other');
exception when duplicate_object then null; end $$;

create table if not exists public.engagement_documents (
  id               uuid primary key default gen_random_uuid(),
  engagement_id    uuid not null references public.engagements (id) on delete cascade,
  uploaded_by      uuid not null references public.profiles (id),
  side             public.document_side not null,
  file_name        text not null,
  mime_type        text,
  size_bytes       bigint not null check (size_bytes > 0),
  storage_provider public.storage_provider not null default 'supabase',
  storage_path     text not null,
  sha256           text,
  description      text check (description is null or length(description) <= 500),
  upload_state     public.upload_state not null default 'pending',
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       uuid references public.profiles (id),
  unique (storage_provider, storage_path)
);
create index if not exists engagement_documents_engagement_idx on public.engagement_documents (engagement_id, created_at desc);

alter table public.engagement_documents enable row level security;
revoke all on public.engagement_documents from anon, authenticated;
grant select on public.engagement_documents to authenticated;

drop policy if exists documents_select_team on public.engagement_documents;
create policy documents_select_team on public.engagement_documents
  for select to authenticated using (public.is_engagement_member(engagement_id));
-- Clients: released engagements only; stored and not deleted, plus their own pending uploads
drop policy if exists documents_select_client on public.engagement_documents;
create policy documents_select_client on public.engagement_documents
  for select to authenticated using (
    public.is_engagement_client(engagement_id)
    and deleted_at is null
    and (upload_state = 'stored' or uploaded_by = auth.uid())
  );

drop trigger if exists audit_engagement_documents on public.engagement_documents;
create trigger audit_engagement_documents after insert or update or delete on public.engagement_documents
  for each row execute function public.tg_audit_row('engagement_document');

create or replace function public.begin_document_upload(
  p_engagement_id uuid, p_file_name text, p_mime_type text, p_size_bytes bigint, p_description text default null
) returns table (document_id uuid, storage_path text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_eng record; v_member boolean; v_client boolean; v_side public.document_side;
  v_ext text; v_base text; v_allowed text[]; v_max_mb int; v_path text; v_id uuid;
begin
  v_member := public.is_engagement_member(p_engagement_id);
  v_client := public.is_engagement_client(p_engagement_id);
  if not (v_member or v_client) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select * into v_eng from public.engagements where id = p_engagement_id;
  if v_eng.status in ('archived', 'declined') then
    raise exception 'This engagement is closed for new documents (%).', v_eng.status;
  end if;
  -- the uploader's role decides the side, never the caller
  v_side := case when v_member then 'firm'::public.document_side else 'client'::public.document_side end;

  v_ext := lower(substring(p_file_name from '\.([A-Za-z0-9]{1,8})$'));
  select array(select jsonb_array_elements_text(coalesce(public.setting('uploads.allowed_extensions'),
         '["pdf","xls","xlsx","xlsm","csv","doc","docx","jpg","jpeg","png","heic","zip"]'::jsonb)))
  into v_allowed;
  if v_ext is null or not (v_ext = any(v_allowed)) then
    raise exception 'File type .% is not allowed. Allowed: %', coalesce(v_ext, '?'), array_to_string(v_allowed, ', ');
  end if;
  v_max_mb := coalesce(v_eng.max_upload_mb, (public.setting('uploads.max_file_mb') #>> '{}')::int, 100);
  if p_size_bytes > v_max_mb::bigint * 1024 * 1024 then
    raise exception 'File is larger than the % MB limit', v_max_mb;
  end if;
  if coalesce(p_size_bytes, 0) <= 0 then raise exception 'File is empty'; end if;

  v_base := public.path_segment(regexp_replace(p_file_name, '\.[A-Za-z0-9]{1,8}$', ''));
  v_path := v_eng.storage_root || '/_Additional documents/' || upper(v_side::text) || '_' || coalesce(v_base, 'file') || '.' || v_ext;
  if exists (select 1 from public.engagement_documents d where d.storage_path = v_path) then
    v_path := regexp_replace(v_path, '\.' || v_ext || '$', '') || '_' || substr(md5(random()::text), 1, 6) || '.' || v_ext;
  end if;

  insert into public.engagement_documents (engagement_id, uploaded_by, side, file_name, mime_type, size_bytes,
                                           storage_path, description)
  values (p_engagement_id, auth.uid(), v_side, left(p_file_name, 255), p_mime_type, p_size_bytes, v_path,
          nullif(left(trim(coalesce(p_description, '')), 500), ''))
  returning id into v_id;
  return query select v_id, v_path;
end $$;

-- Server-only (service role), after the object has been verified in storage.
create or replace function public.complete_document_upload(p_document_id uuid, p_user_id uuid, p_sha256 text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_doc record; v_eng record;
begin
  update public.engagement_documents
  set upload_state = 'stored', sha256 = coalesce(p_sha256, sha256)
  where id = p_document_id and uploaded_by = p_user_id and upload_state = 'pending'
  returning * into v_doc;
  if v_doc.id is null then raise exception 'Upload not found or already completed'; end if;
  select * into v_eng from public.engagements where id = v_doc.engagement_id;

  -- Notify the other side
  if v_doc.side = 'client' then
    insert into public.notifications (user_id, type, title, body, link, engagement_id)
    select t.user_id, 'document_uploaded', 'New document from the client: ' || v_eng.code,
           public.actor_name(p_user_id) || ' shared ' || v_doc.file_name,
           '/engagements/' || v_eng.id || '?tab=documents', v_eng.id
    from public.engagement_team t where t.engagement_id = v_eng.id and t.user_id <> p_user_id;
  elsif v_eng.status not in ('draft', 'awaiting_approval') then
    insert into public.notifications (user_id, type, title, body, link, engagement_id)
    select u, 'document_shared', 'New document from the engagement team: ' || v_eng.name,
           v_doc.file_name, '/portal/' || v_eng.id || '?tab=documents', v_eng.id
    from public.engagement_client_user_ids(v_eng.id) u;
  end if;
end $$;

-- Soft delete: the uploader (own documents) or the lead/manager (any). Returns
-- nothing; the stored object is kept for the record.
create or replace function public.delete_engagement_document(p_document_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_doc record;
begin
  select * into v_doc from public.engagement_documents where id = p_document_id;
  if v_doc.id is null or v_doc.deleted_at is not null then raise exception 'Document not found'; end if;
  if not public.can_view_engagement(v_doc.engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not (v_doc.uploaded_by = auth.uid() or public.can_manage_engagement(v_doc.engagement_id)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  update public.engagement_documents set deleted_at = now(), deleted_by = auth.uid() where id = p_document_id;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Calendar events
-- -----------------------------------------------------------------------------
create table if not exists public.engagement_events (
  id                 uuid primary key default gen_random_uuid(),
  engagement_id      uuid not null references public.engagements (id) on delete cascade,
  title              text not null check (length(trim(title)) between 1 and 200),
  kind               public.event_kind not null default 'other',
  starts_on          date not null,
  ends_on            date,
  notes              text check (notes is null or length(notes) <= 2000),
  visible_to_client  boolean not null default true,
  created_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists engagement_events_engagement_idx on public.engagement_events (engagement_id, starts_on);

drop trigger if exists engagement_events_updated_at on public.engagement_events;
create trigger engagement_events_updated_at before update on public.engagement_events
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_event_created_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;
drop trigger if exists engagement_events_created_by on public.engagement_events;
create trigger engagement_events_created_by before insert on public.engagement_events
  for each row execute function public.tg_event_created_by();

alter table public.engagement_events enable row level security;
revoke all on public.engagement_events from anon, authenticated;
grant select, insert, delete on public.engagement_events to authenticated;
grant update (title, kind, starts_on, ends_on, notes, visible_to_client) on public.engagement_events to authenticated;

drop policy if exists events_select_team on public.engagement_events;
create policy events_select_team on public.engagement_events
  for select to authenticated using (public.is_engagement_member(engagement_id));
drop policy if exists events_select_client on public.engagement_events;
create policy events_select_client on public.engagement_events
  for select to authenticated using (visible_to_client and public.has_engagement_client_access(engagement_id));
drop policy if exists events_insert_team on public.engagement_events;
create policy events_insert_team on public.engagement_events
  for insert to authenticated with check (public.is_engagement_member(engagement_id));
drop policy if exists events_update_team on public.engagement_events;
create policy events_update_team on public.engagement_events
  for update to authenticated using (public.is_engagement_member(engagement_id))
  with check (public.is_engagement_member(engagement_id));
drop policy if exists events_delete_team on public.engagement_events;
create policy events_delete_team on public.engagement_events
  for delete to authenticated using (public.is_engagement_member(engagement_id));

drop trigger if exists audit_engagement_events on public.engagement_events;
create trigger audit_engagement_events after insert or update or delete on public.engagement_events
  for each row execute function public.tg_audit_row('engagement_event');

-- -----------------------------------------------------------------------------
-- 6. Sample schedules: up to 50 columns
-- -----------------------------------------------------------------------------
alter table public.sample_schedules drop constraint if exists sample_schedules_columns_check;
alter table public.sample_schedules add constraint sample_schedules_columns_check
  check (cardinality(columns) between 1 and 50);

create or replace function public.create_sample_schedule(
  p_item_id uuid, p_columns text[], p_rows jsonb, p_title text default null, p_instructions text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_item record; v_id uuid; v_cols text[];
begin
  select * into v_item from public.request_items where id = p_item_id;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  if not public.is_engagement_member(v_item.engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.sample_schedules where request_item_id = p_item_id) then
    raise exception 'This item already has a sample schedule. Add lines to it instead.';
  end if;
  v_cols := array(select left(coalesce(nullif(trim(c), ''), 'Column ' || i), 60)
                  from unnest(p_columns) with ordinality as t(c, i));
  -- The UI keeps the first 50 columns; anything wider is refused here rather
  -- than silently truncated, so the caller always knows what was stored.
  if cardinality(v_cols) = 0 or cardinality(v_cols) > 50 then
    raise exception 'A sample schedule needs between 1 and 50 columns';
  end if;
  insert into public.sample_schedules (request_item_id, engagement_id, title, instructions, columns, created_by)
  values (p_item_id, v_item.engagement_id, coalesce(nullif(trim(p_title), ''), 'Sample schedule'),
          nullif(trim(p_instructions), ''), v_cols, auth.uid())
  returning id into v_id;
  perform public.add_sample_lines(v_id, coalesce(p_rows, '[]'::jsonb));
  return v_id;
end $$;
-- add_sample_lines (0005) already pads/trims every row to the schedule's
-- column count, so extra cells beyond 50 are dropped.

-- -----------------------------------------------------------------------------
-- 7. Realtime
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'engagement_documents') then
      alter publication supabase_realtime add table public.engagement_documents;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'engagement_events') then
      alter publication supabase_realtime add table public.engagement_events;
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Privileges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on function
  public.has_engagement_client_access(uuid), public.can_view_engagement_shell(uuid), public.is_engagement_peer_contact(uuid),
  public.create_engagement(uuid, uuid, text, date, date, uuid, uuid[], date, jsonb, date, date, date, uuid[]),
  public.begin_document_upload(uuid, text, text, bigint, text),
  public.complete_document_upload(uuid, uuid, text),
  public.delete_engagement_document(uuid),
  public.create_sample_schedule(uuid, text[], jsonb, text, text),
  public.tg_event_created_by()
from authenticated;
grant execute on function
  public.has_engagement_client_access(uuid), public.can_view_engagement_shell(uuid), public.is_engagement_peer_contact(uuid),
  public.create_engagement(uuid, uuid, text, date, date, uuid, uuid[], date, jsonb, date, date, date, uuid[]),
  public.begin_document_upload(uuid, text, text, bigint, text),
  public.delete_engagement_document(uuid),
  public.create_sample_schedule(uuid, text[], jsonb, text, text)
to authenticated;
grant execute on function public.complete_document_upload(uuid, uuid, text) to service_role;
