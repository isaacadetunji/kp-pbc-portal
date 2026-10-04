-- =============================================================================
-- Kreston Pedabo PBC Portal — 0003 Workflow
-- Triggers (profiles, denormalisation, history, master revisions) and the
-- SECURITY DEFINER functions that perform every workflow state change.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Small utilities
-- -----------------------------------------------------------------------------
-- Safe path segment for storage keys. Whitelist of characters accepted by
-- both Supabase Storage and SharePoint; everything else becomes a space.
create or replace function public.path_segment(p text)
returns text language sql immutable as $$
  select left(nullif(trim(regexp_replace(
           regexp_replace(coalesce(p, ''), '[^A-Za-z0-9 _.,()@=+-]+', ' ', 'g'),
           '\s+', ' ', 'g')), ''), 120)
$$;

create or replace function public.lagos_today()
returns date language sql stable as $$
  select (now() at time zone 'Africa/Lagos')::date
$$;

create or replace function public.setting(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = p_key
$$;

create or replace function public.actor_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), email::text) from public.profiles where id = p_user
$$;

-- Users of a client who can currently see an engagement
create or replace function public.engagement_client_user_ids(p_engagement_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct c.user_id
  from public.engagement_client_access a
  join public.client_contacts c on c.id = a.contact_id
  join public.profiles p on p.id = c.user_id and p.is_active
  where a.engagement_id = p_engagement_id and a.revoked_at is null and c.user_id is not null
$$;

create or replace function public.notify(
  p_user uuid, p_type text, p_title text, p_body text,
  p_engagement_id uuid, p_item_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_is_client boolean;
  v_link text;
begin
  if p_user is null or p_user = auth.uid() then
    return;
  end if;
  select app_role = 'client' into v_is_client from public.profiles where id = p_user;
  v_link := case when v_is_client then '/portal/' else '/engagements/' end
            || p_engagement_id::text
            || case when p_item_id is not null then '?item=' || p_item_id::text else '' end;
  insert into public.notifications (user_id, type, title, body, link, engagement_id, request_item_id)
  values (p_user, p_type, p_title, left(p_body, 500), v_link, p_engagement_id, p_item_id);
end $$;

-- -----------------------------------------------------------------------------
-- auth.users -> profiles
-- Role comes from app_metadata (only settable with the service role key), so
-- a user can never self-assign a role.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.app_role;
begin
  v_role := coalesce(nullif(new.raw_app_meta_data ->> 'app_role', '')::public.app_role, 'client');
  insert into public.profiles (id, email, full_name, app_role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''), v_role)
  on conflict (id) do nothing;

  -- Link any client contact rows waiting for this email
  update public.client_contacts set user_id = new.id
  where email = new.email and user_id is null;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.handle_auth_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_auth_user_email_change();

-- When a contact is created for an email that already has a user, link it.
create or replace function public.tg_contact_link_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null then
    select id into new.user_id from public.profiles where email = new.email;
  end if;
  return new;
end $$;
create trigger client_contacts_link_user before insert or update of email on public.client_contacts
  for each row execute function public.tg_contact_link_user();

-- -----------------------------------------------------------------------------
-- Denormalise engagement_id onto comments/files (never trust the caller)
-- -----------------------------------------------------------------------------
create or replace function public.tg_fill_engagement_from_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select engagement_id into new.engagement_id from public.request_items where id = new.request_item_id;
  if new.engagement_id is null then
    raise exception 'Request item not found' using errcode = 'P0002';
  end if;
  return new;
end $$;

create trigger comments_fill_engagement before insert on public.comments
  for each row execute function public.tg_fill_engagement_from_item();
create trigger files_fill_engagement before insert on public.request_item_files
  for each row execute function public.tg_fill_engagement_from_item();

-- Comments: author/threading sanity
create or replace function public.tg_comment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null and not exists (
      select 1 from public.comments where id = new.parent_id and request_item_id = new.request_item_id
    ) then
      raise exception 'Reply must belong to the same request item';
    end if;
    -- Clients can never create internal comments, whatever the client sends.
    if coalesce(public.current_app_role() = 'client', false) then
      new.is_internal := false;
    end if;
    -- A reply to an internal thread stays internal.
    if new.parent_id is not null and exists (select 1 from public.comments where id = new.parent_id and is_internal) then
      new.is_internal := true;
    end if;
    -- Only keep mentions of staff on the engagement team.
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
  end if;
  return new;
end $$;
create trigger comments_guard before insert or update on public.comments
  for each row execute function public.tg_comment_guard();

-- Folder storage paths are always derived server-side from the (sanitised) name
create or replace function public.tg_folder_storage_path()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_base text;
begin
  new.name := trim(new.name);
  if new.name = '' then raise exception 'Folder name is required'; end if;
  if new.parent_id is not null then
    select storage_path into v_base from public.engagement_folders where id = new.parent_id and engagement_id = new.engagement_id;
    if v_base is null then raise exception 'Parent folder must belong to the same engagement'; end if;
  else
    select storage_root into v_base from public.engagements where id = new.engagement_id;
  end if;
  new.storage_path := v_base || '/' || coalesce(public.path_segment(new.name), 'Folder');
  return new;
end $$;
create trigger engagement_folders_storage_path before insert or update of name, parent_id on public.engagement_folders
  for each row execute function public.tg_folder_storage_path();

-- -----------------------------------------------------------------------------
-- Status history (items + engagements). Functions pass an optional note via
-- the transaction-local setting app.status_note.
-- -----------------------------------------------------------------------------
create or replace function public.tg_item_status_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.status_history (entity_type, entity_id, engagement_id, from_status, to_status, note, changed_by)
    values ('request_item', new.id, new.engagement_id,
            case when tg_op = 'UPDATE' then old.status::text end, new.status::text,
            nullif(current_setting('app.status_note', true), ''), auth.uid());
  end if;
  return null;
end $$;
create trigger request_items_status_history after insert or update of status on public.request_items
  for each row execute function public.tg_item_status_history();

create or replace function public.tg_engagement_status_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.status_history (entity_type, entity_id, engagement_id, from_status, to_status, note, changed_by)
    values ('engagement', new.id, new.id,
            case when tg_op = 'UPDATE' then old.status::text end, new.status::text,
            nullif(current_setting('app.status_note', true), ''), auth.uid());
  end if;
  return null;
end $$;
create trigger engagements_status_history after insert or update of status on public.engagements
  for each row execute function public.tg_engagement_status_history();

-- Defence in depth: statuses may only change inside workflow functions.
create or replace function public.tg_guard_status_change()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.workflow', true), '') <> 'on'
     and current_user in ('authenticated', 'anon') then
    raise exception 'Status can only be changed through workflow actions' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger request_items_guard_status before update of status on public.request_items
  for each row execute function public.tg_guard_status_change();
create trigger engagements_guard_status before update of status on public.engagements
  for each row execute function public.tg_guard_status_change();

-- -----------------------------------------------------------------------------
-- Master checklist revisions
-- -----------------------------------------------------------------------------
create or replace function public.tg_master_item_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (new.title, new.guidance, new.default_folder, new.expected_file_types, new.is_critical,
        new.category_id, new.default_priority)
       is distinct from
       (old.title, old.guidance, old.default_folder, old.expected_file_types, old.is_critical,
        old.category_id, old.default_priority) then
      new.revision := old.revision + 1;
    else
      new.revision := old.revision;
    end if;
    new.updated_at := now();
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger master_items_revision before insert or update on public.master_checklist_items
  for each row execute function public.tg_master_item_revision();

create or replace function public.tg_master_item_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.revision <> old.revision then
    insert into public.master_item_revisions (master_item_id, revision, snapshot, changed_by)
    values (new.id, new.revision, to_jsonb(new), auth.uid())
    on conflict (master_item_id, revision) do nothing;
  end if;
  return null;
end $$;
create trigger master_items_snapshot after insert or update on public.master_checklist_items
  for each row execute function public.tg_master_item_snapshot();

-- -----------------------------------------------------------------------------
-- Engagement codes: {PREFIX}-{YYYY}-{NNNN}
-- -----------------------------------------------------------------------------
create or replace function public.next_engagement_code(p_prefix text, p_year int)
returns text language plpgsql security definer set search_path = public as $$
declare v_no int;
begin
  insert into public.engagement_code_counters (prefix, year, last_no) values (p_prefix, p_year, 1)
  on conflict (prefix, year) do update set last_no = engagement_code_counters.last_no + 1
  returning last_no into v_no;
  return format('%s-%s-%s', p_prefix, p_year, lpad(v_no::text, 4, '0'));
end $$;

-- Critical gate figures for an engagement
create or replace function public.critical_gate(p_engagement_id uuid)
returns table (critical_total int, critical_satisfied int, critical_pct numeric, outstanding jsonb)
language sql stable security definer set search_path = public as $$
  select
    count(*)::int,
    count(*) filter (where status = 'accepted' or is_waived)::int,
    case when count(*) = 0 then 100
         else round(100.0 * count(*) filter (where status = 'accepted' or is_waived) / count(*), 2) end,
    coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'title', title, 'status', status))
             filter (where not (status = 'accepted' or is_waived)), '[]'::jsonb)
  from public.request_items
  where engagement_id = p_engagement_id and is_critical
    and public.can_view_engagement(p_engagement_id)
$$;

-- -----------------------------------------------------------------------------
-- create_engagement
-- p_team: jsonb array of {"user_id": uuid, "team_role": "manager"|"member"}
-- -----------------------------------------------------------------------------
create or replace function public.create_engagement(
  p_client_id uuid,
  p_engagement_type_id uuid,
  p_name text,
  p_period_start date,
  p_period_end date,
  p_lead_id uuid,
  p_master_item_ids uuid[],
  p_default_due_date date default null,
  p_team jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_eng_id uuid;
  v_code text;
  v_prefix text;
  v_client_name text;
  v_root text;
  r record;
  v_folder_id uuid;
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

  perform set_config('app.workflow', 'on', true);
  perform set_config('app.status_note', 'Engagement created', true);

  v_code := public.next_engagement_code(v_prefix, extract(year from p_period_end)::int);
  v_root := 'PBC/' || public.path_segment(v_client_name) || '/' || v_code;

  insert into public.engagements (code, client_id, engagement_type_id, name, period_start, period_end,
                                  lead_id, created_by, storage_root)
  values (v_code, p_client_id, p_engagement_type_id, coalesce(nullif(trim(p_name), ''), v_client_name || ' ' || v_code),
          p_period_start, p_period_end, p_lead_id, auth.uid(), v_root)
  returning id into v_eng_id;

  insert into public.engagement_team (engagement_id, user_id, team_role, added_by)
  values (v_eng_id, p_lead_id, 'lead', auth.uid());

  insert into public.engagement_team (engagement_id, user_id, team_role, added_by)
  select v_eng_id, (m ->> 'user_id')::uuid, coalesce(nullif(m ->> 'team_role', ''), 'member')::public.team_role, auth.uid()
  from jsonb_array_elements(coalesce(p_team, '[]'::jsonb)) m
  join public.profiles p on p.id = (m ->> 'user_id')::uuid and p.app_role in ('super_admin','admin','staff') and p.is_active
  where (m ->> 'user_id')::uuid <> p_lead_id and coalesce(m ->> 'team_role', 'member') <> 'lead'
  on conflict do nothing;

  -- Folders from the selected master items' default folders, in category order
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
-- Request list editing
-- -----------------------------------------------------------------------------
create or replace function public.add_request_item(
  p_engagement_id uuid,
  p_folder_id uuid,
  p_title text,
  p_guidance text default null,
  p_is_critical boolean default false,
  p_due_date date default null,
  p_priority public.item_priority default 'normal',
  p_assignee_id uuid default null,
  p_category_id uuid default null,
  p_expected_file_types text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_status public.engagement_status;
  v_n int;
begin
  if not public.can_edit_request_list(p_engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select status into v_status from public.engagements where id = p_engagement_id;
  if v_status in ('completed', 'archived', 'declined') then
    raise exception 'Engagement is closed';
  end if;
  if v_status = 'awaiting_approval' and not public.can_manage_engagement(p_engagement_id) then
    raise exception 'The list is awaiting approval. Ask the reviewer to return it if changes are needed.';
  end if;
  if not exists (select 1 from public.engagement_folders where id = p_folder_id and engagement_id = p_engagement_id) then
    raise exception 'Folder does not belong to this engagement';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Title is required'; end if;

  select coalesce(max(nullif(regexp_replace(code, '^C-', ''), code)::int), 0) + 1 into v_n
  from public.request_items where engagement_id = p_engagement_id and code ~ '^C-\d+$';

  insert into public.request_items (engagement_id, folder_id, category_id, code, title, guidance,
                                    expected_file_types, is_critical, priority, assignee_id, due_date,
                                    sort_order, issued_at)
  values (p_engagement_id, p_folder_id, p_category_id, 'C-' || lpad(v_n::text, 3, '0'), trim(p_title), p_guidance,
          coalesce(p_expected_file_types, '{}'), coalesce(p_is_critical, false), coalesce(p_priority, 'normal'),
          p_assignee_id, p_due_date,
          coalesce((select max(sort_order) + 10 from public.request_items where folder_id = p_folder_id), 10),
          case when v_status <> 'draft' then now() end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.add_master_items_to_engagement(
  p_engagement_id uuid, p_master_item_ids uuid[], p_due_date date default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_root text; v_status public.engagement_status; r record; v_folder uuid; v_count int := 0;
begin
  if not public.can_edit_request_list(p_engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select storage_root, status into v_root, v_status from public.engagements where id = p_engagement_id;
  for r in
    select mi.*, mc.sort_order as cat_order from public.master_checklist_items mi
    join public.master_categories mc on mc.id = mi.category_id
    where mi.id = any(p_master_item_ids) and mi.is_active
      and not exists (select 1 from public.request_items ri where ri.engagement_id = p_engagement_id and ri.code = mi.code)
  loop
    select id into v_folder from public.engagement_folders
    where engagement_id = p_engagement_id and parent_id is null and lower(name) = lower(r.default_folder);
    if v_folder is null then
      insert into public.engagement_folders (engagement_id, name, sort_order, storage_path)
      values (p_engagement_id, r.default_folder,
              coalesce((select max(sort_order) + 10 from public.engagement_folders where engagement_id = p_engagement_id), 10),
              v_root || '/' || public.path_segment(r.default_folder))
      returning id into v_folder;
    end if;
    insert into public.request_items (engagement_id, folder_id, category_id, master_item_id, master_revision, code,
                                      title, guidance, expected_file_types, is_critical, priority, due_date,
                                      sort_order, issued_at)
    values (p_engagement_id, v_folder, r.category_id, r.id, r.revision, r.code, r.title, r.guidance,
            r.expected_file_types, r.is_critical, r.default_priority, p_due_date, r.cat_order * 1000 + r.sort_order,
            case when v_status <> 'draft' then now() end);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.delete_request_item(p_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_eng uuid;
begin
  select engagement_id into v_eng from public.request_items where id = p_item_id;
  if v_eng is null or not public.can_edit_request_list(v_eng) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.request_item_files where request_item_id = p_item_id) then
    raise exception 'This item has uploaded files. Mark it Not Applicable instead of deleting it.';
  end if;
  delete from public.request_items where id = p_item_id;
end $$;

-- Pull master checklist changes into engagement items (descriptive fields only)
create or replace function public.pull_master_changes(p_engagement_id uuid, p_item_ids uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.can_edit_request_list(p_engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  update public.request_items ri set
    title = mi.title,
    guidance = mi.guidance,
    expected_file_types = mi.expected_file_types,
    -- Never flip critical on an item that is N/A (constraint) — keep existing value then
    is_critical = case when ri.status = 'not_applicable' then ri.is_critical else mi.is_critical end,
    category_id = mi.category_id,
    master_revision = mi.revision
  from public.master_checklist_items mi
  where ri.master_item_id = mi.id
    and ri.engagement_id = p_engagement_id
    and ri.master_revision < mi.revision
    and (p_item_ids is null or ri.id = any(p_item_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Engagement lifecycle
-- -----------------------------------------------------------------------------
create or replace function public.issue_request_list(p_engagement_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status public.engagement_status; v_code text; v_name text; u uuid; v_count int;
begin
  if not public.can_manage_engagement(p_engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select status, code, name into v_status, v_code, v_name from public.engagements where id = p_engagement_id for update;
  if v_status not in ('draft', 'awaiting_approval') then raise exception 'Request list has already been issued'; end if;
  select count(*) into v_count from public.request_items where engagement_id = p_engagement_id;
  if v_count = 0 then raise exception 'Add at least one request item before issuing'; end if;

  perform set_config('app.workflow', 'on', true);
  perform set_config('app.status_note', 'Request list issued to client', true);
  update public.engagements set status = 'pre_engagement', pre_engagement_at = now(),
    approved_by = auth.uid(), approved_at = now()
  where id = p_engagement_id;
  update public.request_items set issued_at = now() where engagement_id = p_engagement_id and issued_at is null;

  for u in select * from public.engagement_client_user_ids(p_engagement_id) loop
    perform public.notify(u, 'request_list_issued', 'New information request: ' || v_name,
      v_count || ' items have been requested for ' || v_code || '.', p_engagement_id);
  end loop;
end $$;

-- Generic lifecycle transitions (acceptance decisions have their own function)
create or replace function public.transition_engagement(
  p_engagement_id uuid, p_to public.engagement_status, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_from public.engagement_status;
  v_gate record;
  v_last_decision public.acceptance_decision_type;
begin
  if not public.is_engagement_lead(p_engagement_id) then
    raise exception 'Only the engagement lead can change the engagement status' using errcode = '42501';
  end if;
  select status into v_from from public.engagements where id = p_engagement_id for update;

  if not (
       (v_from = 'pre_engagement'    and p_to = 'acceptance_review')
    or (v_from = 'acceptance_review' and p_to = 'pre_engagement')
    or (v_from = 'accepted'          and p_to = 'in_progress')
    or (v_from = 'in_progress'       and p_to = 'completed')
    or (v_from = 'completed'         and p_to = 'in_progress')
    or (v_from in ('completed','declined') and p_to = 'archived')
    or (v_from = 'declined'          and p_to = 'pre_engagement' and public.is_admin())
    or (v_from = 'archived'          and p_to = 'completed' and public.is_admin())
  ) then
    raise exception 'Cannot move engagement from % to %', v_from, p_to;
  end if;

  if p_to = 'in_progress' and v_from = 'accepted' then
    select * into v_gate from public.critical_gate(p_engagement_id);
    if v_gate.critical_satisfied < v_gate.critical_total then
      raise exception 'Fieldwork cannot start: % critical item(s) are not yet accepted or waived',
        v_gate.critical_total - v_gate.critical_satisfied;
    end if;
    select decision into v_last_decision from public.acceptance_decisions
    where engagement_id = p_engagement_id order by decided_at desc limit 1;
    if v_last_decision is distinct from 'go' then
      raise exception 'Fieldwork cannot start without a Go acceptance decision';
    end if;
  end if;

  perform set_config('app.workflow', 'on', true);
  perform set_config('app.status_note', coalesce(p_note, ''), true);
  update public.engagements set
    status = p_to,
    acceptance_review_at = case when p_to = 'acceptance_review' then now() else acceptance_review_at end,
    fieldwork_started_at = case when p_to = 'in_progress' and fieldwork_started_at is null then now() else fieldwork_started_at end,
    completed_at = case when p_to = 'completed' then now() else completed_at end,
    archived_at = case when p_to = 'archived' then now() when v_from = 'archived' then null else archived_at end
  where id = p_engagement_id;
end $$;

create or replace function public.record_acceptance_decision(
  p_engagement_id uuid, p_decision public.acceptance_decision_type, p_note text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_from public.engagement_status; v_gate record; v_id uuid;
begin
  if not public.is_engagement_lead(p_engagement_id) then
    raise exception 'Only the engagement lead can make the acceptance decision' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A decision note is required'; end if;
  select status into v_from from public.engagements where id = p_engagement_id for update;
  if v_from not in ('pre_engagement', 'acceptance_review') then
    raise exception 'Engagement is not awaiting an acceptance decision';
  end if;
  select * into v_gate from public.critical_gate(p_engagement_id);
  if p_decision = 'go' and v_gate.critical_satisfied < v_gate.critical_total then
    raise exception 'Go is not possible: % critical item(s) outstanding. Accept or waive them first.',
      v_gate.critical_total - v_gate.critical_satisfied;
  end if;

  insert into public.acceptance_decisions (engagement_id, decision, note, critical_total, critical_satisfied,
                                           critical_pct, outstanding_items, decided_by)
  values (p_engagement_id, p_decision, trim(p_note), v_gate.critical_total, v_gate.critical_satisfied,
          v_gate.critical_pct, v_gate.outstanding, auth.uid())
  returning id into v_id;

  perform set_config('app.workflow', 'on', true);
  perform set_config('app.status_note', (case when p_decision = 'go' then 'GO: ' else 'NO-GO: ' end) || trim(p_note), true);
  update public.engagements
  set status = case when p_decision = 'go' then 'accepted'::public.engagement_status else 'declined'::public.engagement_status end,
      decided_at = now()
  where id = p_engagement_id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Uploads
-- -----------------------------------------------------------------------------
create or replace function public.begin_upload(
  p_item_id uuid, p_file_name text, p_mime_type text, p_size_bytes bigint
) returns table (file_id uuid, storage_path text, version_no int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_item record;
  v_eng record;
  v_ext text;
  v_base text;
  v_allowed text[];
  v_max_mb int;
  v_version int;
  v_folder_path text;
  v_path text;
  v_id uuid;
begin
  select * into v_item from public.request_items where id = p_item_id;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  if not (public.is_engagement_member(v_item.engagement_id) or public.is_engagement_client(v_item.engagement_id)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select * into v_eng from public.engagements where id = v_item.engagement_id;
  if v_eng.status not in ('pre_engagement', 'acceptance_review', 'accepted', 'in_progress') then
    raise exception 'Uploads are closed for this engagement (%).', v_eng.status;
  end if;
  if v_item.status not in ('requested', 'queried', 'submitted') then
    raise exception 'This item is % and cannot receive new files.', replace(v_item.status::text, '_', ' ');
  end if;

  -- Validate type and size against settings
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

  v_version := case when v_item.status = 'submitted' then greatest(v_item.current_version, 1)
                    else v_item.current_version + 1 end;

  select f.storage_path into v_folder_path from public.engagement_folders f where f.id = v_item.folder_id;
  v_base := public.path_segment(regexp_replace(p_file_name, '\.[A-Za-z0-9]{1,8}$', ''));
  v_path := coalesce(v_folder_path, v_eng.storage_root) || '/' || v_item.code || '_' || coalesce(v_base, 'file')
            || '_v' || v_version || '.' || v_ext;
  if exists (select 1 from public.request_item_files f where f.storage_path = v_path) then
    v_path := regexp_replace(v_path, '\.' || v_ext || '$', '') || '_' || substr(md5(random()::text), 1, 6) || '.' || v_ext;
  end if;

  insert into public.request_item_files (request_item_id, engagement_id, version_no, file_name, mime_type, size_bytes,
                                         storage_provider, storage_path, uploaded_by)
  values (p_item_id, v_item.engagement_id, v_version, left(p_file_name, 255), p_mime_type, p_size_bytes,
          'supabase', v_path, auth.uid())
  returning id into v_id;

  return query select v_id, v_path, v_version;
end $$;

-- Called by the app server (service role) only after it has verified that the
-- object really exists in storage, so a client cannot mark a phantom upload
-- as stored.
create or replace function public.complete_upload(p_file_id uuid, p_user_id uuid, p_sha256 text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.request_item_files
  set upload_state = 'stored', sha256 = coalesce(p_sha256, sha256)
  where id = p_file_id and uploaded_by = p_user_id and upload_state = 'pending';
  if not found then raise exception 'Upload not found or already completed'; end if;
end $$;

-- Remove a file that has not been submitted yet. Returns the storage path so
-- the server can delete the object.
create or replace function public.remove_draft_file(p_file_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_file record;
begin
  select * into v_file from public.request_item_files where id = p_file_id;
  if v_file.id is null then raise exception 'File not found'; end if;
  if v_file.submitted_at is not null then
    raise exception 'Submitted files are kept as part of the record and cannot be removed';
  end if;
  if not (v_file.uploaded_by = auth.uid() or public.can_manage_engagement(v_file.engagement_id)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  delete from public.request_item_files where id = p_file_id;
  return v_file.storage_path;
end $$;

-- -----------------------------------------------------------------------------
-- Item workflow
-- -----------------------------------------------------------------------------
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
  where request_item_id = p_item_id and submitted_at is null and upload_state = 'stored';
  if v_n = 0 then raise exception 'Upload at least one file before submitting'; end if;

  v_version := case when v_item.status = 'submitted' then greatest(v_item.current_version, 1)
                    else v_item.current_version + 1 end;

  update public.request_item_files set submitted_at = now(), version_no = v_version
  where request_item_id = p_item_id and submitted_at is null and upload_state = 'stored';
  -- abandon incomplete uploads
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

-- Team review actions:
--   start_review | accept | query | not_applicable | reopen
create or replace function public.review_item(p_item_id uuid, p_action text, p_note text default null)
returns public.item_status language plpgsql security definer set search_path = public as $$
declare
  v_item record; v_eng record; v_to public.item_status; u uuid;
begin
  select * into v_item from public.request_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  if not public.is_engagement_member(v_item.engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select * into v_eng from public.engagements where id = v_item.engagement_id;
  if v_eng.status in ('archived') then raise exception 'Engagement is archived'; end if;

  case p_action
    when 'start_review' then
      if v_item.status <> 'submitted' then raise exception 'Only submitted items can be put under review'; end if;
      v_to := 'under_review';
    when 'accept' then
      if not public.can_accept_items(v_item.engagement_id) then
        raise exception 'Final acceptance is restricted on this engagement' using errcode = '42501';
      end if;
      if v_item.status not in ('submitted', 'under_review') then
        raise exception 'Only submitted items can be accepted';
      end if;
      v_to := 'accepted';
    when 'query' then
      if coalesce(trim(p_note), '') = '' then raise exception 'Explain what is needed when querying an item'; end if;
      if v_item.status not in ('submitted', 'under_review', 'accepted') then
        raise exception 'Only submitted or accepted items can be queried';
      end if;
      v_to := 'queried';
    when 'not_applicable' then
      if not public.can_accept_items(v_item.engagement_id) then
        raise exception 'Not permitted' using errcode = '42501';
      end if;
      if v_item.is_critical then
        raise exception 'Critical items cannot be marked N/A. The engagement lead can waive them with a reason.';
      end if;
      if v_item.status = 'not_applicable' then raise exception 'Item is already N/A'; end if;
      v_to := 'not_applicable';
    when 'reopen' then
      if not public.can_accept_items(v_item.engagement_id) then
        raise exception 'Not permitted' using errcode = '42501';
      end if;
      if v_item.status = 'not_applicable' then
        v_to := case when v_item.current_version > 0 then 'submitted' else 'requested' end;
      elsif v_item.status = 'accepted' then
        v_to := 'under_review';
      else
        raise exception 'Only accepted or N/A items can be reopened';
      end if;
    else
      raise exception 'Unknown action %', p_action;
  end case;

  perform set_config('app.workflow', 'on', true);
  perform set_config('app.status_note', coalesce(p_note, ''), true);
  update public.request_items set
    status = v_to,
    accepted_at = case when v_to = 'accepted' then now() else null end,
    accepted_by = case when v_to = 'accepted' then auth.uid() else null end
  where id = p_item_id;

  if p_action = 'query' then
    insert into public.comments (request_item_id, author_id, body, is_internal)
    values (p_item_id, auth.uid(), trim(p_note), false);
    for u in select * from public.engagement_client_user_ids(v_item.engagement_id) loop
      perform public.notify(u, 'item_queried', 'Query on ' || v_item.code || ' ' || v_item.title, trim(p_note),
                            v_item.engagement_id, p_item_id);
    end loop;
  elsif p_action = 'accept' then
    for u in select * from public.engagement_client_user_ids(v_item.engagement_id) loop
      perform public.notify(u, 'item_accepted', 'Accepted: ' || v_item.code || ' ' || v_item.title,
                            'Thank you — this item is complete.', v_item.engagement_id, p_item_id);
    end loop;
  elsif p_action = 'not_applicable' and coalesce(trim(p_note), '') <> '' then
    insert into public.comments (request_item_id, author_id, body, is_internal)
    values (p_item_id, auth.uid(), 'Marked not applicable: ' || trim(p_note), false);
  end if;
  return v_to;
end $$;

create or replace function public.bulk_review_items(p_item_ids uuid[], p_action text, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok int := 0;
begin
  if p_action not in ('start_review', 'accept', 'not_applicable') then
    raise exception 'Bulk action % is not supported', p_action;
  end if;
  foreach v_id in array p_item_ids loop
    begin
      perform public.review_item(v_id, p_action, p_note);
      v_ok := v_ok + 1;
    exception when others then
      -- skip items that are not eligible (e.g. critical items for N/A)
      null;
    end;
  end loop;
  return v_ok;
end $$;

-- Waivers: engagement lead only, critical items only, mandatory reason
create or replace function public.waive_item(p_item_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_item record;
begin
  select * into v_item from public.request_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  if not public.is_engagement_lead(v_item.engagement_id) then
    raise exception 'Only the engagement lead can waive critical items' using errcode = '42501';
  end if;
  if not v_item.is_critical then raise exception 'Only critical items can be waived'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A waiver reason is required'; end if;
  update public.request_items
  set is_waived = true, waiver_reason = trim(p_reason), waived_by = auth.uid(), waived_at = now()
  where id = p_item_id;
  insert into public.comments (request_item_id, author_id, body, is_internal)
  values (p_item_id, auth.uid(), 'Critical item waived: ' || trim(p_reason), true);
end $$;

create or replace function public.unwaive_item(p_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_item record;
begin
  select * into v_item from public.request_items where id = p_item_id for update;
  if not public.is_engagement_lead(v_item.engagement_id) then
    raise exception 'Only the engagement lead can remove a waiver' using errcode = '42501';
  end if;
  update public.request_items set is_waived = false, waiver_reason = null, waived_by = null, waived_at = null
  where id = p_item_id;
end $$;

-- -----------------------------------------------------------------------------
-- Comment notifications
-- -----------------------------------------------------------------------------
create or replace function public.tg_comment_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_item record; v_eng record; v_author_is_client boolean; v_recipients uuid[]; u uuid; v_title text;
begin
  -- Comments created by workflow functions already notify
  if coalesce(current_setting('app.workflow', true), '') = 'on' then
    return null;
  end if;
  select * into v_item from public.request_items where id = new.request_item_id;
  select * into v_eng from public.engagements where id = new.engagement_id;
  select app_role = 'client' into v_author_is_client from public.profiles where id = new.author_id;

  v_recipients := new.mentions;
  if v_author_is_client then
    v_recipients := v_recipients || coalesce(v_item.assignee_id, v_eng.lead_id);
  else
    v_recipients := v_recipients || v_item.assignee_id;
    if not new.is_internal then
      v_recipients := v_recipients || array(select * from public.engagement_client_user_ids(new.engagement_id));
    end if;
  end if;

  v_title := public.actor_name(new.author_id) || ' commented on ' || v_item.code || ' ' || v_item.title;
  for u in select distinct x from unnest(v_recipients) x where x is not null loop
    perform public.notify(u,
      case when u = any(new.mentions) then 'mention' else 'comment' end,
      case when u = any(new.mentions) then public.actor_name(new.author_id) || ' mentioned you on ' || v_item.code
           else v_title end,
      new.body, new.engagement_id, new.request_item_id);
  end loop;
  return null;
end $$;
create trigger comments_notify after insert on public.comments
  for each row execute function public.tg_comment_notify();

-- Notifications: mark read
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = public as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
$$;

-- Record first login for client access rows
create or replace function public.touch_client_access(p_engagement_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.engagement_client_access a set first_login_at = now()
  from public.client_contacts c
  where a.contact_id = c.id and c.user_id = auth.uid()
    and a.engagement_id = p_engagement_id and a.first_login_at is null
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.create_engagement(uuid, uuid, text, date, date, uuid, uuid[], date, jsonb),
  public.add_request_item(uuid, uuid, text, text, boolean, date, public.item_priority, uuid, uuid, text[]),
  public.add_master_items_to_engagement(uuid, uuid[], date),
  public.delete_request_item(uuid),
  public.pull_master_changes(uuid, uuid[]),
  public.issue_request_list(uuid),
  public.transition_engagement(uuid, public.engagement_status, text),
  public.record_acceptance_decision(uuid, public.acceptance_decision_type, text),
  public.begin_upload(uuid, text, text, bigint),
  public.remove_draft_file(uuid),
  public.submit_item(uuid, text),
  public.review_item(uuid, text, text),
  public.bulk_review_items(uuid[], text, text),
  public.waive_item(uuid, text),
  public.unwaive_item(uuid),
  public.mark_notifications_read(uuid[]),
  public.touch_client_access(uuid),
  public.critical_gate(uuid),
  public.lagos_today(),
  public.current_app_role(), public.is_admin(), public.is_staff(), public.team_role_on(uuid),
  public.is_engagement_member(uuid), public.can_manage_engagement(uuid), public.is_engagement_lead(uuid),
  public.can_accept_items(uuid), public.is_engagement_client(uuid), public.can_view_engagement(uuid),
  public.is_client_contact_of(uuid), public.can_edit_request_list(uuid)
to authenticated;

-- Server-only functions
grant execute on function public.complete_upload(uuid, uuid, text) to service_role;
