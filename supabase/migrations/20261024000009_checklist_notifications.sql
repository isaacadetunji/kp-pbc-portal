-- =============================================================================
-- Kreston Pedabo PBC Portal — 0009 Checklist taxonomy & notifications
--   1. Priority: 'high' is renamed 'important' (Low · Normal · Important · Urgent)
--   2. File classification: permanent file / current file on master + request items
--   3. Expected file types: no longer enforced or edited per item (column kept)
--   4. Managed default folders (master_folders) and manage_checklist permissions
--      on categories, folders and master items
--   5. Settings are Super-admin only (app_settings writes)
--   6. Notification e-mail: per-engagement settings, firm-wide defaults,
--      e-mail bookkeeping on notifications, reminder log, and the SECURITY
--      DEFINER selection functions used by /api/cron/dispatch (service role)
--
-- Runs after 0008 (Agent A), which provides
--   public.can_user_view_request_item(p_user uuid, p_item uuid).
-- The functions below call it from plpgsql (late bound).
-- =============================================================================

set client_min_messages = warning;

-- -----------------------------------------------------------------------------
-- 1. Priority rename: high -> important
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
             join pg_namespace n on n.oid = t.typnamespace
             where n.nspname = 'public' and t.typname = 'item_priority' and e.enumlabel = 'high') then
    alter type public.item_priority rename value 'high' to 'important';
  end if;
end $$;

-- Any function body that still casts the literal 'high' (e.g. create_engagement
-- bumping critical items) would fail at run time after the rename. Rewrite
-- those literals in place, whatever version of the function is installed.
do $$
declare r record; v_def text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.prosrc ~ '''high''::(public\.)?item_priority'
  loop
    v_def := regexp_replace(pg_get_functiondef(r.oid), '''high''::(public\.)?item_priority',
                            '''important''::public.item_priority', 'g');
    execute v_def;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. File classification
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.file_class as enum ('permanent', 'current');
exception when duplicate_object then null; end $$;

alter table public.master_checklist_items add column if not exists file_class public.file_class;
alter table public.request_items          add column if not exists file_class public.file_class;
comment on column public.master_checklist_items.file_class is
  'permanent = always relevant, carried year to year; current = needed for the current year';
comment on column public.request_items.file_class is
  'Copied from the master item when added from the master checklist; editable by the team';

grant update (file_class) on public.request_items to authenticated;

-- Copy master defaults into engagement items whatever function inserts them
-- (create_engagement, add_master_items_to_engagement, ...), and refresh them
-- when the team pulls master changes (master_revision moves).
create or replace function public.tg_request_item_master_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.master_item_id is not null then
    if tg_op = 'INSERT' then
      if new.file_class is null then
        select file_class into new.file_class from public.master_checklist_items where id = new.master_item_id;
      end if;
    elsif new.master_revision is distinct from old.master_revision
          and new.file_class is not distinct from old.file_class then
      select file_class into new.file_class from public.master_checklist_items where id = new.master_item_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists request_items_master_defaults on public.request_items;
create trigger request_items_master_defaults before insert or update of master_revision on public.request_items
  for each row execute function public.tg_request_item_master_defaults();

-- Master revisions: file class is a descriptive field (bumps the revision).
-- Housekeeping updates run by the database owner (seed, folder rename) can
-- set app.master_quiet = on to avoid creating "master updated" notices
-- (set_config is not reachable through the API).
create or replace function public.tg_master_item_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('app.master_quiet', true), '') = 'on' then
      new.revision := old.revision;
    elsif (new.title, new.guidance, new.default_folder, new.is_critical,
           new.category_id, new.default_priority, new.file_class)
          is distinct from
          (old.title, old.guidance, old.default_folder, old.is_critical,
           old.category_id, old.default_priority, old.file_class) then
      new.revision := old.revision + 1;
    else
      new.revision := old.revision;
    end if;
    new.updated_at := now();
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Expected file types: kept for history, no longer edited or enforced.
--    (begin_upload / begin_document_upload validate only the firm-wide
--    allowed extensions and size limit; they never read expected_file_types.)
-- -----------------------------------------------------------------------------
comment on column public.master_checklist_items.expected_file_types is
  'Deprecated (0009): not shown or enforced. Uploads use the firm-wide allowed types only.';
comment on column public.request_items.expected_file_types is
  'Deprecated (0009): not shown or enforced. Uploads use the firm-wide allowed types only.';

-- -----------------------------------------------------------------------------
-- 4. Managed default folders + checklist permissions
-- -----------------------------------------------------------------------------
create table if not exists public.master_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 120),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists master_folders_name_uq on public.master_folders (lower(name));
drop trigger if exists master_folders_updated_at on public.master_folders;
create trigger master_folders_updated_at before update on public.master_folders
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_master_folder_name()
returns trigger language plpgsql as $$
begin
  new.name := regexp_replace(trim(new.name), '\s+', ' ', 'g');
  return new;
end $$;
drop trigger if exists master_folders_name on public.master_folders;
create trigger master_folders_name before insert or update of name on public.master_folders
  for each row execute function public.tg_master_folder_name();

-- Existing default folders become managed folders
insert into public.master_folders (name, sort_order)
select f, (row_number() over (order by f))::int * 10
from (select distinct trim(default_folder) f from public.master_checklist_items where trim(default_folder) <> '') s
on conflict do nothing;

-- A master item's default folder always exists in the managed list (import
-- of a new folder name creates it).
create or replace function public.tg_master_item_folder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.default_folder := regexp_replace(trim(coalesce(new.default_folder, '')), '\s+', ' ', 'g');
  if new.default_folder = '' then raise exception 'Default folder is required'; end if;
  if not exists (select 1 from public.master_folders where lower(name) = lower(new.default_folder)) then
    insert into public.master_folders (name, sort_order)
    values (new.default_folder, coalesce((select max(sort_order) + 10 from public.master_folders), 10))
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists master_items_folder on public.master_checklist_items;
create trigger master_items_folder before insert or update of default_folder on public.master_checklist_items
  for each row execute function public.tg_master_item_folder();

-- Rename a folder and carry the new name to the master items that use it
-- (without bumping their revision: live engagements keep their own folders).
create or replace function public.rename_master_folder(p_folder_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text; v_new text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if not public.has_app_permission('manage_checklist') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_new = '' or length(v_new) > 120 then raise exception 'Folder name must be 1 to 120 characters'; end if;
  select name into v_old from public.master_folders where id = p_folder_id for update;
  if v_old is null then raise exception 'Folder not found'; end if;
  if exists (select 1 from public.master_folders where lower(name) = lower(v_new) and id <> p_folder_id) then
    raise exception 'A folder called "%" already exists', v_new;
  end if;
  update public.master_folders set name = v_new where id = p_folder_id;
  perform set_config('app.master_quiet', 'on', true);
  update public.master_checklist_items set default_folder = v_new where lower(default_folder) = lower(v_old);
  perform set_config('app.master_quiet', '', true);
end $$;

alter table public.master_folders enable row level security;
revoke all on public.master_folders from anon, authenticated;
grant select, insert on public.master_folders to authenticated;
grant update (sort_order, is_active) on public.master_folders to authenticated;
drop policy if exists master_folders_select on public.master_folders;
create policy master_folders_select on public.master_folders for select to authenticated using (public.is_staff());
drop policy if exists master_folders_ins on public.master_folders;
create policy master_folders_ins on public.master_folders for insert to authenticated
  with check (public.has_app_permission('manage_checklist'));
drop policy if exists master_folders_upd on public.master_folders;
create policy master_folders_upd on public.master_folders for update to authenticated
  using (public.has_app_permission('manage_checklist')) with check (public.has_app_permission('manage_checklist'));

-- Categories: add / rename / reorder / deactivate with manage_checklist. The
-- code is fixed once created (imports refer to it).
revoke update on public.master_categories from authenticated;
grant update (name, description, sort_order, is_active) on public.master_categories to authenticated;
drop policy if exists master_categories_admin_ins on public.master_categories;
create policy master_categories_admin_ins on public.master_categories for insert to authenticated
  with check (public.has_app_permission('manage_checklist'));
drop policy if exists master_categories_admin_upd on public.master_categories;
create policy master_categories_admin_upd on public.master_categories for update to authenticated
  using (public.has_app_permission('manage_checklist')) with check (public.has_app_permission('manage_checklist'));

drop policy if exists master_items_admin_ins on public.master_checklist_items;
create policy master_items_admin_ins on public.master_checklist_items for insert to authenticated
  with check (public.has_app_permission('manage_checklist'));
drop policy if exists master_items_admin_upd on public.master_checklist_items;
create policy master_items_admin_upd on public.master_checklist_items for update to authenticated
  using (public.has_app_permission('manage_checklist')) with check (public.has_app_permission('manage_checklist'));

drop policy if exists master_item_types_admin_ins on public.master_item_engagement_types;
create policy master_item_types_admin_ins on public.master_item_engagement_types for insert to authenticated
  with check (public.has_app_permission('manage_checklist'));
drop policy if exists master_item_types_admin_del on public.master_item_engagement_types;
create policy master_item_types_admin_del on public.master_item_engagement_types for delete to authenticated
  using (public.has_app_permission('manage_checklist'));

drop trigger if exists audit_master_categories on public.master_categories;
create trigger audit_master_categories after insert or update or delete on public.master_categories
  for each row execute function public.tg_audit_row('master_category');
drop trigger if exists audit_master_folders on public.master_folders;
create trigger audit_master_folders after insert or update or delete on public.master_folders
  for each row execute function public.tg_audit_row('master_folder');

-- -----------------------------------------------------------------------------
-- 5. Settings are Super-admin only
-- -----------------------------------------------------------------------------
drop policy if exists settings_admin_ins on public.app_settings;
create policy settings_admin_ins on public.app_settings for insert to authenticated with check (public.is_super_admin());
drop policy if exists settings_admin_upd on public.app_settings;
create policy settings_admin_upd on public.app_settings for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 6. Notifications & reminders
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.reminder_frequency as enum ('off', 'daily', 'weekdays', 'weekly');
exception when duplicate_object then null; end $$;

-- Firm-wide defaults (Settings > Notifications). Times are Africa/Lagos.
-- Weekdays are ISO: 1 = Monday ... 7 = Sunday.
insert into public.app_settings (key, value) values
  ('notifications.defaults', '{
     "client_instant": true,
     "client_reminder_frequency": "weekly",
     "client_reminder_weekday": 1,
     "client_reminder_time": "17:00",
     "client_only_when_outstanding": true,
     "team_instant": true,
     "team_reminder_frequency": "weekdays",
     "team_reminder_weekday": 1,
     "team_reminder_time": "09:00"
   }'::jsonb)
on conflict (key) do nothing;

create table if not exists public.engagement_notification_settings (
  engagement_id                 uuid primary key references public.engagements (id) on delete cascade,
  client_instant                boolean not null default true,
  client_reminder_frequency     public.reminder_frequency not null default 'weekly',
  client_reminder_weekday       smallint not null default 1 check (client_reminder_weekday between 1 and 7),
  client_reminder_time          time not null default '17:00',
  client_only_when_outstanding  boolean not null default true,
  team_instant                  boolean not null default true,
  team_reminder_frequency       public.reminder_frequency not null default 'weekdays',
  team_reminder_weekday         smallint not null default 1 check (team_reminder_weekday between 1 and 7),
  team_reminder_time            time not null default '09:00',
  updated_by                    uuid references public.profiles (id),
  updated_at                    timestamptz not null default now()
);

create or replace function public.tg_notification_settings_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists engagement_notification_settings_stamp on public.engagement_notification_settings;
create trigger engagement_notification_settings_stamp before insert or update on public.engagement_notification_settings
  for each row execute function public.tg_notification_settings_stamp();

-- New engagements copy the firm-wide defaults. A malformed default never
-- blocks engagement creation: the column defaults apply instead.
create or replace function public.apply_notification_defaults(p_engagement_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_defaults jsonb := coalesce(public.setting('notifications.defaults'), '{}'::jsonb);
begin
  begin
    insert into public.engagement_notification_settings
    select (jsonb_populate_record(null::public.engagement_notification_settings,
              (v_defaults - 'engagement_id' - 'updated_by' - 'updated_at')
              || jsonb_build_object('engagement_id', p_engagement_id, 'updated_at', now()))).*
    on conflict (engagement_id) do nothing;
  exception when others then
    insert into public.engagement_notification_settings (engagement_id) values (p_engagement_id)
    on conflict (engagement_id) do nothing;
  end;
end $$;

create or replace function public.tg_engagement_notification_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.apply_notification_defaults(new.id);
  return null;
end $$;
drop trigger if exists engagements_notification_defaults on public.engagements;
create trigger engagements_notification_defaults after insert on public.engagements
  for each row execute function public.tg_engagement_notification_defaults();

-- Existing engagements
do $$
declare r record;
begin
  for r in select id from public.engagements e
           where not exists (select 1 from public.engagement_notification_settings s where s.engagement_id = e.id) loop
    perform public.apply_notification_defaults(r.id);
  end loop;
end $$;

alter table public.engagement_notification_settings enable row level security;
revoke all on public.engagement_notification_settings from anon, authenticated;
grant select, insert on public.engagement_notification_settings to authenticated;
grant update (client_instant, client_reminder_frequency, client_reminder_weekday, client_reminder_time,
              client_only_when_outstanding, team_instant, team_reminder_frequency, team_reminder_weekday,
              team_reminder_time)
  on public.engagement_notification_settings to authenticated;
-- Team only (clients never read the team's settings)
drop policy if exists notif_settings_select on public.engagement_notification_settings;
create policy notif_settings_select on public.engagement_notification_settings for select to authenticated
  using (public.is_engagement_member(engagement_id));
drop policy if exists notif_settings_insert on public.engagement_notification_settings;
create policy notif_settings_insert on public.engagement_notification_settings for insert to authenticated
  with check (public.can_manage_engagement(engagement_id));
drop policy if exists notif_settings_update on public.engagement_notification_settings;
create policy notif_settings_update on public.engagement_notification_settings for update to authenticated
  using (public.can_manage_engagement(engagement_id)) with check (public.can_manage_engagement(engagement_id));

drop trigger if exists audit_notification_settings on public.engagement_notification_settings;
create trigger audit_notification_settings after insert or update or delete on public.engagement_notification_settings
  for each row execute function public.tg_audit_row('notification_settings');

-- E-mail bookkeeping on in-app notifications (emailed_at exists since 0001)
alter table public.notifications
  add column if not exists email_error    text,
  add column if not exists email_attempts int not null default 0,
  add column if not exists email_skipped  text;
create index if not exists notifications_email_pending_idx on public.notifications (created_at) where emailed_at is null;
-- Never e-mail the backlog that existed before e-mail was switched on.
update public.notifications set emailed_at = now(), email_skipped = 'created before e-mail notifications were enabled'
where emailed_at is null;

-- Reminder digests sent (one per engagement, user, audience and Lagos day)
create table if not exists public.reminder_log (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null references public.engagements (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  audience       text not null check (audience in ('client', 'team')),
  local_date     date not null,
  item_count     int not null default 0,
  status         text not null check (status in ('sent', 'failed', 'skipped')),
  error          text,
  attempts       int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (engagement_id, user_id, audience, local_date)
);
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;

-- Is a reminder due at this Lagos weekday/time?
create or replace function public.reminder_is_due(
  p_frequency public.reminder_frequency, p_weekday smallint, p_time time, p_dow int, p_now time
) returns boolean language sql immutable as $$
  select p_frequency <> 'off'
     and p_now >= p_time
     and (p_frequency = 'daily'
          or (p_frequency = 'weekdays' and p_dow between 1 and 5)
          or (p_frequency = 'weekly' and p_dow = p_weekday))
$$;

-- Instant e-mails: notifications not yet e-mailed, with the decision whether
-- to deliver. Rows with deliver = false are marked as skipped by the caller.
create or replace function public.email_dispatch_queue(p_limit int default 500, p_max_age interval default '48 hours')
returns table (
  notification_id uuid, user_id uuid, email text, full_name text, is_client boolean,
  type text, title text, body text, link text, engagement_id uuid, engagement_code text,
  engagement_name text, request_item_id uuid, created_at timestamptz, deliver boolean, skip_reason text
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  select n.id, n.user_id, p.email::text, p.full_name, p.app_role = 'client', n.type, n.title, n.body, n.link,
         n.engagement_id, e.code, e.name, n.request_item_id, n.created_at,
         r.reason is null, r.reason
  from public.notifications n
  join public.profiles p on p.id = n.user_id
  left join public.engagements e on e.id = n.engagement_id
  left join public.engagement_notification_settings s on s.engagement_id = n.engagement_id
  cross join lateral (
    select case
      when not p.is_active then 'recipient deactivated'
      when n.created_at < now() - p_max_age then 'older than the e-mail window'
      when p.app_role = 'client' and n.engagement_id is not null and not exists (
             select 1 from public.engagement_client_access a join public.client_contacts c on c.id = a.contact_id
             where a.engagement_id = n.engagement_id and a.revoked_at is null and c.user_id = n.user_id)
        then 'client access revoked'
      when p.app_role <> 'client' and n.engagement_id is not null
           and not public.user_can_view_engagement_firm(n.user_id, n.engagement_id)
        then 'no longer on the engagement team'
      when n.request_item_id is not null and not public.can_user_view_request_item(n.user_id, n.request_item_id)
        then 'item not visible to the recipient'
      when n.engagement_id is not null and p.app_role = 'client' and not coalesce(s.client_instant, true)
        then 'instant e-mails are off for the client on this engagement'
      when n.engagement_id is not null and p.app_role <> 'client' and not coalesce(s.team_instant, true)
        then 'instant e-mails are off for the team on this engagement'
      else null end as reason
  ) r
  where n.emailed_at is null
  order by n.user_id, n.created_at
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
end $$;

-- Mark notifications e-mailed / skipped / failed (failures retry up to 5 times)
create or replace function public.mark_notifications_emailed(p_ids uuid[], p_error text default null, p_skip text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_error is null then
    update public.notifications set emailed_at = now(), email_skipped = p_skip, email_error = null
    where id = any(p_ids) and emailed_at is null;
  else
    update public.notifications set
      email_attempts = email_attempts + 1,
      email_error = left(p_error, 1000),
      emailed_at = case when email_attempts + 1 >= 5 then now() end,
      email_skipped = case when email_attempts + 1 >= 5 then 'failed after 5 attempts' end
    where id = any(p_ids) and emailed_at is null;
  end if;
end $$;

-- Reminder digests due at p_now. One row per (engagement, audience, user):
--   client: outstanding items (requested / queried) the user may see
--           (can_user_view_request_item: locked/assigned items stay hidden);
--           released engagements only; active users with unrevoked access.
--   team:   client submissions awaiting review (submitted / under review)
--           on engagements the user is on; only when there are some.
create or replace function public.reminder_digests_due(p_now timestamptz default now())
returns table (
  engagement_id uuid, engagement_code text, engagement_name text, client_name text, audience text,
  user_id uuid, email text, full_name text, local_date date, item_count int, items jsonb
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_date  date := (p_now at time zone 'Africa/Lagos')::date;
  v_dow   int := extract(isodow from (p_now at time zone 'Africa/Lagos'))::int;
  v_time  time := (p_now at time zone 'Africa/Lagos')::time;
begin
  return query
  with released as (
    select e.id, e.code, e.name, c.name as client_name, s.*
    from public.engagements e
    join public.clients c on c.id = e.client_id
    join public.engagement_notification_settings s on s.engagement_id = e.id
    where e.status in ('pre_engagement', 'acceptance_review', 'accepted', 'in_progress')
  ),
  client_rows as (
    select r.id as eid, r.code, r.name, r.client_name, 'client'::text as aud, p.id as uid, p.email::text as email,
           p.full_name, coalesce(x.n, 0) as n, coalesce(x.items, '[]'::jsonb) as items, r.client_only_when_outstanding as only_when
    from released r
    join lateral (
      select distinct cc.user_id from public.engagement_client_access a
      join public.client_contacts cc on cc.id = a.contact_id
      where a.engagement_id = r.id and a.revoked_at is null and cc.user_id is not null
    ) u on true
    join public.profiles p on p.id = u.user_id and p.is_active and p.app_role = 'client'
    left join lateral (
      select count(*)::int as n,
             jsonb_agg(jsonb_build_object('id', ri.id, 'code', ri.code, 'title', ri.title, 'status', ri.status,
                       'due_date', ri.due_date, 'is_critical', ri.is_critical, 'priority', ri.priority, 'folder', f.name)
                       order by f.sort_order, ri.sort_order, ri.code) as items
      from public.request_items ri
      join public.engagement_folders f on f.id = ri.folder_id
      where ri.engagement_id = r.id and ri.status in ('requested', 'queried')
        and public.can_user_view_request_item(p.id, ri.id)
    ) x on true
    where public.reminder_is_due(r.client_reminder_frequency, r.client_reminder_weekday, r.client_reminder_time, v_dow, v_time)
  ),
  team_rows as (
    select r.id as eid, r.code, r.name, r.client_name, 'team'::text as aud, p.id as uid, p.email::text as email,
           p.full_name, coalesce(x.n, 0) as n, coalesce(x.items, '[]'::jsonb) as items, true as only_when
    from released r
    join public.engagement_team t on t.engagement_id = r.id
    join public.profiles p on p.id = t.user_id and p.is_active and p.app_role in ('super_admin', 'admin', 'staff')
    left join lateral (
      select count(*)::int as n,
             jsonb_agg(jsonb_build_object('id', ri.id, 'code', ri.code, 'title', ri.title, 'status', ri.status,
                       'due_date', ri.due_date, 'is_critical', ri.is_critical, 'priority', ri.priority, 'folder', f.name,
                       'submitted_at', ri.last_submitted_at)
                       order by ri.last_submitted_at nulls last, ri.code) as items
      from public.request_items ri
      join public.engagement_folders f on f.id = ri.folder_id
      where ri.engagement_id = r.id and ri.status in ('submitted', 'under_review')
        and public.can_user_view_request_item(p.id, ri.id)
    ) x on true
    where public.reminder_is_due(r.team_reminder_frequency, r.team_reminder_weekday, r.team_reminder_time, v_dow, v_time)
  )
  select a.eid, a.code, a.name, a.client_name, a.aud, a.uid, a.email, a.full_name, v_date, a.n, a.items
  from (select * from client_rows union all select * from team_rows) a
  where (not a.only_when or a.n > 0)
    and not exists (
      select 1 from public.reminder_log l
      where l.engagement_id = a.eid and l.user_id = a.uid and l.audience = a.aud and l.local_date = v_date
        and (l.status in ('sent', 'skipped') or l.attempts >= 3)
    )
  order by a.uid, a.eid, a.aud;
end $$;

create or replace function public.record_reminder(
  p_engagement_id uuid, p_user_id uuid, p_audience text, p_local_date date, p_item_count int,
  p_status text, p_error text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.reminder_log (engagement_id, user_id, audience, local_date, item_count, status, error)
  values (p_engagement_id, p_user_id, p_audience, p_local_date, coalesce(p_item_count, 0), p_status, left(p_error, 1000))
  on conflict (engagement_id, user_id, audience, local_date) do update set
    status = excluded.status, error = excluded.error, item_count = excluded.item_count,
    attempts = public.reminder_log.attempts + 1, updated_at = now();
end $$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke execute on function
  public.tg_request_item_master_defaults(), public.tg_master_folder_name(), public.tg_master_item_folder(),
  public.rename_master_folder(uuid, text),
  public.tg_notification_settings_stamp(), public.apply_notification_defaults(uuid),
  public.tg_engagement_notification_defaults(),
  public.reminder_is_due(public.reminder_frequency, smallint, time, int, time),
  public.email_dispatch_queue(int, interval), public.mark_notifications_emailed(uuid[], text, text),
  public.reminder_digests_due(timestamptz),
  public.record_reminder(uuid, uuid, text, date, int, text, text)
from public, anon, authenticated;
grant execute on function public.rename_master_folder(uuid, text) to authenticated;
grant execute on function
  public.email_dispatch_queue(int, interval), public.mark_notifications_emailed(uuid[], text, text),
  public.reminder_digests_due(timestamptz), public.record_reminder(uuid, uuid, text, date, int, text, text),
  public.reminder_is_due(public.reminder_frequency, smallint, time, int, time)
to service_role;
