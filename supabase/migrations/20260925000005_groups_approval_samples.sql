-- =============================================================================
-- Kreston Pedabo PBC Portal — 0005 Phase 1.1
--   * Client groups (one client login across several entities)
--   * Preparer -> reviewer approval before a request list is released
--   * Documents the firm shares with the client on a request item
--   * Sample schedules: line-by-line requests pasted from Excel, each line
--     with its own status, supporting files and comment thread
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Client groups
-- -----------------------------------------------------------------------------
create table public.client_groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  external_id  text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index client_groups_name_uq on public.client_groups (lower(name));
create trigger client_groups_updated_at before update on public.client_groups
  for each row execute function public.tg_set_updated_at();

alter table public.clients add column group_id uuid references public.client_groups (id) on delete set null;
create index clients_group_idx on public.clients (group_id);

alter table public.client_groups enable row level security;
revoke all on public.client_groups from anon, authenticated;
grant select on public.client_groups to authenticated;
create policy client_groups_select_staff on public.client_groups
  for select to authenticated using (public.is_staff());
create policy client_groups_select_client on public.client_groups
  for select to authenticated using (
    exists (select 1 from public.clients c where c.group_id = client_groups.id and public.is_client_contact_of(c.id))
  );
create trigger audit_client_groups after insert or update or delete on public.client_groups
  for each row execute function public.tg_audit_row('client_group');

-- -----------------------------------------------------------------------------
-- Preparer -> reviewer approval
-- -----------------------------------------------------------------------------
create or replace function public.submit_list_for_approval(p_engagement_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_eng record; v_n int; u uuid;
begin
  if not public.is_engagement_member(p_engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select * into v_eng from public.engagements where id = p_engagement_id for update;
  if v_eng.status <> 'draft' then raise exception 'Only a draft request list can be submitted for approval'; end if;
  select count(*) into v_n from public.request_items where engagement_id = p_engagement_id;
  if v_n = 0 then raise exception 'Add at least one request item first'; end if;

  perform set_config('app.workflow', 'on', true);
  perform set_config('app.status_note', coalesce(nullif(trim(p_note), ''), 'Submitted for approval'), true);
  update public.engagements
  set status = 'awaiting_approval', approval_requested_at = now(), approval_requested_by = auth.uid()
  where id = p_engagement_id;

  for u in select user_id from public.engagement_team
           where engagement_id = p_engagement_id and team_role in ('lead', 'manager') loop
    perform public.notify(u, 'approval_requested', 'Request list ready for approval: ' || v_eng.name,
      public.actor_name(auth.uid()) || ' prepared ' || v_n || ' items for ' || v_eng.code || '.'
      || coalesce(' Note: ' || nullif(trim(p_note), ''), ''), p_engagement_id);
  end loop;
end $$;

create or replace function public.return_list_to_preparer(p_engagement_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_eng record;
begin
  if not public.can_manage_engagement(p_engagement_id) then
    raise exception 'Only the engagement lead or a manager can review the request list' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Tell the preparer what to change'; end if;
  select * into v_eng from public.engagements where id = p_engagement_id for update;
  if v_eng.status <> 'awaiting_approval' then raise exception 'The request list is not awaiting approval'; end if;

  perform set_config('app.workflow', 'on', true);
  perform set_config('app.status_note', 'Returned: ' || trim(p_note), true);
  update public.engagements set status = 'draft' where id = p_engagement_id;
  perform public.notify(v_eng.approval_requested_by, 'approval_returned', 'Changes requested: ' || v_eng.name,
    trim(p_note), p_engagement_id);
end $$;

-- -----------------------------------------------------------------------------
-- File kinds: client submissions, documents shared by the firm, sample support
-- -----------------------------------------------------------------------------
create type public.file_kind as enum ('client_submission', 'firm_document', 'sample_support');
create type public.sample_line_status as enum ('outstanding', 'provided', 'received', 'queried', 'not_applicable');

create table public.sample_schedules (
  id               uuid primary key default gen_random_uuid(),
  request_item_id  uuid not null unique references public.request_items (id) on delete cascade,
  engagement_id    uuid not null references public.engagements (id) on delete cascade,
  title            text not null default 'Sample schedule',
  instructions     text,
  columns          text[] not null check (cardinality(columns) between 1 and 15),
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger sample_schedules_updated_at before update on public.sample_schedules
  for each row execute function public.tg_set_updated_at();

create table public.sample_lines (
  id               uuid primary key default gen_random_uuid(),
  schedule_id      uuid not null references public.sample_schedules (id) on delete cascade,
  request_item_id  uuid not null references public.request_items (id) on delete cascade,
  engagement_id    uuid not null references public.engagements (id) on delete cascade,
  line_no          int not null,
  cells            text[] not null,
  status           public.sample_line_status not null default 'outstanding',
  status_note      text,
  status_by        uuid references public.profiles (id),
  status_at        timestamptz,
  provided_at      timestamptz,
  received_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (schedule_id, line_no)
);
create index sample_lines_schedule_idx on public.sample_lines (schedule_id, line_no);

alter table public.request_item_files
  add column kind public.file_kind not null default 'client_submission',
  add column sample_line_id uuid references public.sample_lines (id) on delete cascade;
create index request_item_files_line_idx on public.request_item_files (sample_line_id);

alter table public.comments add column sample_line_id uuid references public.sample_lines (id) on delete cascade;
create index comments_line_idx on public.comments (sample_line_id, created_at);

-- Clients see firm documents and sample support straight away (they are
-- "submitted" on completion); drafts of their own submissions as before.
-- (files_select_client already covers submitted_at is not null.)

alter table public.sample_schedules enable row level security;
alter table public.sample_lines enable row level security;
revoke all on public.sample_schedules, public.sample_lines from anon, authenticated;
grant select on public.sample_schedules, public.sample_lines to authenticated;
create policy sample_schedules_select on public.sample_schedules
  for select to authenticated using (public.can_view_engagement(engagement_id));
create policy sample_lines_select on public.sample_lines
  for select to authenticated using (public.can_view_engagement(engagement_id));

create trigger audit_sample_schedules after insert or update or delete on public.sample_schedules
  for each row execute function public.tg_audit_row('sample_schedule');
create trigger audit_sample_lines after insert or update or delete on public.sample_lines
  for each row execute function public.tg_audit_row('sample_line');

-- Comment guard: sample-line comments must belong to the same item/line
create or replace function public.tg_comment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.sample_line_id is not null and not exists (
      select 1 from public.sample_lines where id = new.sample_line_id and request_item_id = new.request_item_id
    ) then
      raise exception 'Sample line does not belong to this request item';
    end if;
    if new.parent_id is not null and not exists (
      select 1 from public.comments where id = new.parent_id and request_item_id = new.request_item_id
        and sample_line_id is not distinct from new.sample_line_id
    ) then
      raise exception 'Reply must belong to the same request item';
    end if;
    if coalesce(public.current_app_role() = 'client', false) then
      new.is_internal := false;
    end if;
    if new.parent_id is not null and exists (select 1 from public.comments where id = new.parent_id and is_internal) then
      new.is_internal := true;
    end if;
    new.mentions := coalesce(array(
      select distinct m from unnest(new.mentions) m
      join public.engagement_team t on t.user_id = m and t.engagement_id = new.engagement_id
    ), '{}');
  elsif tg_op = 'UPDATE' then
    if new.body is distinct from old.body then
      new.edited_at := now();
    end if;
    new.is_internal := old.is_internal;
    new.mentions := old.mentions;
    new.author_id := old.author_id;
    new.sample_line_id := old.sample_line_id;
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Uploads (replaces 0003 versions)
-- -----------------------------------------------------------------------------
drop function public.begin_upload(uuid, text, text, bigint);

create or replace function public.begin_upload(
  p_item_id uuid, p_file_name text, p_mime_type text, p_size_bytes bigint,
  p_kind public.file_kind default 'client_submission', p_sample_line_id uuid default null
) returns table (file_id uuid, storage_path text, version_no int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_item record; v_eng record; v_line record;
  v_ext text; v_base text; v_allowed text[]; v_max_mb int; v_version int;
  v_folder_path text; v_path text; v_id uuid; v_member boolean; v_suffix text;
begin
  select * into v_item from public.request_items where id = p_item_id;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  v_member := public.is_engagement_member(v_item.engagement_id);
  if not (v_member or public.is_engagement_client(v_item.engagement_id)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select * into v_eng from public.engagements where id = v_item.engagement_id;

  if p_kind = 'firm_document' then
    if not v_member then raise exception 'Only the engagement team can share documents' using errcode = '42501'; end if;
    if v_eng.status in ('completed', 'archived', 'declined') then raise exception 'Engagement is closed'; end if;
    v_version := 1;
    v_suffix := '_FIRM';
  elsif p_kind = 'sample_support' then
    select * into v_line from public.sample_lines where id = p_sample_line_id and request_item_id = p_item_id;
    if v_line.id is null then raise exception 'Sample line not found on this item'; end if;
    if v_eng.status not in ('pre_engagement', 'acceptance_review', 'accepted', 'in_progress') then
      raise exception 'Uploads are closed for this engagement (%).', v_eng.status;
    end if;
    if v_line.status in ('received', 'not_applicable') then
      raise exception 'Line % is % and cannot receive new files.', v_line.line_no, replace(v_line.status::text, '_', ' ');
    end if;
    v_version := 1;
    v_suffix := '_L' || v_line.line_no;
  else
    if v_eng.status not in ('pre_engagement', 'acceptance_review', 'accepted', 'in_progress') then
      raise exception 'Uploads are closed for this engagement (%).', v_eng.status;
    end if;
    if v_item.status not in ('requested', 'queried', 'submitted') then
      raise exception 'This item is % and cannot receive new files.', replace(v_item.status::text, '_', ' ');
    end if;
    v_version := case when v_item.status = 'submitted' then greatest(v_item.current_version, 1)
                      else v_item.current_version + 1 end;
    v_suffix := '';
  end if;

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
  if p_size_bytes <= 0 then raise exception 'File is empty'; end if;

  select f.storage_path into v_folder_path from public.engagement_folders f where f.id = v_item.folder_id;
  v_base := public.path_segment(regexp_replace(p_file_name, '\.[A-Za-z0-9]{1,8}$', ''));
  v_path := coalesce(v_folder_path, v_eng.storage_root) || '/' || v_item.code || v_suffix || '_' || coalesce(v_base, 'file')
            || case when p_kind = 'client_submission' then '_v' || v_version else '' end || '.' || v_ext;
  if exists (select 1 from public.request_item_files f where f.storage_path = v_path) then
    v_path := regexp_replace(v_path, '\.' || v_ext || '$', '') || '_' || substr(md5(random()::text), 1, 6) || '.' || v_ext;
  end if;

  insert into public.request_item_files (request_item_id, engagement_id, version_no, file_name, mime_type, size_bytes,
                                         storage_provider, storage_path, uploaded_by, kind, sample_line_id)
  values (p_item_id, v_item.engagement_id, v_version, left(p_file_name, 255), p_mime_type, p_size_bytes,
          'supabase', v_path, auth.uid(), p_kind, case when p_kind = 'sample_support' then p_sample_line_id end)
  returning id into v_id;

  return query select v_id, v_path, v_version;
end $$;

-- Server-only (service role), after the object has been verified in storage.
create or replace function public.complete_upload(p_file_id uuid, p_user_id uuid, p_sha256 text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_file record; v_line record; v_item record; v_eng record; v_is_client boolean;
begin
  update public.request_item_files
  set upload_state = 'stored', sha256 = coalesce(p_sha256, sha256),
      submitted_at = case when kind <> 'client_submission' then now() else submitted_at end
  where id = p_file_id and uploaded_by = p_user_id and upload_state = 'pending'
  returning * into v_file;
  if v_file.id is null then raise exception 'Upload not found or already completed'; end if;

  select * into v_item from public.request_items where id = v_file.request_item_id;
  select * into v_eng from public.engagements where id = v_file.engagement_id;
  select app_role = 'client' into v_is_client from public.profiles where id = p_user_id;

  if v_file.kind = 'sample_support' then
    select * into v_line from public.sample_lines where id = v_file.sample_line_id for update;
    if v_line.status in ('outstanding', 'queried') then
      update public.sample_lines
      set status = 'provided', provided_at = now(), status_by = p_user_id, status_at = now(), status_note = null
      where id = v_line.id;
    end if;
    if v_is_client then
      insert into public.notifications (user_id, type, title, body, link, engagement_id, request_item_id)
      select coalesce(v_item.assignee_id, v_eng.lead_id), 'sample_provided',
             'Sample line ' || v_line.line_no || ' provided: ' || v_item.code,
             public.actor_name(p_user_id) || ' uploaded ' || v_file.file_name,
             '/engagements/' || v_eng.id || '?item=' || v_item.id, v_eng.id, v_item.id
      where coalesce(v_item.assignee_id, v_eng.lead_id) is not null;
    end if;
  elsif v_file.kind = 'firm_document' and v_eng.status not in ('draft', 'awaiting_approval') then
    insert into public.notifications (user_id, type, title, body, link, engagement_id, request_item_id)
    select u, 'firm_document', 'New document from the engagement team: ' || v_item.code,
           v_file.file_name, '/portal/' || v_eng.id || '?item=' || v_item.id, v_eng.id, v_item.id
    from public.engagement_client_user_ids(v_eng.id) u;
  end if;
end $$;

create or replace function public.remove_draft_file(p_file_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_file record; v_line_status public.sample_line_status;
begin
  select * into v_file from public.request_item_files where id = p_file_id;
  if v_file.id is null then raise exception 'File not found'; end if;
  if not (v_file.uploaded_by = auth.uid() or public.can_manage_engagement(v_file.engagement_id)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_file.kind = 'client_submission' and v_file.submitted_at is not null then
    raise exception 'Submitted files are kept as part of the record and cannot be removed';
  end if;
  if v_file.kind = 'sample_support' then
    select status into v_line_status from public.sample_lines where id = v_file.sample_line_id;
    if v_line_status = 'received' then
      raise exception 'This line has been marked received; its files are kept as part of the record';
    end if;
  end if;
  delete from public.request_item_files where id = p_file_id;
  return v_file.storage_path;
end $$;

-- submit_item: only client submissions count as the item's drafts
create or replace function public.submit_item(p_item_id uuid, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_item record; v_eng record; v_version int; v_n int; v_is_client boolean; v_notify uuid;
begin
  select * into v_item from public.request_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  v_is_client := public.is_engagement_client(v_item.engagement_id);
  if not (v_is_client or public.is_engagement_member(v_item.engagement_id)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select * into v_eng from public.engagements where id = v_item.engagement_id;
  if v_eng.status not in ('pre_engagement', 'acceptance_review', 'accepted', 'in_progress') then
    raise exception 'Submissions are closed for this engagement';
  end if;
  if v_item.status not in ('requested', 'queried', 'submitted') then
    raise exception 'This item cannot be submitted while it is %', replace(v_item.status::text, '_', ' ');
  end if;

  select count(*) into v_n from public.request_item_files
  where request_item_id = p_item_id and kind = 'client_submission' and submitted_at is null and upload_state = 'stored';
  if v_n = 0 then raise exception 'Upload at least one file before submitting'; end if;

  v_version := case when v_item.status = 'submitted' then greatest(v_item.current_version, 1)
                    else v_item.current_version + 1 end;

  update public.request_item_files set submitted_at = now(), version_no = v_version
  where request_item_id = p_item_id and kind = 'client_submission' and submitted_at is null and upload_state = 'stored';
  delete from public.request_item_files where request_item_id = p_item_id and upload_state <> 'stored' and submitted_at is null
    and uploaded_at < now() - interval '1 day';

  perform set_config('app.workflow', 'on', true);
  perform set_config('app.status_note', coalesce(p_note, ''), true);
  update public.request_items
  set status = 'submitted', current_version = v_version, last_submitted_at = now()
  where id = p_item_id;

  if coalesce(trim(p_note), '') <> '' then
    insert into public.comments (request_item_id, author_id, body, is_internal)
    values (p_item_id, auth.uid(), trim(p_note), false);
  end if;

  v_notify := coalesce(v_item.assignee_id, v_eng.lead_id);
  perform public.notify(v_notify, 'item_submitted',
    'New upload: ' || v_item.code || ' ' || v_item.title,
    public.actor_name(auth.uid()) || ' submitted ' || v_n || ' file(s) (version ' || v_version || ').',
    v_item.engagement_id, p_item_id);
  return v_version;
end $$;

-- -----------------------------------------------------------------------------
-- Sample schedules
-- -----------------------------------------------------------------------------
create or replace function public.add_sample_lines(p_schedule_id uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_s record; v_next int; r jsonb; v_cells text[]; v_n int := 0;
begin
  select * into v_s from public.sample_schedules where id = p_schedule_id for update;
  if v_s.id is null then raise exception 'Sample schedule not found'; end if;
  if not public.is_engagement_member(v_s.engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'Paste at most 1,000 lines at a time'; end if;
  select coalesce(max(line_no), 0) into v_next from public.sample_lines where schedule_id = p_schedule_id;
  for r in select * from jsonb_array_elements(p_rows) loop
    select array(select left(coalesce(x, ''), 500) from jsonb_array_elements_text(r) x) into v_cells;
    -- pad / trim to the schedule's columns
    v_cells := (select array(select coalesce(v_cells[i], '') from generate_series(1, cardinality(v_s.columns)) i));
    if (select bool_and(c = '') from unnest(v_cells) c) then continue; end if;
    v_next := v_next + 1;
    insert into public.sample_lines (schedule_id, request_item_id, engagement_id, line_no, cells)
    values (p_schedule_id, v_s.request_item_id, v_s.engagement_id, v_next, v_cells);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

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
  if cardinality(v_cols) = 0 or cardinality(v_cols) > 15 then
    raise exception 'A sample schedule needs between 1 and 15 columns';
  end if;
  insert into public.sample_schedules (request_item_id, engagement_id, title, instructions, columns, created_by)
  values (p_item_id, v_item.engagement_id, coalesce(nullif(trim(p_title), ''), 'Sample schedule'),
          nullif(trim(p_instructions), ''), v_cols, auth.uid())
  returning id into v_id;
  perform public.add_sample_lines(v_id, coalesce(p_rows, '[]'::jsonb));
  return v_id;
end $$;

create or replace function public.delete_sample_line(p_line_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_line record;
begin
  select * into v_line from public.sample_lines where id = p_line_id;
  if v_line.id is null then raise exception 'Line not found'; end if;
  if not public.is_engagement_member(v_line.engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.request_item_files where sample_line_id = p_line_id) then
    raise exception 'Line % has files. Mark it not applicable instead of deleting it.', v_line.line_no;
  end if;
  delete from public.sample_lines where id = p_line_id;
end $$;

create or replace function public.delete_sample_schedule(p_schedule_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_s record;
begin
  select * into v_s from public.sample_schedules where id = p_schedule_id;
  if v_s.id is null then raise exception 'Sample schedule not found'; end if;
  if not public.is_engagement_member(v_s.engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.request_item_files f join public.sample_lines l on l.id = f.sample_line_id
             where l.schedule_id = p_schedule_id) then
    raise exception 'The schedule has supporting files and is kept as part of the record';
  end if;
  delete from public.sample_schedules where id = p_schedule_id;
end $$;

-- Status per line.
--   Client: 'provided' (from outstanding / queried).
--   Team:   'received' | 'queried' (note required, shared with client) |
--           'not_applicable' | 'outstanding'.
create or replace function public.set_sample_line_status(
  p_line_ids uuid[], p_status public.sample_line_status, p_note text default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_line record; v_member boolean; v_client boolean; v_ok int := 0; v_item record; u uuid;
begin
  for v_line in select * from public.sample_lines where id = any(p_line_ids) for update loop
    v_member := public.is_engagement_member(v_line.engagement_id);
    v_client := public.is_engagement_client(v_line.engagement_id);
    if not (v_member or v_client) then raise exception 'Not permitted' using errcode = '42501'; end if;

    if v_client and not v_member then
      if p_status <> 'provided' or v_line.status not in ('outstanding', 'queried') then
        raise exception 'You can only mark outstanding or queried lines as provided';
      end if;
    else
      if p_status = 'provided' then
        raise exception 'Use Received to confirm a line';
      end if;
      if p_status = 'queried' and coalesce(trim(p_note), '') = '' then
        raise exception 'Explain what is missing when querying a line';
      end if;
    end if;

    update public.sample_lines set
      status = p_status,
      status_note = case when p_status = 'queried' then trim(p_note) else null end,
      status_by = auth.uid(), status_at = now(),
      provided_at = case when p_status = 'provided' then now() else provided_at end,
      received_at = case when p_status = 'received' then now() when p_status = 'outstanding' then null else received_at end
    where id = v_line.id;

    if coalesce(trim(p_note), '') <> '' then
      perform set_config('app.workflow', 'on', true);
      insert into public.comments (request_item_id, sample_line_id, author_id, body, is_internal)
      values (v_line.request_item_id, v_line.id, auth.uid(),
              case when p_status = 'queried' then 'Query: ' else '' end || trim(p_note), false);
      perform set_config('app.workflow', '', true);
    end if;
    v_ok := v_ok + 1;
  end loop;

  -- One notification per call
  if v_ok > 0 then
    select ri.* into v_item from public.request_items ri
    join public.sample_lines l on l.request_item_id = ri.id where l.id = p_line_ids[1];
    if p_status = 'queried' then
      for u in select * from public.engagement_client_user_ids(v_item.engagement_id) loop
        perform public.notify(u, 'sample_queried', 'Query on ' || v_ok || ' sample line(s): ' || v_item.code, trim(p_note),
                              v_item.engagement_id, v_item.id);
      end loop;
    elsif p_status = 'provided' then
      perform public.notify(coalesce(v_item.assignee_id, (select lead_id from public.engagements where id = v_item.engagement_id)),
        'sample_provided', v_ok || ' sample line(s) marked provided: ' || v_item.code, null, v_item.engagement_id, v_item.id);
    end if;
  end if;
  return v_ok;
end $$;

create or replace view public.v_sample_progress
with (security_invoker = on) as
select s.id as schedule_id, s.request_item_id, s.engagement_id,
       count(l.id)::int as total_lines,
       count(l.id) filter (where l.status = 'outstanding')::int as outstanding_lines,
       count(l.id) filter (where l.status = 'provided')::int as provided_lines,
       count(l.id) filter (where l.status = 'received')::int as received_lines,
       count(l.id) filter (where l.status = 'queried')::int as queried_lines,
       count(l.id) filter (where l.status = 'not_applicable')::int as na_lines
from public.sample_schedules s
left join public.sample_lines l on l.schedule_id = s.id
group by s.id;
revoke all on public.v_sample_progress from anon, authenticated;
grant select on public.v_sample_progress to authenticated;

-- Realtime for sample lines
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.sample_lines, public.sample_schedules;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on function
  public.begin_upload(uuid, text, text, bigint, public.file_kind, uuid),
  public.complete_upload(uuid, uuid, text),
  public.submit_list_for_approval(uuid, text), public.return_list_to_preparer(uuid, text),
  public.create_sample_schedule(uuid, text[], jsonb, text, text), public.add_sample_lines(uuid, jsonb),
  public.delete_sample_line(uuid), public.delete_sample_schedule(uuid),
  public.set_sample_line_status(uuid[], public.sample_line_status, text)
from authenticated;
grant execute on function
  public.begin_upload(uuid, text, text, bigint, public.file_kind, uuid),
  public.submit_list_for_approval(uuid, text), public.return_list_to_preparer(uuid, text),
  public.create_sample_schedule(uuid, text[], jsonb, text, text), public.add_sample_lines(uuid, jsonb),
  public.delete_sample_line(uuid), public.delete_sample_schedule(uuid),
  public.set_sample_line_status(uuid[], public.sample_line_status, text)
to authenticated;
grant execute on function public.complete_upload(uuid, uuid, text) to service_role;
