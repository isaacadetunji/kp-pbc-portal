-- =============================================================================
-- Kreston Pedabo PBC Portal — 0002 Access control
-- Helper functions, Row Level Security policies and column-level grants.
--
-- Principle: reads are governed by RLS; workflow state changes (statuses,
-- uploads, waivers, decisions) are NOT directly writable by any end user and
-- go through SECURITY DEFINER functions in 0003 that re-check permissions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can be used inside policies
-- without recursive RLS evaluation)
-- -----------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public as $$
  select app_role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('super_admin', 'admin'), false)
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('super_admin', 'admin', 'staff'), false)
$$;

-- Team role of the current user on an engagement (null if not on the team)
create or replace function public.team_role_on(p_engagement_id uuid)
returns public.team_role language sql stable security definer set search_path = public as $$
  select t.team_role
  from public.engagement_team t
  join public.profiles p on p.id = t.user_id and p.is_active and p.app_role in ('super_admin','admin','staff')
  where t.engagement_id = p_engagement_id and t.user_id = auth.uid()
$$;

create or replace function public.is_engagement_member(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.team_role_on(p_engagement_id) is not null
$$;

-- Lead / manager (or admin): can edit the request list, invite clients, etc.
create or replace function public.can_manage_engagement(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(public.team_role_on(p_engagement_id) in ('lead','manager'), false)
$$;

create or replace function public.is_engagement_lead(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(public.team_role_on(p_engagement_id) = 'lead', false)
$$;

-- Who may edit the request list (items, folders): the lead/manager at any
-- time, and any team member while the list is still being prepared (draft).
create or replace function public.can_edit_request_list(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_engagement(p_engagement_id)
      or (public.team_role_on(p_engagement_id) is not null
          and exists (select 1 from public.engagements where id = p_engagement_id and status = 'draft'))
$$;

-- Final acceptance rights: lead always; manager unless "lead only" is on.
create or replace function public.can_accept_items(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or coalesce(public.team_role_on(p_engagement_id) = 'lead', false)
      or (coalesce(public.team_role_on(p_engagement_id) = 'manager', false)
          and not (select lead_only_acceptance from public.engagements where id = p_engagement_id))
$$;

-- Client access: the user is a contact granted (and not revoked) on an
-- engagement that has been issued (never sees drafts).
create or replace function public.is_engagement_client(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.engagement_client_access a
    join public.client_contacts c on c.id = a.contact_id
    join public.engagements e on e.id = a.engagement_id
    join public.profiles p on p.id = c.user_id and p.is_active
    where a.engagement_id = p_engagement_id
      and a.revoked_at is null
      and c.user_id = auth.uid()
      and e.status not in ('draft', 'awaiting_approval')
  )
$$;

create or replace function public.can_view_engagement(p_engagement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_engagement_member(p_engagement_id) or public.is_engagement_client(p_engagement_id)
$$;

-- Is the current user a contact of the given client (any engagement)?
create or replace function public.is_client_contact_of(p_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.client_contacts where client_id = p_client_id and user_id = auth.uid())
$$;

revoke all on function public.current_app_role(), public.is_admin(), public.is_staff(),
  public.team_role_on(uuid), public.is_engagement_member(uuid), public.can_manage_engagement(uuid),
  public.is_engagement_lead(uuid), public.can_accept_items(uuid), public.is_engagement_client(uuid),
  public.can_view_engagement(uuid), public.is_client_contact_of(uuid), public.can_edit_request_list(uuid) from public, anon;
grant execute on function public.current_app_role(), public.is_admin(), public.is_staff(),
  public.team_role_on(uuid), public.is_engagement_member(uuid), public.can_manage_engagement(uuid),
  public.is_engagement_lead(uuid), public.can_accept_items(uuid), public.is_engagement_client(uuid),
  public.can_view_engagement(uuid), public.is_client_contact_of(uuid), public.can_edit_request_list(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------
alter table public.profiles                     enable row level security;
alter table public.clients                      enable row level security;
alter table public.client_contacts              enable row level security;
alter table public.engagement_types             enable row level security;
alter table public.master_categories            enable row level security;
alter table public.master_checklist_items       enable row level security;
alter table public.master_item_engagement_types enable row level security;
alter table public.master_item_revisions        enable row level security;
alter table public.engagements                  enable row level security;
alter table public.engagement_team              enable row level security;
alter table public.engagement_client_access     enable row level security;
alter table public.engagement_folders           enable row level security;
alter table public.request_items                enable row level security;
alter table public.request_item_files           enable row level security;
alter table public.comments                     enable row level security;
alter table public.status_history               enable row level security;
alter table public.acceptance_decisions         enable row level security;
alter table public.notifications                enable row level security;
alter table public.reminder_rules               enable row level security;
alter table public.email_templates              enable row level security;
alter table public.app_settings                 enable row level security;
alter table public.audit_log                    enable row level security;
alter table public.engagement_code_counters     enable row level security;

-- Nothing for anonymous users.
revoke all on all tables in schema public from anon;

-- Start authenticated users from zero and grant deliberately.
revoke all on all tables in schema public from authenticated;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (full_name, phone, job_title, last_seen_at) on public.profiles to authenticated;

create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_select_staff on public.profiles
  for select to authenticated using (public.is_staff());
-- Clients can see the team on their engagements and fellow contacts
create policy profiles_select_client_context on public.profiles
  for select to authenticated using (
    exists (
      select 1 from public.engagement_team t
      where t.user_id = profiles.id and public.is_engagement_client(t.engagement_id)
    )
  );
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- clients & contacts (writes happen via the service role in admin sync, or
-- via manager policies for contacts)
-- -----------------------------------------------------------------------------
grant select on public.clients to authenticated;
create policy clients_select_staff on public.clients
  for select to authenticated using (public.is_staff());
create policy clients_select_own on public.clients
  for select to authenticated using (public.is_client_contact_of(id));

grant select, insert, update on public.client_contacts to authenticated;
create policy contacts_select_staff on public.client_contacts
  for select to authenticated using (public.is_staff());
create policy contacts_select_self on public.client_contacts
  for select to authenticated using (user_id = auth.uid());
create policy contacts_insert_staff on public.client_contacts
  for insert to authenticated with check (public.is_staff());
create policy contacts_update_staff on public.client_contacts
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- reference + master checklist
-- -----------------------------------------------------------------------------
grant select on public.engagement_types, public.master_categories to authenticated;
grant insert, update on public.engagement_types, public.master_categories to authenticated;
create policy engagement_types_select on public.engagement_types for select to authenticated using (true);
create policy engagement_types_admin_ins on public.engagement_types for insert to authenticated with check (public.is_admin());
create policy engagement_types_admin_upd on public.engagement_types for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy master_categories_select on public.master_categories for select to authenticated using (true);
create policy master_categories_admin_ins on public.master_categories for insert to authenticated with check (public.is_admin());
create policy master_categories_admin_upd on public.master_categories for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.master_checklist_items to authenticated;
create policy master_items_select on public.master_checklist_items for select to authenticated using (public.is_staff());
create policy master_items_admin_ins on public.master_checklist_items for insert to authenticated with check (public.is_admin());
create policy master_items_admin_upd on public.master_checklist_items for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, delete on public.master_item_engagement_types to authenticated;
create policy master_item_types_select on public.master_item_engagement_types for select to authenticated using (public.is_staff());
create policy master_item_types_admin_ins on public.master_item_engagement_types for insert to authenticated with check (public.is_admin());
create policy master_item_types_admin_del on public.master_item_engagement_types for delete to authenticated using (public.is_admin());

grant select on public.master_item_revisions to authenticated;
create policy master_revisions_select on public.master_item_revisions for select to authenticated using (public.is_staff());

-- -----------------------------------------------------------------------------
-- engagements (created via create_engagement(); status via functions only)
-- -----------------------------------------------------------------------------
grant select on public.engagements to authenticated;
grant update (name, period_start, period_end, lead_only_acceptance, max_upload_mb) on public.engagements to authenticated;
create policy engagements_select on public.engagements
  for select to authenticated using (public.can_view_engagement(id));
create policy engagements_update_manage on public.engagements
  for update to authenticated using (public.can_manage_engagement(id)) with check (public.can_manage_engagement(id));

grant select, insert, update, delete on public.engagement_team to authenticated;
create policy team_select on public.engagement_team
  for select to authenticated using (public.can_view_engagement(engagement_id));
create policy team_insert on public.engagement_team
  for insert to authenticated with check (public.can_manage_engagement(engagement_id) and team_role <> 'lead');
create policy team_update on public.engagement_team
  for update to authenticated using (public.can_manage_engagement(engagement_id) and team_role <> 'lead')
  with check (public.can_manage_engagement(engagement_id) and team_role <> 'lead');
create policy team_delete on public.engagement_team
  for delete to authenticated using (public.can_manage_engagement(engagement_id) and team_role <> 'lead');

grant select, insert, update on public.engagement_client_access to authenticated;
create policy client_access_select_team on public.engagement_client_access
  for select to authenticated using (public.is_engagement_member(engagement_id));
create policy client_access_select_self on public.engagement_client_access
  for select to authenticated using (
    exists (select 1 from public.client_contacts c where c.id = contact_id and c.user_id = auth.uid())
  );
create policy client_access_insert on public.engagement_client_access
  for insert to authenticated with check (public.can_manage_engagement(engagement_id));
create policy client_access_update on public.engagement_client_access
  for update to authenticated using (public.can_manage_engagement(engagement_id))
  with check (public.can_manage_engagement(engagement_id));

grant select, insert, update, delete on public.engagement_folders to authenticated;
create policy folders_select on public.engagement_folders
  for select to authenticated using (public.can_view_engagement(engagement_id));
create policy folders_insert on public.engagement_folders
  for insert to authenticated with check (public.can_edit_request_list(engagement_id));
create policy folders_update on public.engagement_folders
  for update to authenticated using (public.can_edit_request_list(engagement_id))
  with check (public.can_edit_request_list(engagement_id));
create policy folders_delete on public.engagement_folders
  for delete to authenticated using (public.can_edit_request_list(engagement_id));

-- -----------------------------------------------------------------------------
-- request items: read by team + client; descriptive fields editable by
-- lead/manager; status/waiver/version fields only via functions.
-- -----------------------------------------------------------------------------
grant select on public.request_items to authenticated;
grant update (title, guidance, folder_id, category_id, priority, assignee_id, due_date,
              sort_order, expected_file_types, is_critical)
  on public.request_items to authenticated;
create policy items_select on public.request_items
  for select to authenticated using (public.can_view_engagement(engagement_id));
create policy items_update_manage on public.request_items
  for update to authenticated using (public.can_edit_request_list(engagement_id))
  with check (public.can_edit_request_list(engagement_id));

-- Files: read-only to end users; writes via begin_upload/complete_upload/remove_draft_file
grant select on public.request_item_files to authenticated;
create policy files_select_team on public.request_item_files
  for select to authenticated using (public.is_engagement_member(engagement_id));
-- Clients see submitted files plus their own drafts
create policy files_select_client on public.request_item_files
  for select to authenticated using (
    public.is_engagement_client(engagement_id)
    and (submitted_at is not null or uploaded_by = auth.uid())
  );

-- Comments
grant select, insert on public.comments to authenticated;
grant update (body, edited_at, deleted_at) on public.comments to authenticated;
create policy comments_select_team on public.comments
  for select to authenticated using (public.is_engagement_member(engagement_id));
create policy comments_select_client on public.comments
  for select to authenticated using (public.is_engagement_client(engagement_id) and not is_internal);
create policy comments_insert_team on public.comments
  for insert to authenticated with check (
    author_id = auth.uid() and public.is_engagement_member(engagement_id)
  );
create policy comments_insert_client on public.comments
  for insert to authenticated with check (
    author_id = auth.uid() and not is_internal and public.is_engagement_client(engagement_id)
  );
create policy comments_update_own on public.comments
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());

-- History and decisions: internal only
grant select on public.status_history, public.acceptance_decisions to authenticated;
create policy history_select on public.status_history
  for select to authenticated using (public.is_engagement_member(engagement_id));
create policy decisions_select on public.acceptance_decisions
  for select to authenticated using (public.is_engagement_member(engagement_id));

-- Notifications: own only
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_update_own on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Configuration
grant select on public.app_settings to authenticated;
grant insert, update on public.app_settings to authenticated;
create policy settings_select on public.app_settings for select to authenticated using (true);
create policy settings_admin_ins on public.app_settings for insert to authenticated with check (public.is_admin());
create policy settings_admin_upd on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.reminder_rules, public.email_templates to authenticated;
create policy reminder_rules_staff_select on public.reminder_rules for select to authenticated using (public.is_staff());
create policy reminder_rules_admin_all on public.reminder_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy email_templates_staff_select on public.email_templates for select to authenticated using (public.is_staff());
create policy email_templates_admin_all on public.email_templates for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Audit log: admin read only; nobody (not even admin) can change it through the API.
grant select on public.audit_log to authenticated;
create policy audit_select_admin on public.audit_log for select to authenticated using (public.is_admin());

-- engagement_code_counters: no access (functions only)
