-- =============================================================================
-- Kreston Pedabo PBC Portal — 0008 Access, team roles, assignment & locking,
-- stages, engagement types & codes
--
--   1. Visibility & permission helpers (per-user variants for server jobs)
--        * firm users see an engagement when they are on its team, created it,
--          or hold view_all_engagements (Super admin: everything)
--        * admins no longer manage every engagement automatically
--   2. Policies: blanket is_admin() checks replaced by role permissions
--   3. Engagement team: 'partner' role, exactly one team lead (kept in sync
--      with engagements.lead_id), set_engagement_lead()
--   4. create_engagement(): needs create_engagements; the creator is NOT made
--      lead or team member; partners/managers/members from p_team;
--      configurable engagement code format
--   5. Request item assignees (firm + client side) and locked items. Item
--      visibility: can_user_view_request_item(user, item) /
--      can_view_request_item(item) applied to items and every child table
--   6. Item workflow functions re-check item visibility; notifications follow
--      the assignees and never reach someone who cannot see the item
--   7. Stages: Draft -> Approval -> Pre-execution -> Execution -> Completed,
--      editable stage labels, DB-enforced critical gate and completion rule
--
-- NOTE: 'partner' is added to team_role at the top of this file. Nothing below
-- uses it as an enum literal at migration time (only text comparisons and
-- late-bound plpgsql), so the file also works when run inside one transaction.
-- =============================================================================

set client_min_messages = warning;

alter type public.team_role add value if not exists 'partner' before 'lead';

-- -----------------------------------------------------------------------------
-- 1. Per-user helpers (SECURITY DEFINER, internal: not granted to end users)
-- -----------------------------------------------------------------------------
create or replace function public.user_app_role(p_user uuid)
returns public.app_role language sql stable security definer set search_path = public as $$
  select app_role from public.profiles where id = p_user and is_active
$$;

create or replace function public.user_has_app_permission(p_user uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.user_app_role(p_user)
    when 'super_admin' then true
    when 'admin' then coalesce(
      ((select value from public.app_settings where key = 'role_permissions') -> 'admin' ->> p_perm)::boolean,
      (public.default_role_permissions() -> 'admin' ->> p_perm)::boolean, false)
    when 'staff' then coalesce(
      ((select value from public.app_settings where key = 'role_permissions') -> 'staff' ->> p_perm)::boolean,
      (public.default_role_permissions() -> 'staff' ->> p_perm)::boolean, false)
    else false
  end
$$;

create or replace function public.user_team_role(p_user uuid, p_engagement_id uuid)
returns public.team_role language sql stable security definer set search_path = public as $$
  select t.team_role
  from public.engagement_team t
  join public.profiles p on p.id = t.user_id and p.is_active and p.app_role in ('super_admin', 'admin', 'staff')
  where t.engagement_id = p_engagement_id and t.user_id = p_user
$$;

-- Firm-side visibility of an engagement
create or replace function public.user_can_view_engagement_firm(p_user uuid, p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.user_app_role(p_user) in ('super_admin', 'admin', 'staff'), false)
     and (
          public.user_app_role(p_user) = 'super_admin'
       or public.user_team_role(p_user, p_engagement_id) is not null
       or exists (select 1 from public.engagements e where e.id = p_engagement_id and e.created_by = p_user)
       or public.user_has_app_permission(p_user, 'view_all_engagements')
     )
$$;

-- Client access to the request list (released engagements only)
create or replace function public.user_is_engagement_client(p_user uuid, p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.engagement_client_access a
    join public.client_contacts c on c.id = a.contact_id
    join public.engagements e on e.id = a.engagement_id
    join public.profiles p on p.id = c.user_id and p.is_active and p.app_role = 'client'
    where a.engagement_id = p_engagement_id
      and a.revoked_at is null
      and c.user_id = p_user
      and e.status not in ('draft', 'awaiting_approval')
  )
$$;

-- Client user with (unrevoked) access, whatever the engagement status
create or replace function public.user_has_engagement_client_access(p_user uuid, p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.engagement_client_access a
    join public.client_contacts c on c.id = a.contact_id
    join public.profiles p on p.id = c.user_id and p.is_active and p.app_role = 'client'
    where a.engagement_id = p_engagement_id and a.revoked_at is null and c.user_id = p_user
  )
$$;

-- -----------------------------------------------------------------------------
-- Current-user helpers (same names as before; new meaning documented)
-- -----------------------------------------------------------------------------
-- Firm user who can SEE the engagement (team, creator, view_all, super admin).
create or replace function public.is_engagement_member(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_can_view_engagement_firm(auth.uid(), p_engagement_id)
$$;

-- On the engagement team (or Super admin): may WORK on it (comment, review,
-- upload firm documents, add events, schedules...). Firm users who only see an
-- engagement (creator, view_all) are read-only.
create or replace function public.is_engagement_team(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_super_admin(), false) or public.team_role_on(p_engagement_id) is not null
$$;

-- Partner, team lead or manager (or Super admin): edit the list, invite
-- clients, approve & release, move stages, change the lead.
create or replace function public.can_manage_engagement(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_super_admin(), false)
      or coalesce(public.team_role_on(p_engagement_id)::text in ('partner', 'lead', 'manager'), false)
$$;

-- Partner or team lead (or Super admin): waive critical items, complete with
-- open items, archive. (Name kept for compatibility.)
create or replace function public.is_engagement_lead(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_super_admin(), false)
      or coalesce(public.team_role_on(p_engagement_id)::text in ('partner', 'lead'), false)
$$;

create or replace function public.can_accept_items(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_super_admin(), false)
      or coalesce(public.team_role_on(p_engagement_id)::text in ('partner', 'lead'), false)
      or (coalesce(public.team_role_on(p_engagement_id)::text = 'manager', false)
          and not (select lead_only_acceptance from public.engagements where id = p_engagement_id))
$$;

create or replace function public.is_engagement_client(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_is_engagement_client(auth.uid(), p_engagement_id)
$$;

create or replace function public.has_engagement_client_access(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_has_engagement_client_access(auth.uid(), p_engagement_id)
$$;

-- Engagement managers may add / update contacts of THEIR client (invite flow);
-- client master data otherwise needs manage_clients.
create or replace function public.can_manage_client_contacts(p_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_app_permission('manage_clients')
      or exists (select 1 from public.engagements e where e.client_id = p_client_id and public.can_manage_engagement(e.id))
$$;

-- -----------------------------------------------------------------------------
-- 2. Policies: is_admin() replaced by role permissions
-- -----------------------------------------------------------------------------
-- Engagement types are a Settings concern (Super admin)
drop policy if exists engagement_types_admin_ins on public.engagement_types;
create policy engagement_types_admin_ins on public.engagement_types
  for insert to authenticated with check (public.is_super_admin());
drop policy if exists engagement_types_admin_upd on public.engagement_types;
create policy engagement_types_admin_upd on public.engagement_types
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- Master checklist (Agent B's 0009 also sets these; kept identical)
drop policy if exists master_categories_admin_ins on public.master_categories;
create policy master_categories_admin_ins on public.master_categories
  for insert to authenticated with check (public.has_app_permission('manage_checklist'));
drop policy if exists master_categories_admin_upd on public.master_categories;
create policy master_categories_admin_upd on public.master_categories
  for update to authenticated using (public.has_app_permission('manage_checklist')) with check (public.has_app_permission('manage_checklist'));
drop policy if exists master_items_admin_ins on public.master_checklist_items;
create policy master_items_admin_ins on public.master_checklist_items
  for insert to authenticated with check (public.has_app_permission('manage_checklist'));
drop policy if exists master_items_admin_upd on public.master_checklist_items;
create policy master_items_admin_upd on public.master_checklist_items
  for update to authenticated using (public.has_app_permission('manage_checklist')) with check (public.has_app_permission('manage_checklist'));
drop policy if exists master_item_types_admin_ins on public.master_item_engagement_types;
create policy master_item_types_admin_ins on public.master_item_engagement_types
  for insert to authenticated with check (public.has_app_permission('manage_checklist'));
drop policy if exists master_item_types_admin_del on public.master_item_engagement_types;
create policy master_item_types_admin_del on public.master_item_engagement_types
  for delete to authenticated using (public.has_app_permission('manage_checklist'));

-- Settings, templates, reminder rules, audit log: Super admin
drop policy if exists settings_admin_ins on public.app_settings;
create policy settings_admin_ins on public.app_settings for insert to authenticated with check (public.is_super_admin());
drop policy if exists settings_admin_upd on public.app_settings;
create policy settings_admin_upd on public.app_settings for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists reminder_rules_admin_all on public.reminder_rules;
create policy reminder_rules_admin_all on public.reminder_rules for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists email_templates_admin_all on public.email_templates;
create policy email_templates_admin_all on public.email_templates for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists audit_select_admin on public.audit_log;
create policy audit_select_admin on public.audit_log for select to authenticated using (public.is_super_admin());

-- Client contacts: manage_clients, or the engagement managers of that client
drop policy if exists contacts_insert_staff on public.client_contacts;
create policy contacts_insert_staff on public.client_contacts
  for insert to authenticated with check (public.is_staff() and public.can_manage_client_contacts(client_id));
drop policy if exists contacts_update_staff on public.client_contacts;
create policy contacts_update_staff on public.client_contacts
  for update to authenticated using (public.is_staff() and public.can_manage_client_contacts(client_id))
  with check (public.is_staff() and public.can_manage_client_contacts(client_id));

-- Calendar events: only the team works on them (viewers read)
drop policy if exists events_insert_team on public.engagement_events;
create policy events_insert_team on public.engagement_events
  for insert to authenticated with check (public.is_engagement_team(engagement_id));
drop policy if exists events_update_team on public.engagement_events;
create policy events_update_team on public.engagement_events
  for update to authenticated using (public.is_engagement_team(engagement_id))
  with check (public.is_engagement_team(engagement_id));
drop policy if exists events_delete_team on public.engagement_events;
create policy events_delete_team on public.engagement_events
  for delete to authenticated using (public.is_engagement_team(engagement_id));

-- -----------------------------------------------------------------------------
-- 3. Engagement team: partner role, exactly one lead, lead_id in sync
-- -----------------------------------------------------------------------------
-- Data repair before the unique index: every engagement gets exactly one lead
-- row matching engagements.lead_id.
update public.engagement_team t set team_role = 'manager'
from public.engagements e
where e.id = t.engagement_id and t.team_role = 'lead' and t.user_id <> e.lead_id
  and exists (select 1 from public.engagement_team x where x.engagement_id = e.id and x.user_id = e.lead_id);
insert into public.engagement_team (engagement_id, user_id, team_role)
select e.id, e.lead_id, 'lead' from public.engagements e
where not exists (select 1 from public.engagement_team t where t.engagement_id = e.id and t.team_role = 'lead')
on conflict (engagement_id, user_id) do update set team_role = 'lead';
update public.engagements e set lead_id = t.user_id
from public.engagement_team t
where t.engagement_id = e.id and t.team_role = 'lead' and e.lead_id <> t.user_id;

create unique index if not exists engagement_team_one_lead_uq
  on public.engagement_team (engagement_id) where team_role = 'lead';

-- Team rows: firm users only; the lead row drives engagements.lead_id
create or replace function public.tg_engagement_team_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = new.user_id and is_active and app_role in ('super_admin', 'admin', 'staff')) then
    raise exception 'Only active firm users can be on the engagement team';
  end if;
  return new;
end $$;
drop trigger if exists engagement_team_guard on public.engagement_team;
create trigger engagement_team_guard before insert or update of user_id on public.engagement_team
  for each row execute function public.tg_engagement_team_guard();

create or replace function public.tg_engagement_team_sync_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.team_role::text = 'lead' then
    update public.engagements set lead_id = new.user_id where id = new.engagement_id and lead_id is distinct from new.user_id;
  end if;
  return null;
end $$;
drop trigger if exists engagement_team_sync_lead on public.engagement_team;
create trigger engagement_team_sync_lead after insert or update of team_role, user_id on public.engagement_team
  for each row execute function public.tg_engagement_team_sync_lead();

-- Direct writes: never the lead row (set_engagement_lead does that); partner
-- rows only by a partner, the lead or a Super admin.
drop policy if exists team_insert on public.engagement_team;
create policy team_insert on public.engagement_team
  for insert to authenticated with check (
    public.can_manage_engagement(engagement_id) and team_role::text <> 'lead'
    and (team_role::text <> 'partner' or public.is_engagement_lead(engagement_id)));
drop policy if exists team_update on public.engagement_team;
create policy team_update on public.engagement_team
  for update to authenticated using (
    public.can_manage_engagement(engagement_id) and team_role::text <> 'lead'
    and (team_role::text <> 'partner' or public.is_engagement_lead(engagement_id)))
  with check (
    public.can_manage_engagement(engagement_id) and team_role::text <> 'lead'
    and (team_role::text <> 'partner' or public.is_engagement_lead(engagement_id)));
drop policy if exists team_delete on public.engagement_team;
create policy team_delete on public.engagement_team
  for delete to authenticated using (
    public.can_manage_engagement(engagement_id) and team_role::text <> 'lead'
    and (team_role::text <> 'partner' or public.is_engagement_lead(engagement_id)));

-- Change the team lead: Super admin, a partner, the current lead or a manager.
-- The previous lead becomes a manager.
create or replace function public.set_engagement_lead(p_engagement_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_eng record; v_old uuid;
begin
  if not public.can_manage_engagement(p_engagement_id) then
    raise exception 'Only a partner, the team lead or a manager can change the team lead' using errcode = '42501';
  end if;
  select * into v_eng from public.engagements where id = p_engagement_id for update;
  if v_eng.id is null then raise exception 'Engagement not found'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and is_active and app_role in ('super_admin', 'admin', 'staff')) then
    raise exception 'The team lead must be an active firm user';
  end if;
  select user_id into v_old from public.engagement_team where engagement_id = p_engagement_id and team_role = 'lead';
  if v_old = p_user_id then return; end if;
  update public.engagement_team set team_role = 'manager' where engagement_id = p_engagement_id and team_role = 'lead';
  insert into public.engagement_team (engagement_id, user_id, team_role, added_by)
  values (p_engagement_id, p_user_id, 'lead', auth.uid())
  on conflict (engagement_id, user_id) do update set team_role = 'lead';
  perform public.notify(p_user_id, 'lead_assigned', 'You are now the team lead: ' || v_eng.name,
    public.actor_name(auth.uid()) || ' made you the team lead on ' || v_eng.code || '.', p_engagement_id);
end $$;

-- -----------------------------------------------------------------------------
-- 4. Engagement codes (configurable format) and create_engagement
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value)
values ('engagement_code_format', to_jsonb('{PREFIX}-{YYYY}-{SEQ4}'::text))
on conflict (key) do nothing;

-- Tokens: {PREFIX} {YYYY} {YY} {SEQ} {SEQ3} {SEQ4} {SEQ5} {SEQ6}
create or replace function public.format_engagement_code(p_format text, p_prefix text, p_year int, p_seq int)
returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(p_format,
    '{PREFIX}', coalesce(p_prefix, '')),
    '{YYYY}', lpad(p_year::text, 4, '0')),
    '{YY}', right(lpad(p_year::text, 4, '0'), 2)),
    '{SEQ6}', lpad(p_seq::text, 6, '0')),
    '{SEQ5}', lpad(p_seq::text, 5, '0')),
    '{SEQ4}', lpad(p_seq::text, 4, '0')),
    '{SEQ3}', lpad(p_seq::text, 3, '0')),
    '{SEQ}', p_seq::text)
$$;

create or replace function public.valid_engagement_code_format(p_format text)
returns boolean language sql immutable as $$
  select p_format is not null
     and length(p_format) between 3 and 40
     and p_format ~ '\{SEQ[3-6]?\}'
     -- only known tokens and safe literal characters (codes become folder names)
     and regexp_replace(p_format, '\{(PREFIX|YYYY|YY|SEQ|SEQ3|SEQ4|SEQ5|SEQ6)\}', '', 'g') ~ '^[A-Za-z0-9._-]*$'
$$;

-- Next code. Counters stay keyed by (prefix, year); a format without a year
-- token uses year 0 and one without {PREFIX} shares the '*' counter, so codes
-- never repeat. Existing codes never change.
create or replace function public.next_engagement_code(p_prefix text, p_year int)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_fmt text := public.setting('engagement_code_format') #>> '{}';
  v_key_prefix text; v_key_year int; v_no int; v_code text; v_tries int := 0;
begin
  if not public.valid_engagement_code_format(v_fmt) then v_fmt := '{PREFIX}-{YYYY}-{SEQ4}'; end if;
  v_key_prefix := case when v_fmt like '%{PREFIX}%' then p_prefix else '*' end;
  v_key_year := case when v_fmt ~ '\{YYYY\}|\{YY\}' then p_year else 0 end;
  loop
    insert into public.engagement_code_counters (prefix, year, last_no) values (v_key_prefix, v_key_year, 1)
    on conflict (prefix, year) do update set last_no = engagement_code_counters.last_no + 1
    returning last_no into v_no;
    v_code := public.format_engagement_code(v_fmt, p_prefix, p_year, v_no);
    exit when not exists (select 1 from public.engagements where code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 1000 then raise exception 'Could not generate a unique engagement code; check the code format in Settings'; end if;
  end loop;
  return v_code;
end $$;

-- The value critical template items are bumped to ('high', renamed
-- 'important' by 0009): the third priority, whatever its label.
create or replace function public.item_priority_important()
returns public.item_priority language sql stable as $$
  select (enum_range(null::public.item_priority))[3]
$$;

-- p_team: [{"user_id": uuid, "team_role": "partner"|"manager"|"member"}]
-- p_lead_id: the team lead (required). The caller is not added automatically.
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
  v_eng_id uuid; v_code text; v_prefix text; v_client_name text; v_root text; r record; v_sort int := 0;
begin
  if not public.is_staff() or not public.has_app_permission('create_engagements') then
    raise exception 'You do not have permission to create engagements' using errcode = '42501';
  end if;
  if p_lead_id is null then raise exception 'Choose the team lead'; end if;
  if not exists (select 1 from public.profiles where id = p_lead_id and app_role in ('super_admin','admin','staff') and is_active) then
    raise exception 'The team lead must be an active firm user';
  end if;
  select code_prefix into v_prefix from public.engagement_types where id = p_engagement_type_id and is_active;
  if v_prefix is null then raise exception 'Unknown or inactive engagement type'; end if;
  select name into v_client_name from public.clients where id = p_client_id and is_active;
  if v_client_name is null then raise exception 'Unknown or inactive client'; end if;
  if p_documents_due is not null and p_report_due is not null and p_report_due < p_documents_due then
    raise exception 'The report due date cannot be before the documents due date';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_team, '[]'::jsonb)) m
             where coalesce(nullif(m ->> 'team_role', ''), 'member') not in ('partner', 'manager', 'member')) then
    raise exception 'Team roles must be partner, manager or member (the team lead is chosen separately)';
  end if;

  perform set_config('app.workflow', 'on', true);
  perform set_config('app.status_note', 'Engagement created', true);

  v_code := public.next_engagement_code(v_prefix, extract(year from p_period_end)::int);
  v_root := 'PBC/' || public.path_segment(v_client_name) || '/' || public.path_segment(v_code);

  insert into public.engagements (code, client_id, engagement_type_id, name, period_start, period_end,
                                  lead_id, created_by, storage_root, planned_start, documents_due, report_due)
  values (v_code, p_client_id, p_engagement_type_id, coalesce(nullif(trim(p_name), ''), v_client_name || ' ' || v_code),
          p_period_start, p_period_end, p_lead_id, auth.uid(), v_root, p_planned_start, p_documents_due, p_report_due)
  returning id into v_eng_id;

  insert into public.engagement_team (engagement_id, user_id, team_role, added_by)
  values (v_eng_id, p_lead_id, 'lead', auth.uid());

  insert into public.engagement_team (engagement_id, user_id, team_role, added_by)
  select distinct on ((m ->> 'user_id')::uuid)
         v_eng_id, (m ->> 'user_id')::uuid, coalesce(nullif(m ->> 'team_role', ''), 'member')::public.team_role, auth.uid()
  from jsonb_array_elements(coalesce(p_team, '[]'::jsonb)) m
  join public.profiles p on p.id = (m ->> 'user_id')::uuid and p.app_role in ('super_admin','admin','staff') and p.is_active
  where (m ->> 'user_id')::uuid <> p_lead_id
  on conflict do nothing;

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
         case when mi.is_critical and mi.default_priority in ('low','normal') then public.item_priority_important()
              else mi.default_priority end,
         p_default_due_date, mc.sort_order * 1000 + mi.sort_order
  from public.master_checklist_items mi
  join public.master_categories mc on mc.id = mi.category_id
  join public.engagement_folders f on f.engagement_id = v_eng_id and lower(f.name) = lower(mi.default_folder) and f.parent_id is null
  where mi.id = any(coalesce(p_master_item_ids, '{}')) and mi.is_active;

  return v_eng_id;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Assignees, locking and item visibility
-- -----------------------------------------------------------------------------
alter table public.request_items
  add column if not exists is_locked  boolean not null default false,
  add column if not exists created_by uuid references public.profiles (id) on delete set null;
comment on column public.request_items.is_locked is
  'Locked: only assignees see it (clients: client assignees; firm: firm assignees, partners, the lead, managers, the creator and Super admins)';
comment on column public.request_items.created_by is
  'Who added the item individually (null for items generated from the master checklist)';

create table if not exists public.request_item_assignees (
  request_item_id  uuid not null references public.request_items (id) on delete cascade,
  engagement_id    uuid not null references public.engagements (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  side             public.document_side not null,
  assigned_by      uuid references public.profiles (id) on delete set null,
  assigned_at      timestamptz not null default now(),
  primary key (request_item_id, user_id)
);
create index if not exists request_item_assignees_user_idx on public.request_item_assignees (user_id, engagement_id);
create index if not exists request_item_assignees_engagement_idx on public.request_item_assignees (engagement_id);

-- Side and engagement always derived server-side
create or replace function public.tg_item_assignee_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role public.app_role;
begin
  select engagement_id into new.engagement_id from public.request_items where id = new.request_item_id;
  if new.engagement_id is null then raise exception 'Request item not found'; end if;
  select app_role into v_role from public.profiles where id = new.user_id;
  if v_role is null then raise exception 'User not found'; end if;
  new.side := case when v_role = 'client' then 'client'::public.document_side else 'firm'::public.document_side end;
  return new;
end $$;
drop trigger if exists request_item_assignees_fill on public.request_item_assignees;
create trigger request_item_assignees_fill before insert or update on public.request_item_assignees
  for each row execute function public.tg_item_assignee_fill();

-- Migrate the single assignee column, then retire it
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'request_items' and column_name = 'assignee_id') then
    insert into public.request_item_assignees (request_item_id, engagement_id, user_id, side, assigned_at)
    select ri.id, ri.engagement_id, ri.assignee_id,
           case when p.app_role = 'client' then 'client'::public.document_side else 'firm'::public.document_side end,
           ri.updated_at
    from public.request_items ri
    join public.profiles p on p.id = ri.assignee_id
    where ri.assignee_id is not null
      and (exists (select 1 from public.engagement_team t where t.engagement_id = ri.engagement_id and t.user_id = ri.assignee_id)
           or public.user_has_engagement_client_access(ri.assignee_id, ri.engagement_id))
    on conflict do nothing;
    alter table public.request_items drop column assignee_id;
  end if;
end $$;

alter table public.request_item_assignees enable row level security;
revoke all on public.request_item_assignees from anon, authenticated;
grant select on public.request_item_assignees to authenticated;

drop trigger if exists audit_request_item_assignees on public.request_item_assignees;
create trigger audit_request_item_assignees after insert or update or delete on public.request_item_assignees
  for each row execute function public.tg_audit_row('request_item_assignee');

-- THE item visibility rule. Agent B's reminder e-mails call this signature.
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
             or i.created_by = p_user
             or exists (select 1 from public.request_item_assignees a
                        where a.request_item_id = i.id and a.user_id = p_user and a.side = 'firm')
             or coalesce(public.user_team_role(p_user, i.engagement_id)::text in ('partner', 'lead', 'manager'), false))
      else false
    end
    from public.request_items i
    cross join (select public.user_app_role(p_user) as role) r
    where i.id = p_item
  ), false)
$$;

create or replace function public.can_view_request_item(p_item uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_user_view_request_item(auth.uid(), p_item)
$$;

-- Items and everything derived from them
drop policy if exists items_select on public.request_items;
create policy items_select on public.request_items
  for select to authenticated using (public.can_view_request_item(id));
drop policy if exists items_update_manage on public.request_items;
create policy items_update_manage on public.request_items
  for update to authenticated using (public.can_edit_request_list(engagement_id) and public.can_view_request_item(id))
  with check (public.can_edit_request_list(engagement_id));

drop policy if exists files_select_team on public.request_item_files;
create policy files_select_team on public.request_item_files
  for select to authenticated using (public.is_engagement_member(engagement_id) and public.can_view_request_item(request_item_id));
drop policy if exists files_select_client on public.request_item_files;
create policy files_select_client on public.request_item_files
  for select to authenticated using (
    public.is_engagement_client(engagement_id)
    and (submitted_at is not null or uploaded_by = auth.uid())
    and public.can_view_request_item(request_item_id));

drop policy if exists comments_select_team on public.comments;
create policy comments_select_team on public.comments
  for select to authenticated using (public.is_engagement_member(engagement_id) and public.can_view_request_item(request_item_id));
drop policy if exists comments_select_client on public.comments;
create policy comments_select_client on public.comments
  for select to authenticated using (public.is_engagement_client(engagement_id) and not is_internal and public.can_view_request_item(request_item_id));
drop policy if exists comments_insert_team on public.comments;
create policy comments_insert_team on public.comments
  for insert to authenticated with check (
    author_id = auth.uid() and public.is_engagement_team(engagement_id) and public.can_view_request_item(request_item_id));
drop policy if exists comments_insert_client on public.comments;
create policy comments_insert_client on public.comments
  for insert to authenticated with check (
    author_id = auth.uid() and not is_internal and public.is_engagement_client(engagement_id)
    and public.can_view_request_item(request_item_id));

drop policy if exists history_select on public.status_history;
create policy history_select on public.status_history
  for select to authenticated using (
    public.is_engagement_member(engagement_id)
    and (entity_type <> 'request_item' or public.can_view_request_item(entity_id)));

drop policy if exists sample_schedules_select on public.sample_schedules;
create policy sample_schedules_select on public.sample_schedules
  for select to authenticated using (public.can_view_request_item(request_item_id));
drop policy if exists sample_lines_select on public.sample_lines;
create policy sample_lines_select on public.sample_lines
  for select to authenticated using (public.can_view_request_item(request_item_id));

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (
    user_id = auth.uid() and (request_item_id is null or public.can_view_request_item(request_item_id)));
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated using (
    user_id = auth.uid() and (request_item_id is null or public.can_view_request_item(request_item_id)))
  with check (user_id = auth.uid());

drop policy if exists assignees_select on public.request_item_assignees;
create policy assignees_select on public.request_item_assignees
  for select to authenticated using (public.can_view_request_item(request_item_id));

-- Notifications never reach someone who cannot see the item (central check;
-- the notifications RLS above hides them as well if access changes later).
create or replace function public.notify(
  p_user uuid, p_type text, p_title text, p_body text,
  p_engagement_id uuid, p_item_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_is_client boolean; v_link text;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if p_item_id is not null and not public.can_user_view_request_item(p_user, p_item_id) then return; end if;
  select app_role = 'client' into v_is_client from public.profiles where id = p_user and is_active;
  if v_is_client is null then return; end if;
  v_link := case when v_is_client then '/portal/' else '/engagements/' end
            || p_engagement_id::text
            || case when p_item_id is not null then '?item=' || p_item_id::text else '' end;
  insert into public.notifications (user_id, type, title, body, link, engagement_id, request_item_id)
  values (p_user, p_type, p_title, left(p_body, 500), v_link, p_engagement_id, p_item_id);
end $$;

-- Firm people to tell about client activity on an item: its firm assignees,
-- or the team lead when nobody is assigned.
create or replace function public.item_firm_recipients(p_item uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select a.user_id from public.request_item_assignees a where a.request_item_id = p_item and a.side = 'firm'
  union
  select e.lead_id from public.request_items i join public.engagements e on e.id = i.engagement_id
  where i.id = p_item
    and not exists (select 1 from public.request_item_assignees a where a.request_item_id = p_item and a.side = 'firm')
$$;

-- Replace one side's assignees (internal; callers check permissions).
create or replace function public.apply_item_assignees(p_item_id uuid, p_side public.document_side, p_user_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_item record; v_ids uuid[]; v_new uuid[]; v_bad uuid; u uuid;
begin
  select * into v_item from public.request_items where id = p_item_id;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  v_ids := coalesce(array(select distinct x from unnest(coalesce(p_user_ids, '{}')) x where x is not null), '{}');
  if p_side = 'firm' then
    select x into v_bad from unnest(v_ids) x where public.user_team_role(x, v_item.engagement_id) is null limit 1;
    if v_bad is not null then
      raise exception 'Only members of the engagement team can be assigned on the firm side';
    end if;
  else
    select x into v_bad from unnest(v_ids) x where not public.user_has_engagement_client_access(x, v_item.engagement_id) limit 1;
    if v_bad is not null then
      raise exception 'Only client users with access to this engagement can be assigned on the client side';
    end if;
  end if;
  v_new := array(select x from unnest(v_ids) x
                 where not exists (select 1 from public.request_item_assignees a where a.request_item_id = p_item_id and a.user_id = x));
  delete from public.request_item_assignees
  where request_item_id = p_item_id and side = p_side and not (user_id = any(v_ids));
  insert into public.request_item_assignees (request_item_id, engagement_id, user_id, side, assigned_by)
  select p_item_id, v_item.engagement_id, x, p_side, auth.uid() from unnest(v_new) x
  on conflict do nothing;
  foreach u in array v_new loop
    perform public.notify(u, 'item_assigned', 'Assigned to you: ' || v_item.code || ' ' || v_item.title,
      coalesce(public.actor_name(auth.uid()), 'The engagement team') || ' assigned this request to you.',
      v_item.engagement_id, p_item_id);
  end loop;
  return coalesce(cardinality(v_new), 0);
end $$;

-- Change who is assigned on one side ('firm' | 'client').
--   Locked item: partner / lead / manager (or Super admin) only.
--   Unlocked, firm side: anyone on the engagement team.
--   Unlocked, client side: team members with edit rights on the list, or any
--   client user with access to the (released) engagement.
-- Returns the number of people newly assigned (they are notified).
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
    v_ok := public.can_manage_engagement(v_item.engagement_id);
  elsif p_side = 'firm' then
    v_ok := v_team;
  else
    v_ok := public.can_edit_request_list(v_item.engagement_id) or v_client;
  end if;
  if not coalesce(v_ok, false) then raise exception 'Not permitted' using errcode = '42501'; end if;
  return public.apply_item_assignees(p_item_id, p_side::public.document_side, p_user_ids);
end $$;

-- Lock / unlock: partner, lead, manager (or Super admin), or whoever added the item.
create or replace function public.set_request_item_lock(p_item_id uuid, p_locked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_item record;
begin
  select * into v_item from public.request_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  if not public.can_view_request_item(p_item_id) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if not (public.can_manage_engagement(v_item.engagement_id)
          or (v_item.created_by = auth.uid() and public.is_engagement_team(v_item.engagement_id))) then
    raise exception 'Only a partner, the team lead, a manager or the person who added the request can lock it' using errcode = '42501';
  end if;
  update public.request_items set is_locked = coalesce(p_locked, false) where id = p_item_id;
end $$;

-- add_request_item: assignees and lock on creation; records the creator.
drop function if exists public.add_request_item(uuid, uuid, text, text, boolean, date, public.item_priority, uuid, uuid, text[]);
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

  select coalesce(max(nullif(regexp_replace(code, '^C-', ''), code)::int), 0) + 1 into v_n
  from public.request_items where engagement_id = p_engagement_id and code ~ '^C-\d+$';

  insert into public.request_items (engagement_id, folder_id, category_id, code, title, guidance,
                                    expected_file_types, is_critical, priority, due_date,
                                    sort_order, issued_at, is_locked, created_by)
  values (p_engagement_id, p_folder_id, p_category_id, 'C-' || lpad(v_n::text, 3, '0'), trim(p_title), p_guidance,
          coalesce(p_expected_file_types, '{}'), coalesce(p_is_critical, false), coalesce(p_priority, 'normal'),
          p_due_date,
          coalesce((select max(sort_order) + 10 from public.request_items where folder_id = p_folder_id), 10),
          case when v_status <> 'draft' then now() end,
          coalesce(p_is_locked, false), auth.uid())
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
-- 6. Item workflow re-checks item visibility
-- -----------------------------------------------------------------------------
create or replace function public.delete_request_item(p_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_eng uuid;
begin
  select engagement_id into v_eng from public.request_items where id = p_item_id;
  if v_eng is null or not public.can_edit_request_list(v_eng) or not public.can_view_request_item(p_item_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.request_item_files where request_item_id = p_item_id) then
    raise exception 'This item has uploaded files. Mark it Not Applicable instead of deleting it.';
  end if;
  delete from public.request_items where id = p_item_id;
end $$;

drop function if exists public.begin_upload(uuid, text, text, bigint, public.file_kind, uuid);
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
  v_member := public.is_engagement_team(v_item.engagement_id);
  if not (v_member or public.is_engagement_client(v_item.engagement_id)) or not public.can_view_request_item(p_item_id) then
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
      raise exception 'Uploads are closed for this engagement (%).', public.stage_label(v_eng.status);
    end if;
    if v_line.status in ('received', 'not_applicable') then
      raise exception 'Line % is % and cannot receive new files.', v_line.line_no, replace(v_line.status::text, '_', ' ');
    end if;
    v_version := 1;
    v_suffix := '_L' || v_line.line_no;
  else
    if v_eng.status not in ('pre_engagement', 'acceptance_review', 'accepted', 'in_progress') then
      raise exception 'Uploads are closed for this engagement (%).', public.stage_label(v_eng.status);
    end if;
    if v_item.status not in ('requested', 'queried', 'submitted') then
      raise exception 'This item is % and cannot receive new files.', replace(v_item.status::text, '_', ' ');
    end if;
    v_version := case when v_item.status = 'submitted' then greatest(v_item.current_version, 1)
                      else v_item.current_version + 1 end;
    v_suffix := '';
  end if;

  -- Firm-wide allowed types and size only (no per-item restrictions)
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

create or replace function public.complete_upload(p_file_id uuid, p_user_id uuid, p_sha256 text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_file record; v_line record; v_item record; v_eng record; v_is_client boolean; u uuid;
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
      for u in select * from public.item_firm_recipients(v_item.id) loop
        if u <> p_user_id then
          perform public.notify(u, 'sample_provided', 'Sample line ' || v_line.line_no || ' provided: ' || v_item.code,
            public.actor_name(p_user_id) || ' uploaded ' || v_file.file_name, v_eng.id, v_item.id);
        end if;
      end loop;
    end if;
  elsif v_file.kind = 'firm_document' and v_eng.status not in ('draft', 'awaiting_approval') then
    for u in select * from public.engagement_client_user_ids(v_eng.id) loop
      perform public.notify(u, 'firm_document', 'New document from the engagement team: ' || v_item.code,
        v_file.file_name, v_eng.id, v_item.id);
    end loop;
  end if;
end $$;

create or replace function public.remove_draft_file(p_file_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_file record; v_line_status public.sample_line_status;
begin
  select * into v_file from public.request_item_files where id = p_file_id;
  if v_file.id is null then raise exception 'File not found'; end if;
  if not public.can_view_request_item(v_file.request_item_id)
     or not (v_file.uploaded_by = auth.uid() or public.can_manage_engagement(v_file.engagement_id)) then
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

create or replace function public.submit_item(p_item_id uuid, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_item record; v_eng record; v_version int; v_n int; v_is_client boolean; u uuid;
begin
  select * into v_item from public.request_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  v_is_client := public.is_engagement_client(v_item.engagement_id);
  if not (v_is_client or public.is_engagement_team(v_item.engagement_id)) or not public.can_view_request_item(p_item_id) then
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

  for u in select * from public.item_firm_recipients(p_item_id) loop
    perform public.notify(u, 'item_submitted',
      'New upload: ' || v_item.code || ' ' || v_item.title,
      public.actor_name(auth.uid()) || ' submitted ' || v_n || ' file(s) (version ' || v_version || ').',
      v_item.engagement_id, p_item_id);
  end loop;
  return v_version;
end $$;

create or replace function public.review_item(p_item_id uuid, p_action text, p_note text default null)
returns public.item_status language plpgsql security definer set search_path = public as $$
declare v_item record; v_eng record; v_to public.item_status; u uuid;
begin
  select * into v_item from public.request_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  if not public.is_engagement_team(v_item.engagement_id) or not public.can_view_request_item(p_item_id) then
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
        raise exception 'Critical items cannot be marked N/A. The partner or team lead can waive them with a reason.';
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

create or replace function public.waive_item(p_item_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_item record;
begin
  select * into v_item from public.request_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'Request item not found'; end if;
  if not public.is_engagement_lead(v_item.engagement_id) or not public.can_view_request_item(p_item_id) then
    raise exception 'Only the engagement lead or partner can waive critical items' using errcode = '42501';
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
  if v_item.id is null then raise exception 'Request item not found'; end if;
  if not public.is_engagement_lead(v_item.engagement_id) or not public.can_view_request_item(p_item_id) then
    raise exception 'Only the engagement lead or partner can remove a waiver' using errcode = '42501';
  end if;
  update public.request_items set is_waived = false, waiver_reason = null, waived_by = null, waived_at = null
  where id = p_item_id;
end $$;

-- Sample schedules
create or replace function public.add_sample_lines(p_schedule_id uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_s record; v_next int; r jsonb; v_cells text[]; v_n int := 0;
begin
  select * into v_s from public.sample_schedules where id = p_schedule_id for update;
  if v_s.id is null then raise exception 'Sample schedule not found'; end if;
  if not public.is_engagement_team(v_s.engagement_id) or not public.can_view_request_item(v_s.request_item_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'Paste at most 1,000 lines at a time'; end if;
  select coalesce(max(line_no), 0) into v_next from public.sample_lines where schedule_id = p_schedule_id;
  for r in select * from jsonb_array_elements(p_rows) loop
    select array(select left(coalesce(x, ''), 500) from jsonb_array_elements_text(r) x) into v_cells;
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
  if not public.is_engagement_team(v_item.engagement_id) or not public.can_view_request_item(p_item_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.sample_schedules where request_item_id = p_item_id) then
    raise exception 'This item already has a sample schedule. Add lines to it instead.';
  end if;
  v_cols := array(select left(coalesce(nullif(trim(c), ''), 'Column ' || i), 60)
                  from unnest(p_columns) with ordinality as t(c, i));
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

create or replace function public.delete_sample_line(p_line_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_line record;
begin
  select * into v_line from public.sample_lines where id = p_line_id;
  if v_line.id is null then raise exception 'Line not found'; end if;
  if not public.is_engagement_team(v_line.engagement_id) or not public.can_view_request_item(v_line.request_item_id) then
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
  if not public.is_engagement_team(v_s.engagement_id) or not public.can_view_request_item(v_s.request_item_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.request_item_files f join public.sample_lines l on l.id = f.sample_line_id
             where l.schedule_id = p_schedule_id) then
    raise exception 'The schedule has supporting files and is kept as part of the record';
  end if;
  delete from public.sample_schedules where id = p_schedule_id;
end $$;

create or replace function public.set_sample_line_status(
  p_line_ids uuid[], p_status public.sample_line_status, p_note text default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_line record; v_member boolean; v_client boolean; v_ok int := 0; v_item record; u uuid;
begin
  for v_line in select * from public.sample_lines where id = any(p_line_ids) for update loop
    v_member := public.is_engagement_team(v_line.engagement_id);
    v_client := public.is_engagement_client(v_line.engagement_id);
    if not (v_member or v_client) or not public.can_view_request_item(v_line.request_item_id) then
      raise exception 'Not permitted' using errcode = '42501';
    end if;

    if v_client and not v_member then
      if p_status <> 'provided' or v_line.status not in ('outstanding', 'queried') then
        raise exception 'You can only mark outstanding or queried lines as provided';
      end if;
    else
      if p_status = 'provided' then raise exception 'Use Received to confirm a line'; end if;
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

  if v_ok > 0 then
    select ri.* into v_item from public.request_items ri
    join public.sample_lines l on l.request_item_id = ri.id where l.id = p_line_ids[1];
    if p_status = 'queried' then
      for u in select * from public.engagement_client_user_ids(v_item.engagement_id) loop
        perform public.notify(u, 'sample_queried', 'Query on ' || v_ok || ' sample line(s): ' || v_item.code, trim(p_note),
                              v_item.engagement_id, v_item.id);
      end loop;
    elsif p_status = 'provided' then
      for u in select * from public.item_firm_recipients(v_item.id) loop
        perform public.notify(u, 'sample_provided', v_ok || ' sample line(s) marked provided: ' || v_item.code, null,
                              v_item.engagement_id, v_item.id);
      end loop;
    end if;
  end if;
  return v_ok;
end $$;

-- Comments: mentions only of team members who can see the item
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
      where public.can_user_view_request_item(m, new.request_item_id)
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

create or replace function public.tg_comment_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_item record; v_author_is_client boolean; v_recipients uuid[]; u uuid; v_title text;
begin
  if coalesce(current_setting('app.workflow', true), '') = 'on' then
    return null;
  end if;
  select * into v_item from public.request_items where id = new.request_item_id;
  select app_role = 'client' into v_author_is_client from public.profiles where id = new.author_id;

  v_recipients := new.mentions;
  if v_author_is_client then
    v_recipients := v_recipients || array(select * from public.item_firm_recipients(new.request_item_id));
  else
    v_recipients := v_recipients || array(select a.user_id from public.request_item_assignees a
                                          where a.request_item_id = new.request_item_id and a.side = 'firm');
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

-- Firm-side document uploads need the team (viewers are read-only)
create or replace function public.begin_document_upload(
  p_engagement_id uuid, p_file_name text, p_mime_type text, p_size_bytes bigint, p_description text default null
) returns table (document_id uuid, storage_path text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_eng record; v_member boolean; v_client boolean; v_side public.document_side;
  v_ext text; v_base text; v_allowed text[]; v_max_mb int; v_path text; v_id uuid;
begin
  v_member := public.is_engagement_team(p_engagement_id);
  v_client := public.is_engagement_client(p_engagement_id);
  if not (v_member or v_client) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select * into v_eng from public.engagements where id = p_engagement_id;
  if v_eng.status in ('archived', 'declined') then
    raise exception 'This engagement is closed for new documents (%).', public.stage_label(v_eng.status);
  end if;
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

-- -----------------------------------------------------------------------------
-- 7. Stages
--    Draft -> Approval -> Pre-execution -> Execution -> Completed (-> Archived)
--    acceptance_review / accepted / declined are legacy values shown as
--    Pre-execution.
-- -----------------------------------------------------------------------------
create or replace function public.default_stage_labels()
returns jsonb language sql immutable as $$
  select '{"draft": "Draft", "awaiting_approval": "Approval", "pre_engagement": "Pre-execution",
           "in_progress": "Execution", "completed": "Completed", "archived": "Archived"}'::jsonb
$$;

insert into public.app_settings (key, value) values ('stage_labels', public.default_stage_labels())
on conflict (key) do nothing;

-- Display name of a stage (Settings > Engagements). Legacy acceptance states
-- show as Pre-execution.
create or replace function public.stage_label(p_status public.engagement_status)
returns text language sql stable security definer set search_path = public as $$
  with k as (
    select case when p_status::text in ('acceptance_review', 'accepted', 'declined') then 'pre_engagement'
                else p_status::text end as key
  )
  select coalesce(nullif(trim(public.setting('stage_labels') ->> k.key), ''), public.default_stage_labels() ->> k.key, p_status::text)
  from k
$$;

-- The gate counts EVERY critical item (locked ones included). Internal only.
create or replace function public.critical_gate_all(p_engagement_id uuid)
returns table (critical_total int, critical_satisfied int)
language sql stable security definer set search_path = public as $$
  select count(*)::int, count(*) filter (where status = 'accepted' or is_waived)::int
  from public.request_items where engagement_id = p_engagement_id and is_critical
$$;

-- For display: only the critical items the caller can see.
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
    and public.can_view_request_item(id)
$$;

-- Stage moves (release to the client is issue_request_list):
--   Pre-execution -> Execution   partner / lead / manager; every critical item
--                                accepted or waived (no acceptance decision)
--   Execution -> Completed       partner / lead / manager when every item is
--                                accepted, waived or N/A; otherwise partner /
--                                lead only, with a mandatory reason (audited)
--   Execution -> Pre-execution, Completed -> Execution, -> Archived: partner / lead
--   Declined -> Pre-execution, Archived -> Completed: Super admin
create or replace function public.transition_engagement(
  p_engagement_id uuid, p_to public.engagement_status, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_from public.engagement_status; v_gate record; v_open int;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select status into v_from from public.engagements where id = p_engagement_id for update;
  if v_from is null or not public.is_engagement_member(p_engagement_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  if p_to = 'in_progress' and v_from in ('pre_engagement', 'acceptance_review', 'accepted') then
    if not public.can_manage_engagement(p_engagement_id) then
      raise exception 'Only a partner, the team lead or a manager can move the engagement to %', public.stage_label('in_progress')
        using errcode = '42501';
    end if;
    select * into v_gate from public.critical_gate_all(p_engagement_id);
    if v_gate.critical_satisfied < v_gate.critical_total then
      raise exception '% cannot start: % critical item(s) are not yet accepted or waived',
        public.stage_label('in_progress'), v_gate.critical_total - v_gate.critical_satisfied;
    end if;
  elsif p_to = 'completed' and v_from = 'in_progress' then
    if not public.can_manage_engagement(p_engagement_id) then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
    select count(*) into v_open from public.request_items
    where engagement_id = p_engagement_id and status not in ('accepted', 'not_applicable') and not is_waived;
    if v_open > 0 then
      if not public.is_engagement_lead(p_engagement_id) then
        raise exception '% item(s) are not yet accepted or N/A. Only a partner or the team lead can complete the engagement now.', v_open
          using errcode = '42501';
      end if;
      if v_note is null then
        raise exception 'A reason is required to complete the engagement with % open item(s)', v_open;
      end if;
      v_note := 'Completed with ' || v_open || ' open item(s). Reason: ' || v_note;
    end if;
  elsif p_to = 'pre_engagement' and v_from in ('acceptance_review', 'accepted') then
    -- legacy acceptance states are normalised back to Pre-execution
    if not public.can_manage_engagement(p_engagement_id) then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
  elsif (p_to = 'pre_engagement' and v_from = 'in_progress')
     or (p_to = 'in_progress' and v_from = 'completed')
     or (p_to = 'archived' and v_from in ('completed', 'declined')) then
    if not public.is_engagement_lead(p_engagement_id) then
      raise exception 'Only a partner or the team lead can do that' using errcode = '42501';
    end if;
  elsif (p_to = 'pre_engagement' and v_from = 'declined') or (p_to = 'completed' and v_from = 'archived') then
    if not public.is_super_admin() then
      raise exception 'Only a Super admin can do that' using errcode = '42501';
    end if;
  else
    raise exception 'Cannot move engagement from % to %', public.stage_label(v_from), public.stage_label(p_to);
  end if;

  perform set_config('app.workflow', 'on', true);
  perform set_config('app.status_note', coalesce(v_note, ''), true);
  update public.engagements set
    status = p_to,
    fieldwork_started_at = case when p_to = 'in_progress' and fieldwork_started_at is null then now() else fieldwork_started_at end,
    completed_at = case when p_to = 'completed' then now() else completed_at end,
    archived_at = case when p_to = 'archived' then now() when v_from = 'archived' then null else archived_at end
  where id = p_engagement_id;
end $$;

create or replace function public.submit_list_for_approval(p_engagement_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_eng record; v_n int; u uuid;
begin
  if not public.is_engagement_team(p_engagement_id) then
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
           where engagement_id = p_engagement_id and team_role::text in ('partner', 'lead', 'manager') loop
    perform public.notify(u, 'approval_requested', 'Request list ready for approval: ' || v_eng.name,
      public.actor_name(auth.uid()) || ' prepared ' || v_n || ' items for ' || v_eng.code || '.'
      || coalesce(' Note: ' || nullif(trim(p_note), ''), ''), p_engagement_id);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Realtime
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'request_item_assignees') then
      alter publication supabase_realtime add table public.request_item_assignees;
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Privileges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;

-- internal helpers: never callable by end users
revoke execute on function
  public.user_app_role(uuid), public.user_has_app_permission(uuid, text), public.user_team_role(uuid, uuid),
  public.user_can_view_engagement_firm(uuid, uuid), public.user_is_engagement_client(uuid, uuid),
  public.user_has_engagement_client_access(uuid, uuid), public.can_user_view_request_item(uuid, uuid),
  public.apply_item_assignees(uuid, public.document_side, uuid[]), public.item_firm_recipients(uuid),
  public.critical_gate_all(uuid), public.tg_engagement_team_guard(), public.tg_engagement_team_sync_lead(),
  public.tg_item_assignee_fill(), public.notify(uuid, text, text, text, uuid, uuid)
from authenticated;

grant execute on function
  public.is_engagement_member(uuid), public.is_engagement_team(uuid), public.can_manage_engagement(uuid),
  public.is_engagement_lead(uuid), public.can_accept_items(uuid), public.is_engagement_client(uuid),
  public.has_engagement_client_access(uuid), public.can_manage_client_contacts(uuid),
  public.can_view_request_item(uuid),
  public.set_engagement_lead(uuid, uuid),
  public.create_engagement(uuid, uuid, text, date, date, uuid, uuid[], date, jsonb, date, date, date, uuid[]),
  public.add_request_item(uuid, uuid, text, text, boolean, date, public.item_priority, uuid, text[], boolean, uuid[], uuid[]),
  public.set_request_item_assignees(uuid, text, uuid[]), public.set_request_item_lock(uuid, boolean),
  public.delete_request_item(uuid),
  public.begin_upload(uuid, text, text, bigint, public.file_kind, uuid),
  public.remove_draft_file(uuid), public.submit_item(uuid, text), public.review_item(uuid, text, text),
  public.waive_item(uuid, text), public.unwaive_item(uuid),
  public.add_sample_lines(uuid, jsonb), public.create_sample_schedule(uuid, text[], jsonb, text, text),
  public.delete_sample_line(uuid), public.delete_sample_schedule(uuid),
  public.set_sample_line_status(uuid[], public.sample_line_status, text),
  public.begin_document_upload(uuid, text, text, bigint, text),
  public.transition_engagement(uuid, public.engagement_status, text),
  public.submit_list_for_approval(uuid, text),
  public.critical_gate(uuid), public.stage_label(public.engagement_status), public.default_stage_labels(),
  public.format_engagement_code(text, text, int, int), public.valid_engagement_code_format(text),
  public.item_priority_important()
to authenticated;

-- server jobs (reminder e-mails, cron) use the per-user helpers
grant execute on function
  public.can_user_view_request_item(uuid, uuid), public.user_can_view_engagement_firm(uuid, uuid),
  public.user_is_engagement_client(uuid, uuid), public.user_has_app_permission(uuid, text),
  public.stage_label(public.engagement_status), public.item_firm_recipients(uuid)
to service_role;
grant execute on function public.complete_upload(uuid, uuid, text) to service_role;
revoke execute on function public.complete_upload(uuid, uuid, text) from authenticated;
