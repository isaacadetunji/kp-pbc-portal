-- =============================================================================
-- Kreston Pedabo PBC Portal — 0010 Roles & single-holder hierarchy, seniority
-- based request locking, multi-time reminders, change-client, client dedupe/merge
--
--   1. Team hierarchy: Partner > Manager > Team lead > Members. At most one
--      partner, one manager, one lead; any number of members. A parameterised
--      set_engagement_role() moves a user into a single-holder role and DEMOTES
--      the previous holder to a plain 'member' (never auto-promotes). lead_id
--      stays in sync; the lead is mandatory (engagements.lead_id is NOT NULL)
--      so it can only be re-assigned, never cleared. Partner/manager may be
--      cleared (the holder drops back to 'member').
--   2. Final-acceptance toggle (engagements.lead_only_acceptance, name kept):
--      ON  -> only partner / manager / team lead may accept;
--      OFF -> any team member may accept.
--   3. Request locking is role-restricted and seniority-based. Ranks:
--        partner(4) > manager(3) > lead(2) > member(1).
--      * Only partner / manager / lead may LOCK (a plain member may not).
--        request_items.locked_by records who locked it (cleared on unlock).
--      * A locked item may be unlocked / re-assigned / re-locked only by the
--        locker, a team member ranked STRICTLY ABOVE the locker, or a super
--        admin. (Agreed seniority-override reading of the user's rule: a senior
--        always overrides a junior's lock; an equal-ranked colleague who is not
--        the locker cannot. So a partner's lock -> partner/super only; a
--        manager's lock -> partner/super; a lead's lock -> manager/partner/super.)
--      * VISIBILITY of a locked item (and all children): its assignees (firm
--        and/or client), the locker, anyone ranked strictly above the locker,
--        and super admin. A locked item assigned to a client contact is visible
--        to that contact only. Items locked before 0010 (no locked_by) behave
--        as a member-level lock: seniors (lead/manager/partner) + assignees see
--        them, plain members do not.
--   4. Reminders may fire at SEVERAL times per day: client_reminder_times /
--      team_reminder_times (time[]). reminder_is_due() fires when "now" matches
--      ANY chosen time; the reminder-log de-dup gains the matched time so a day
--      can send more than once without repeating a given time.
--   5. change_engagement_client(): re-map an engagement to another client. Any
--      team member may do it; it is audit-logged; storage_root is recomputed for
--      FUTURE uploads (existing file paths are untouched).
--   6. Clients: case-insensitive unique name (no duplicates); merge-on-sync is
--      handled in the application layer (lib/integrations/client-directory/sync).
-- =============================================================================

set client_min_messages = warning;

-- -----------------------------------------------------------------------------
-- 1. Team ranks and single-holder hierarchy
-- -----------------------------------------------------------------------------
create or replace function public.team_rank(p_role public.team_role)
returns int language sql immutable as $$
  select case p_role
    when 'partner' then 4
    when 'manager' then 3
    when 'lead'    then 2
    when 'member'  then 1
    else 0 end
$$;

-- One partner, one manager, one lead per engagement (members unlimited).
-- Repair any pre-existing duplicates before the unique indexes: keep the
-- lowest user_id for each single-holder role, demote the rest to 'member'.
do $$
declare r record;
begin
  for r in select distinct engagement_id, team_role from public.engagement_team
           where team_role in ('partner', 'manager')
  loop
    update public.engagement_team t set team_role = 'member'
    where t.engagement_id = r.engagement_id and t.team_role = r.team_role
      and t.user_id <> (select min(x.user_id) from public.engagement_team x
                        where x.engagement_id = r.engagement_id and x.team_role = r.team_role);
  end loop;
end $$;

create unique index if not exists engagement_team_one_partner_uq
  on public.engagement_team (engagement_id) where team_role = 'partner';
create unique index if not exists engagement_team_one_manager_uq
  on public.engagement_team (engagement_id) where team_role = 'manager';
-- (engagement_team_one_lead_uq already exists from 0008.)

-- Parameterised role change. Moves p_user_id into p_role; the previous holder
-- of a single-holder role becomes a plain 'member' (never auto-promoted).
-- p_user_id NULL clears a single-holder role (partner/manager only): the holder
-- drops back to 'member'. The lead is mandatory and cannot be cleared.
create or replace function public.set_engagement_role(
  p_engagement_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_eng record; v_old uuid;
begin
  if p_role is null or p_role not in ('partner', 'manager', 'lead', 'member') then
    raise exception 'Role must be partner, manager, lead or member';
  end if;
  if not public.can_manage_engagement(p_engagement_id) then
    raise exception 'Only a partner, the team lead or a manager can change engagement roles' using errcode = '42501';
  end if;
  select * into v_eng from public.engagements where id = p_engagement_id for update;
  if v_eng.id is null then raise exception 'Engagement not found'; end if;

  -- Clearing a single-holder seat: demote its current holder to member.
  if p_user_id is null then
    if p_role = 'lead' then raise exception 'An engagement must always have a team lead'; end if;
    if p_role = 'member' then raise exception 'Choose a person'; end if;
    update public.engagement_team set team_role = 'member'
    where engagement_id = p_engagement_id and team_role = p_role::public.team_role;
    return;
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id and is_active and app_role in ('super_admin','admin','staff')) then
    raise exception 'That person must be an active firm user';
  end if;

  -- Single-holder role: demote the previous holder (if any, and not the same
  -- person) down to 'member', then move the chosen person into the role.
  if p_role in ('partner', 'manager', 'lead') then
    select user_id into v_old from public.engagement_team
    where engagement_id = p_engagement_id and team_role = p_role::public.team_role;
    if v_old = p_user_id then return; end if;
    if v_old is not null then
      update public.engagement_team set team_role = 'member'
      where engagement_id = p_engagement_id and user_id = v_old;
    end if;
  end if;

  insert into public.engagement_team (engagement_id, user_id, team_role, added_by)
  values (p_engagement_id, p_user_id, p_role::public.team_role, auth.uid())
  on conflict (engagement_id, user_id) do update set team_role = excluded.team_role;

  if p_role <> 'member' then
    perform public.notify(p_user_id, case when p_role = 'lead' then 'lead_assigned' else 'role_assigned' end,
      'You are now the ' || (case p_role when 'lead' then 'team lead' when 'partner' then 'engagement partner' else p_role end) || ': ' || v_eng.name,
      public.actor_name(auth.uid()) || ' made you the ' ||
        (case p_role when 'lead' then 'team lead' when 'partner' then 'engagement partner' else p_role end) ||
        ' on ' || v_eng.code || '.', p_engagement_id);
  end if;
end $$;

-- Re-point set_engagement_lead at the parameterised RPC so the previous lead
-- becomes a MEMBER (the old behaviour wrongly promoted them to manager).
create or replace function public.set_engagement_lead(p_engagement_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.set_engagement_role(p_engagement_id, p_user_id, 'lead');
end $$;

-- -----------------------------------------------------------------------------
-- 2. Final-acceptance toggle: partner / manager / lead when ON, anyone when OFF
-- -----------------------------------------------------------------------------
create or replace function public.can_accept_items(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_super_admin(), false)
      or (
        case when (select lead_only_acceptance from public.engagements where id = p_engagement_id)
          then coalesce(public.team_role_on(p_engagement_id)::text in ('partner', 'manager', 'lead'), false)
          else public.team_role_on(p_engagement_id) is not null
        end)
$$;

-- -----------------------------------------------------------------------------
-- 3. Seniority-based request locking
-- -----------------------------------------------------------------------------
alter table public.request_items
  add column if not exists locked_by uuid references public.profiles (id) on delete set null;
comment on column public.request_items.locked_by is
  'Who locked the item (set on lock, cleared on unlock). Drives the seniority override: the locker, anyone ranked strictly above the locker and super admins may unlock / re-assign / see it.';

-- Backfill locked_by for items already locked: the creator if they are a firm
-- user with lock rights, else leave null (treated as a member-level lock).
update public.request_items ri set locked_by = ri.created_by
where ri.is_locked and ri.locked_by is null and ri.created_by is not null
  and exists (
    select 1 from public.engagement_team t
    where t.engagement_id = ri.engagement_id and t.user_id = ri.created_by
      and t.team_role in ('partner', 'manager', 'lead'));

-- Effective rank of an item's lock holder. Null locker (legacy locks) counts as
-- a member-level lock (rank 1): seniors + assignees still see it, members don't.
create or replace function public.item_locker_rank(p_item uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (select public.team_rank(public.user_team_role(i.locked_by, i.engagement_id))
     from public.request_items i where i.id = p_item and i.locked_by is not null),
    1)
$$;

-- May this firm user unlock / re-assign / re-lock (modify) a locked item?
-- Locker, strictly senior, or super admin.
create or replace function public.user_can_modify_locked_item(p_user uuid, p_item uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.user_app_role(p_user) = 'super_admin'
        or i.locked_by = p_user
        or public.team_rank(public.user_team_role(p_user, i.engagement_id)) > public.item_locker_rank(i.id)
    from public.request_items i where i.id = p_item
  ), false)
$$;

create or replace function public.can_modify_locked_item(p_item uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_can_modify_locked_item(auth.uid(), p_item)
$$;

-- THE item visibility rule (rewritten for seniority).
--   Unlocked: today's rule (whole firm side who can see the engagement; client
--             side: client users with access).
--   Locked, firm side: assignees, the locker, anyone ranked strictly above the
--             locker, super admin.
--   Locked, client side: only client contacts assigned to the item.
create or replace function public.can_user_view_request_item(p_user uuid, p_item uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when r.role = 'client' then
        public.user_is_engagement_client(p_user, i.engagement_id)
        and (not i.is_locked or exists (
          select 1 from public.request_item_assignees a
          where a.request_item_id = i.id and a.user_id = p_user and a.side = 'client'))
      when r.role in ('super_admin', 'admin', 'staff') then
        public.user_can_view_engagement_firm(p_user, i.engagement_id)
        and (not i.is_locked
             or r.role = 'super_admin'
             or i.locked_by = p_user
             or exists (select 1 from public.request_item_assignees a
                        where a.request_item_id = i.id and a.user_id = p_user and a.side = 'firm')
             or public.team_rank(public.user_team_role(p_user, i.engagement_id)) > public.item_locker_rank(i.id))
      else false
    end
    from public.request_items i
    cross join (select public.user_app_role(p_user) as role) r
    where i.id = p_item
  ), false)
$$;

-- Lock / unlock. Only partner / manager / lead (or super admin) may LOCK. A
-- locked item may be modified only by the locker, a strict senior or super admin.
create or replace function public.set_request_item_lock(p_item_id uuid, p_locked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_item record; v_rank int;
begin
  select * into v_item from public.request_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  if not public.can_view_request_item(p_item_id) then raise exception 'Not permitted' using errcode = '42501'; end if;

  if coalesce(p_locked, false) then
    if v_item.is_locked then return; end if;
    v_rank := public.team_rank(public.team_role_on(v_item.engagement_id));
    if not (public.is_super_admin() or v_rank >= 2) then
      raise exception 'Only the engagement partner, manager or team lead can lock a request' using errcode = '42501';
    end if;
    update public.request_items set is_locked = true, locked_by = auth.uid() where id = p_item_id;
  else
    if not v_item.is_locked then return; end if;
    if not public.can_modify_locked_item(p_item_id) then
      raise exception 'Only the person who locked it, someone more senior or a super admin can unlock this request' using errcode = '42501';
    end if;
    update public.request_items set is_locked = false, locked_by = null where id = p_item_id;
  end if;
end $$;

-- Change who is assigned on one side ('firm' | 'client').
--   Locked item: the locker, a strict senior or super admin only.
--   Unlocked, firm side: anyone on the engagement team.
--   Unlocked, client side: team members who can edit the list, or a client user
--   with access to the (released) engagement.
create or replace function public.set_request_item_assignees(p_item_id uuid, p_side text, p_user_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_item record; v_status public.engagement_status; v_team boolean; v_client boolean; v_ok boolean;
begin
  if p_side is null or p_side not in ('firm', 'client') then raise exception 'Side must be firm or client'; end if;
  select * into v_item from public.request_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  if not public.can_view_request_item(p_item_id) then raise exception 'Not permitted' using errcode = '42501'; end if;
  select status into v_status from public.engagements where id = v_item.engagement_id;
  if v_status = 'archived' then raise exception 'Engagement is archived'; end if;
  v_team := public.is_engagement_team(v_item.engagement_id);
  v_client := public.is_engagement_client(v_item.engagement_id);
  if v_item.is_locked then
    v_ok := public.can_modify_locked_item(p_item_id);
  elsif p_side = 'firm' then
    v_ok := v_team;
  else
    v_ok := public.can_edit_request_list(v_item.engagement_id) or v_client;
  end if;
  if not coalesce(v_ok, false) then raise exception 'Not permitted' using errcode = '42501'; end if;
  return public.apply_item_assignees(p_item_id, p_side::public.document_side, p_user_ids);
end $$;

-- add_request_item: record the locker when created locked. (Signature unchanged;
-- only the locked_by write is added, so the 0008 grant still applies.)
create or replace function public.add_request_item(
  p_engagement_id uuid,
  p_folder_id uuid,
  p_title text,
  p_guidance text default null,
  p_is_critical boolean default false,
  p_due_date date default null,
  p_priority public.item_priority default 'normal',
  p_category_id uuid default null,
  p_expected_file_types text[] default '{}',
  p_is_locked boolean default false,
  p_firm_assignee_ids uuid[] default '{}',
  p_client_assignee_ids uuid[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status public.engagement_status; v_n int;
begin
  if not public.can_edit_request_list(p_engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select status into v_status from public.engagements where id = p_engagement_id;
  if v_status in ('completed', 'archived', 'declined') then raise exception 'Engagement is closed'; end if;
  if v_status = 'awaiting_approval' and not public.can_manage_engagement(p_engagement_id) then
    raise exception 'The list is awaiting approval. Ask the reviewer to return it if changes are needed.';
  end if;
  if not exists (select 1 from public.engagement_folders where id = p_folder_id and engagement_id = p_engagement_id) then
    raise exception 'Folder does not belong to this engagement';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Title is required'; end if;
  if coalesce(p_is_locked, false) and not (public.is_super_admin()
        or public.team_rank(public.team_role_on(p_engagement_id)) >= 2) then
    raise exception 'Only the engagement partner, manager or team lead can lock a request' using errcode = '42501';
  end if;

  select coalesce(max(nullif(regexp_replace(code, '^C-', ''), code)::int), 0) + 1 into v_n
  from public.request_items where engagement_id = p_engagement_id and code ~ '^C-\d+$';

  insert into public.request_items (engagement_id, folder_id, category_id, code, title, guidance,
                                    expected_file_types, is_critical, priority, due_date,
                                    sort_order, issued_at, is_locked, locked_by, created_by)
  values (p_engagement_id, p_folder_id, p_category_id, 'C-' || lpad(v_n::text, 3, '0'), trim(p_title), p_guidance,
          coalesce(p_expected_file_types, '{}'), coalesce(p_is_critical, false), coalesce(p_priority, 'normal'),
          p_due_date,
          coalesce((select max(sort_order) + 10 from public.request_items where folder_id = p_folder_id), 10),
          case when v_status <> 'draft' then now() end,
          coalesce(p_is_locked, false), case when coalesce(p_is_locked, false) then auth.uid() end, auth.uid())
  returning id into v_id;

  if cardinality(coalesce(p_firm_assignee_ids, '{}')) > 0 then
    perform public.apply_item_assignees(v_id, 'firm', p_firm_assignee_ids);
  end if;
  if cardinality(coalesce(p_client_assignee_ids, '{}')) > 0 then
    perform public.apply_item_assignees(v_id, 'client', p_client_assignee_ids);
  end if;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Change an engagement's client / entity
-- -----------------------------------------------------------------------------
-- Any team member may re-map the engagement to another client. Audit-logged.
-- storage_root is recomputed for FUTURE uploads from the new client name;
-- existing folders / files keep their paths.
create or replace function public.change_engagement_client(p_engagement_id uuid, p_new_client_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_eng record; v_old_client uuid; v_name text; v_new_root text;
begin
  if not public.is_engagement_team(p_engagement_id) then
    raise exception 'Only the engagement team can change the client' using errcode = '42501';
  end if;
  select * into v_eng from public.engagements where id = p_engagement_id for update;
  if v_eng.id is null then raise exception 'Engagement not found'; end if;
  select name into v_name from public.clients where id = p_new_client_id and is_active;
  if v_name is null then raise exception 'Unknown or inactive client'; end if;
  v_old_client := v_eng.client_id;
  if v_old_client = p_new_client_id then return; end if;

  v_new_root := 'PBC/' || public.path_segment(v_name) || '/' || public.path_segment(v_eng.code);
  update public.engagements set client_id = p_new_client_id, storage_root = v_new_root, updated_at = now()
  where id = p_engagement_id;

  insert into public.audit_log (actor_id, actor_role, action, entity_type, entity_id, engagement_id, before, after)
  values (auth.uid(), public.current_app_role()::text, 'engagement_client_changed', 'engagement', p_engagement_id::text, p_engagement_id,
          jsonb_build_object('client_id', v_old_client, 'storage_root', v_eng.storage_root),
          jsonb_build_object('client_id', p_new_client_id, 'storage_root', v_new_root));
end $$;

-- -----------------------------------------------------------------------------
-- 5. Reminders at several times per day
-- -----------------------------------------------------------------------------
alter table public.engagement_notification_settings
  add column if not exists client_reminder_times time[] not null default array['17:00'::time],
  add column if not exists team_reminder_times   time[] not null default array['09:00'::time];

-- Migrate the single-time values into the arrays (first run only).
update public.engagement_notification_settings
set client_reminder_times = array[client_reminder_time],
    team_reminder_times = array[team_reminder_time]
where client_reminder_times = array['17:00'::time] and team_reminder_times = array['09:00'::time]
  and (client_reminder_time <> '17:00' or team_reminder_time <> '09:00');

grant update (client_reminder_times, team_reminder_times) on public.engagement_notification_settings to authenticated;

-- Firm-wide defaults gain the arrays.
update public.app_settings
set value = value
  || jsonb_build_object('client_reminder_times',
        coalesce(value -> 'client_reminder_times', to_jsonb(array[coalesce(value ->> 'client_reminder_time', '17:00')])))
  || jsonb_build_object('team_reminder_times',
        coalesce(value -> 'team_reminder_times', to_jsonb(array[coalesce(value ->> 'team_reminder_time', '09:00')])))
where key = 'notifications.defaults';

-- apply_notification_defaults copies the arrays too (jsonb_populate_record reads
-- the new columns automatically; nothing else to change). Reminder is due when
-- "now" matches ANY chosen time.
-- The single-time version is replaced by the time[] one below.
drop function if exists public.reminder_is_due(public.reminder_frequency, smallint, time, int, time);
create or replace function public.reminder_is_due(
  p_frequency public.reminder_frequency, p_weekday smallint, p_times time[], p_dow int, p_now time
) returns boolean language sql immutable as $$
  select p_frequency <> 'off'
     and (p_frequency = 'daily'
          or (p_frequency = 'weekdays' and p_dow between 1 and 5)
          or (p_frequency = 'weekly' and p_dow = p_weekday))
     and exists (select 1 from unnest(coalesce(p_times, '{}')) t where p_now >= t)
$$;

-- The specific chosen time that is firing now (the latest due time today), used
-- for the per-time reminder-log de-dup.
create or replace function public.reminder_due_time(p_times time[], p_now time)
returns time language sql immutable as $$
  select max(t) from unnest(coalesce(p_times, '{}')) t where p_now >= t
$$;

-- reminder_log gains the matched time so a day can fire more than once.
alter table public.reminder_log
  add column if not exists reminder_time time not null default '00:00';
-- Drop the old 4-column unique (whatever its generated name) so a day can fire
-- at more than one time; the 5-column index below replaces it.
do $$
declare v_con text;
begin
  for v_con in
    select conname from pg_constraint
    where conrelid = 'public.reminder_log'::regclass and contype = 'u'
      and conkey = (
        select array_agg(attnum order by attnum) from pg_attribute
        where attrelid = 'public.reminder_log'::regclass
          and attname in ('engagement_id', 'user_id', 'audience', 'local_date'))
  loop
    execute format('alter table public.reminder_log drop constraint %I', v_con);
  end loop;
end $$;
create unique index if not exists reminder_log_dedup_uq
  on public.reminder_log (engagement_id, user_id, audience, local_date, reminder_time);

drop function if exists public.record_reminder(uuid, uuid, text, date, int, text, text);
create or replace function public.record_reminder(
  p_engagement_id uuid, p_user_id uuid, p_audience text, p_local_date date, p_item_count int,
  p_status text, p_error text default null, p_reminder_time time default '00:00'
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.reminder_log (engagement_id, user_id, audience, local_date, reminder_time, item_count, status, error)
  values (p_engagement_id, p_user_id, p_audience, p_local_date, coalesce(p_reminder_time, '00:00'), coalesce(p_item_count, 0), p_status, left(p_error, 1000))
  on conflict (engagement_id, user_id, audience, local_date, reminder_time) do update set
    status = excluded.status, error = excluded.error, item_count = excluded.item_count,
    attempts = public.reminder_log.attempts + 1, updated_at = now();
end $$;

-- Reminder digests due at p_now, now keyed by the chosen time that is firing.
drop function if exists public.reminder_digests_due(timestamptz);
create or replace function public.reminder_digests_due(p_now timestamptz default now())
returns table (
  engagement_id uuid, engagement_code text, engagement_name text, client_name text, audience text,
  user_id uuid, email text, full_name text, local_date date, reminder_time time, item_count int, items jsonb
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
           p.full_name, coalesce(x.n, 0) as n, coalesce(x.items, '[]'::jsonb) as items, r.client_only_when_outstanding as only_when,
           public.reminder_due_time(r.client_reminder_times, v_time) as rtime
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
    where public.reminder_is_due(r.client_reminder_frequency, r.client_reminder_weekday, r.client_reminder_times, v_dow, v_time)
  ),
  team_rows as (
    select r.id as eid, r.code, r.name, r.client_name, 'team'::text as aud, p.id as uid, p.email::text as email,
           p.full_name, coalesce(x.n, 0) as n, coalesce(x.items, '[]'::jsonb) as items, true as only_when,
           public.reminder_due_time(r.team_reminder_times, v_time) as rtime
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
    where public.reminder_is_due(r.team_reminder_frequency, r.team_reminder_weekday, r.team_reminder_times, v_dow, v_time)
  )
  select a.eid, a.code, a.name, a.client_name, a.aud, a.uid, a.email, a.full_name, v_date, a.rtime, a.n, a.items
  from (select * from client_rows union all select * from team_rows) a
  where (not a.only_when or a.n > 0)
    and not exists (
      select 1 from public.reminder_log l
      where l.engagement_id = a.eid and l.user_id = a.uid and l.audience = a.aud and l.local_date = v_date
        and l.reminder_time = a.rtime
        and (l.status in ('sent', 'skipped') or l.attempts >= 3)
    )
  order by a.uid, a.eid, a.aud;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Clients: no duplicate names (case-insensitive)
-- -----------------------------------------------------------------------------
-- Collapse any pre-existing case-insensitive duplicates so the unique index can
-- be created: keep the API-sourced row (or the oldest), re-point engagements and
-- contacts, delete the losers.
do $$
declare r record; v_keep uuid;
begin
  for r in
    select lower(name) as lname from public.clients group by lower(name) having count(*) > 1
  loop
    select id into v_keep from public.clients where lower(name) = r.lname
    order by (source = 'api') desc, external_id is not null desc, created_at asc, id asc limit 1;
    update public.engagements e set client_id = v_keep
    where e.client_id in (select id from public.clients where lower(name) = r.lname and id <> v_keep);
    update public.client_contacts c set client_id = v_keep
    where c.client_id in (select id from public.clients where lower(name) = r.lname and id <> v_keep)
      and not exists (select 1 from public.client_contacts k where k.client_id = v_keep and lower(k.email) = lower(c.email));
    delete from public.client_contacts c
    where c.client_id in (select id from public.clients where lower(name) = r.lname and id <> v_keep);
    delete from public.clients where lower(name) = r.lname and id <> v_keep;
  end loop;
end $$;

create unique index if not exists clients_name_lower_uq on public.clients (lower(name));

-- -----------------------------------------------------------------------------
-- 7. Privileges
-- -----------------------------------------------------------------------------
revoke execute on function
  public.item_locker_rank(uuid), public.user_can_modify_locked_item(uuid, uuid)
from public, anon, authenticated;

-- Recreated reminder functions default to PUBLIC execute; keep them server-only.
revoke execute on function
  public.reminder_digests_due(timestamptz),
  public.record_reminder(uuid, uuid, text, date, int, text, text, time)
from public, anon, authenticated;

grant execute on function
  public.team_rank(public.team_role),
  public.set_engagement_role(uuid, uuid, text),
  public.can_modify_locked_item(uuid),
  public.change_engagement_client(uuid, uuid),
  public.reminder_is_due(public.reminder_frequency, smallint, time[], int, time),
  public.reminder_due_time(time[], time)
to authenticated;

grant execute on function
  public.reminder_is_due(public.reminder_frequency, smallint, time[], int, time),
  public.reminder_due_time(time[], time),
  public.record_reminder(uuid, uuid, text, date, int, text, text, time),
  public.reminder_digests_due(timestamptz),
  public.can_user_view_request_item(uuid, uuid)
to service_role;
