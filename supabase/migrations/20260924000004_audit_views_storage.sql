-- =============================================================================
-- Kreston Pedabo PBC Portal — 0004 Audit trail, reporting views, storage,
-- realtime and default settings.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Audit trail: every insert/update/delete on the tables below is logged with
-- the acting user. Written by trigger so no code path can bypass it.
-- -----------------------------------------------------------------------------
create or replace function public.tg_audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_after  jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row    jsonb := coalesce(v_after, v_before);
  v_entity text := tg_argv[0];
  v_action text;
  v_eng    uuid;
  v_headers jsonb;
begin
  if tg_op = 'UPDATE' then
    -- ignore no-op and housekeeping-only updates
    if (v_before - 'updated_at' - 'last_seen_at') = (v_after - 'updated_at' - 'last_seen_at') then
      return null;
    end if;
  end if;

  v_action := v_entity || '.' || lower(tg_op);
  if tg_op = 'UPDATE' and v_before ? 'status' and (v_before ->> 'status') is distinct from (v_after ->> 'status') then
    v_action := v_entity || '.status_changed';
  elsif tg_op = 'UPDATE' and v_entity = 'request_item'
        and (v_before ->> 'is_waived') is distinct from (v_after ->> 'is_waived') then
    v_action := case when (v_after ->> 'is_waived')::boolean then 'request_item.waived' else 'request_item.unwaived' end;
  elsif tg_op = 'UPDATE' and v_entity = 'file'
        and (v_before ->> 'submitted_at') is null and (v_after ->> 'submitted_at') is not null then
    v_action := 'file.submitted';
  elsif tg_op = 'UPDATE' and v_entity = 'file'
        and (v_before ->> 'upload_state') is distinct from (v_after ->> 'upload_state') then
    v_action := 'file.uploaded';
  end if;

  v_eng := case when v_entity = 'engagement' then (v_row ->> 'id')::uuid
                when v_row ? 'engagement_id' then (v_row ->> 'engagement_id')::uuid end;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then v_headers := null;
  end;

  insert into public.audit_log (actor_id, actor_role, action, entity_type, entity_id, engagement_id,
                                before, after, ip, user_agent)
  values (auth.uid(), coalesce(public.current_app_role()::text, current_user::text), v_action, v_entity,
          coalesce(v_row ->> 'id', v_row ->> 'key', v_row ->> 'engagement_id'), v_eng,
          v_before, v_after,
          split_part(coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'cf-connecting-ip', ''), ',', 1),
          v_headers ->> 'user-agent');
  return null;
end $$;

create trigger audit_engagements          after insert or update or delete on public.engagements          for each row execute function public.tg_audit_row('engagement');
create trigger audit_request_items        after insert or update or delete on public.request_items        for each row execute function public.tg_audit_row('request_item');
create trigger audit_request_item_files   after insert or update or delete on public.request_item_files   for each row execute function public.tg_audit_row('file');
create trigger audit_comments             after insert or update or delete on public.comments             for each row execute function public.tg_audit_row('comment');
create trigger audit_acceptance_decisions after insert or update or delete on public.acceptance_decisions for each row execute function public.tg_audit_row('acceptance_decision');
create trigger audit_engagement_team      after insert or update or delete on public.engagement_team      for each row execute function public.tg_audit_row('engagement_team');
create trigger audit_client_access        after insert or update or delete on public.engagement_client_access for each row execute function public.tg_audit_row('client_access');
create trigger audit_engagement_folders   after insert or update or delete on public.engagement_folders   for each row execute function public.tg_audit_row('folder');
create trigger audit_master_items         after insert or update or delete on public.master_checklist_items for each row execute function public.tg_audit_row('master_item');
create trigger audit_profiles             after insert or update or delete on public.profiles             for each row execute function public.tg_audit_row('user');
create trigger audit_clients              after insert or update or delete on public.clients              for each row execute function public.tg_audit_row('client');
create trigger audit_client_contacts      after insert or update or delete on public.client_contacts      for each row execute function public.tg_audit_row('client_contact');
create trigger audit_app_settings         after insert or update or delete on public.app_settings         for each row execute function public.tg_audit_row('setting');

-- Audit log is append-only even for the table owner's API roles
create or replace function public.tg_audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.tg_audit_immutable();

-- -----------------------------------------------------------------------------
-- Reporting views (security_invoker: the caller's RLS applies)
-- -----------------------------------------------------------------------------
create or replace view public.v_engagement_progress
with (security_invoker = on) as
select
  e.id as engagement_id,
  count(ri.id)::int                                                                      as total_items,
  count(ri.id) filter (where ri.status <> 'not_applicable')::int                          as applicable_items,
  count(ri.id) filter (where ri.status = 'accepted')::int                                 as accepted_items,
  count(ri.id) filter (where ri.status in ('submitted','under_review','accepted'))::int   as submitted_items,
  count(ri.id) filter (where ri.status in ('submitted','under_review'))::int              as awaiting_review_items,
  count(ri.id) filter (where ri.status = 'queried')::int                                  as queried_items,
  count(ri.id) filter (where ri.status = 'requested')::int                                as requested_items,
  count(ri.id) filter (where ri.status = 'not_applicable')::int                           as na_items,
  count(ri.id) filter (where ri.status in ('requested','queried') and ri.due_date < public.lagos_today())::int as overdue_items,
  count(ri.id) filter (where ri.is_critical)::int                                         as critical_total,
  count(ri.id) filter (where ri.is_critical and (ri.status = 'accepted' or ri.is_waived))::int as critical_satisfied,
  count(ri.id) filter (where ri.is_critical and ri.status in ('submitted','under_review','accepted'))::int as critical_submitted,
  case when count(ri.id) filter (where ri.status <> 'not_applicable') = 0 then 0
       else round(100.0 * count(ri.id) filter (where ri.status = 'accepted')
                  / count(ri.id) filter (where ri.status <> 'not_applicable'), 1) end   as pct_provided,
  case when count(ri.id) filter (where ri.status <> 'not_applicable') = 0 then 0
       else round(100.0 * count(ri.id) filter (where ri.status in ('submitted','under_review','accepted'))
                  / count(ri.id) filter (where ri.status <> 'not_applicable'), 1) end   as pct_submitted,
  case when count(ri.id) filter (where ri.is_critical) = 0 then null
       else round(100.0 * count(ri.id) filter (where ri.is_critical and (ri.status = 'accepted' or ri.is_waived))
                  / count(ri.id) filter (where ri.is_critical), 1) end                  as pct_critical,
  case when e.pre_engagement_at is null then null
       else (coalesce(e.decided_at, now())::date - e.pre_engagement_at::date) end       as days_in_pre_engagement
from public.engagements e
left join public.request_items ri on ri.engagement_id = e.id
group by e.id;

create or replace view public.v_folder_progress
with (security_invoker = on) as
select
  f.engagement_id,
  f.id as folder_id,
  f.name as folder_name,
  f.sort_order,
  count(ri.id)::int                                                                      as total_items,
  count(ri.id) filter (where ri.status <> 'not_applicable')::int                          as applicable_items,
  count(ri.id) filter (where ri.status = 'accepted')::int                                 as accepted_items,
  count(ri.id) filter (where ri.status in ('submitted','under_review','accepted'))::int   as submitted_items,
  count(ri.id) filter (where ri.status = 'queried')::int                                  as queried_items,
  count(ri.id) filter (where ri.status in ('requested','queried') and ri.due_date < public.lagos_today())::int as overdue_items,
  case when count(ri.id) filter (where ri.status <> 'not_applicable') = 0 then 0
       else round(100.0 * count(ri.id) filter (where ri.status = 'accepted')
                  / count(ri.id) filter (where ri.status <> 'not_applicable'), 1) end   as pct_provided,
  case when count(ri.id) filter (where ri.status <> 'not_applicable') = 0 then 0
       else round(100.0 * count(ri.id) filter (where ri.status in ('submitted','under_review','accepted'))
                  / count(ri.id) filter (where ri.status <> 'not_applicable'), 1) end   as pct_submitted
from public.engagement_folders f
left join public.request_items ri on ri.folder_id = f.id
group by f.id;

-- Engagement items where the master checklist has moved on
create or replace view public.v_master_updates
with (security_invoker = on) as
select ri.engagement_id, ri.id as request_item_id, ri.code, ri.title,
       ri.master_revision, mi.revision as master_current_revision
from public.request_items ri
join public.master_checklist_items mi on mi.id = ri.master_item_id
where ri.master_revision < mi.revision;

revoke all on public.v_engagement_progress, public.v_folder_progress, public.v_master_updates from anon, authenticated;
grant select on public.v_engagement_progress, public.v_folder_progress, public.v_master_updates to authenticated;

-- -----------------------------------------------------------------------------
-- Private storage bucket for Phase 1 uploads. No storage policies are created:
-- end users never touch the bucket directly. The app issues short-lived signed
-- upload URLs after begin_upload() approves the request, and streams downloads
-- through a permission-checked route using the service role.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('pbc-files', 'pbc-files', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Realtime: live dashboards and request lists
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.request_items, public.comments, public.request_item_files, public.notifications, public.engagements;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Default settings
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('brand', '{"firm_name":"Kreston Pedabo","portal_name":"PBC Portal","primary":"#0F77AD","accent":"#43BBC7","logo_url":"/kreston-pedabo-logo.png"}'),
  ('uploads.max_file_mb', '100'),
  ('uploads.allowed_extensions', '["pdf","xls","xlsx","xlsm","csv","doc","docx","jpg","jpeg","png","heic","zip"]'),
  ('security.mfa_required_for_staff', 'false')
on conflict (key) do nothing;
